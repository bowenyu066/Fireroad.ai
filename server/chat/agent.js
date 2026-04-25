const { SYSTEM_PROMPT } = require('./prompt');
const { OPENROUTER_MODEL, callOpenRouter, callOpenRouterStream, publicErrorMessage } = require('./openrouter');
const {
  asArray,
  normalizeProfile,
  normalizeSchedule,
  resolveCurrentCourseSummary,
  sanitizeSuggestions,
  toolHandlers,
  toolSchemas,
  validateUiAction,
} = require('./tools');

const MAX_TOOL_ROUNDS = 5;

function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.error) return { error: result.error };
  if (Array.isArray(result.results)) {
    return {
      source: result.source,
      count: result.results.length,
      ids: result.results.slice(0, 8).map((course) => course && course.id).filter(Boolean),
    };
  }
  if (Array.isArray(result.recommendations)) {
    return {
      count: result.recommendations.length,
      ids: result.recommendations.slice(0, 8).map((course) => course && course.id).filter(Boolean),
      targetRequirements: result.targetRequirements,
    };
  }
  if (Array.isArray(result.courses)) {
    return {
      courseCount: result.courseCount,
      totalUnits: result.totalUnits,
      estimatedWorkloadHours: result.estimatedWorkloadHours,
      courseIds: result.courses.map((course) => course && course.id).filter(Boolean),
      coveredRequirements: result.coveredRequirements,
    };
  }
  if (result.course && result.course.id) {
    return { found: result.found, id: result.course.id, name: result.course.name };
  }
  if (result.action || result.reason) {
    return { ok: result.ok, action: result.action, reason: result.reason, courseId: result.course && result.course.id };
  }
  return result;
}

function summarizeMessage(content) {
  const text = String(content || '');
  return {
    length: text.length,
    preview: text.slice(0, 240),
  };
}

function buildContext({ profile, schedule, activeSem, planningTermLabel, studentName } = {}) {
  const effectiveStudentName = String(studentName || '').trim();
  return {
    profile: normalizeProfile({ ...(profile || {}), ...(effectiveStudentName ? { name: effectiveStudentName } : {}) }),
    schedule: normalizeSchedule(schedule),
    activeSem: activeSem || null,
    planningTermLabel: planningTermLabel || null,
    studentName: effectiveStudentName,
  };
}

function latestUserText(messages) {
  const last = [...asArray(messages)].reverse().find((message) => message && message.role === 'user');
  return String(last && (last.text || last.content) ? last.text || last.content : '');
}

function latestAssistantBeforeLastUser(messages) {
  const list = asArray(messages);
  const lastUserIndex = list.map((message) => message && message.role).lastIndexOf('user');
  const beforeLastUser = lastUserIndex >= 0 ? list.slice(0, lastUserIndex) : list;
  return [...beforeLastUser].reverse().find((message) => message && message.role !== 'user') || null;
}

function buildModelMessages(messages, profile, schedule, activeSem, planningTermLabel, studentName) {
  const effectiveStudentName = String(studentName || profile.name || '').trim();
  const state = {
    studentName: effectiveStudentName || null,
    profile: {
      name: effectiveStudentName || profile.name,
      major: profile.major,
      year: profile.year,
      gradYear: profile.gradYear,
      taken: profile.taken,
      remainingReqs: profile.remainingReqs,
      preferences: profile.preferences,
    },
    activeSem,
    planningTermLabel,
    activeSemesterSchedule: schedule,
    planningScope: 'active_semester_only',
  };

  const conversation = asArray(messages)
    .slice(-12)
    .map((message) => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const content = String(message.text || message.content || '').trim();
      return content ? { role, content } : null;
    })
    .filter(Boolean);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `Authoritative current app state. Use these exact values in tool arguments when relevant:\n${JSON.stringify(state)}`,
    },
    ...conversation,
  ];
}

function parseToolArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch (error) {
    return { _parseError: error.message, _raw: rawArgs };
  }
}

async function executeToolCall(toolCall, context) {
  const name = toolCall.function && toolCall.function.name;
  const args = parseToolArguments(toolCall.function && toolCall.function.arguments);
  const handler = toolHandlers[name];
  const log = context.log || (() => {});
  const startedAt = Date.now();

  log('tool:start', {
    name,
    args,
    rawArgumentsLength: String(toolCall.function && toolCall.function.arguments || '').length,
  });

  if (!handler) {
    const result = {
      name,
      args,
      result: { error: `Unknown tool: ${name}` },
    };
    log('tool:end', { name, ms: Date.now() - startedAt, result: summarizeToolResult(result.result) });
    return result;
  }

  if (args._parseError) {
    const result = {
      name,
      args,
      result: { error: `Could not parse tool arguments: ${args._parseError}` },
    };
    log('tool:end', { name, ms: Date.now() - startedAt, result: summarizeToolResult(result.result) });
    return result;
  }

  try {
    const result = {
      name,
      args,
      result: await handler(args, context),
    };
    log('tool:end', { name, ms: Date.now() - startedAt, result: summarizeToolResult(result.result) });
    return result;
  } catch (error) {
    const result = {
      name,
      args,
      result: { error: error.message },
    };
    log('tool:error', { name, ms: Date.now() - startedAt, error: error.message });
    return result;
  }
}

function parseFinalJson(content) {
  const text = Array.isArray(content)
    ? content.map((part) => (typeof part === 'string' ? part : part.text || '')).join('')
    : String(content || '');
  const trimmed = text.trim();
  if (!trimmed) return { parsed: null, raw: '' };

  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim(),
  ];

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return { parsed: JSON.parse(candidate), raw: text };
    } catch (error) {
      // Try the next candidate.
    }
  }

  return { parsed: null, raw: text };
}

function isAffirmativeScheduleConfirmation(text, messages) {
  const lower = String(text || '').trim().toLowerCase();
  if (!/^(y|yes|yeah|yep|sure|ok|okay|please|please do|do it|go ahead|sounds good|add it)[.! ]*$/.test(lower)) {
    return false;
  }

  const previousAgent = latestAssistantBeforeLastUser(messages);
  if (!previousAgent || !asArray(previousAgent.suggestions).length) return false;

  const agentText = String(previousAgent.text || previousAgent.content || '').toLowerCase();
  return /\b(add|want me to add|put|include)\b/.test(agentText);
}

function explicitScheduleChangeRequested(text, messages = []) {
  if (isAffirmativeScheduleConfirmation(text, messages)) return true;

  const lower = String(text || '').toLowerCase();
  if (/\b(junior|senior|sophomore|freshman)\s+(fall|spring)|\b(fall|spring)\s+\d{4}|\bnext\s+year\b|\b4[- ]?year\b|\bfour[- ]?year\b|\broadmap\b/.test(lower)) {
    return false;
  }
  if (/\b(should|could|would|can)\s+i\s+(add|put|include|enroll|register|remove|drop|delete|swap|replace)\b/.test(lower)) {
    return false;
  }
  const hasMutationVerb = /\b(add|put|include|enroll|register|remove|drop|delete|swap|replace)\b/.test(lower);
  const hasCourseOrScheduleContext = /\b(schedule|plan|semester|course|class)\b/.test(lower) || extractCourseIdsFromText(lower).length > 0;
  return hasMutationVerb && hasCourseOrScheduleContext;
}

async function extractRequestedUiActions(text, schedule, messages = []) {
  if (isAffirmativeScheduleConfirmation(text, messages)) {
    const previousAgent = latestAssistantBeforeLastUser(messages);
    const suggestions = await sanitizeSuggestions(previousAgent && previousAgent.suggestions);
    const lower = String(text || '').toLowerCase();
    const ids = /\b(all|both)\b/.test(lower) ? suggestions : suggestions.slice(0, 1);
    return ids.map((courseId) => ({ type: 'add_course', courseId }));
  }

  const lower = String(text || '').toLowerCase();
  const mentionedIds = extractCourseIdsFromText(lower);

  if (!mentionedIds.length) return [];

  if (/\b(remove|drop|delete)\b/.test(lower)) {
    return mentionedIds.map((courseId) => ({ type: 'remove_course', courseId }));
  }

  if (/\b(swap|replace)\b/.test(lower)) {
    return mentionedIds.map((courseId) => ({
      type: schedule.includes(courseId) ? 'remove_course' : 'add_course',
      courseId,
    }));
  }

  if (/\b(add|put|include|enroll|register)\b/.test(lower)) {
    return mentionedIds.map((courseId) => ({ type: 'add_course', courseId }));
  }

  return [];
}

function extractCourseIdsFromText(text) {
  return [...String(text || '').matchAll(/\b[A-Z0-9]{1,5}\.[A-Z0-9.]*[A-Z0-9]\b/gi)]
    .map((match) => String(match[0] || '').trim().toUpperCase())
    .filter((courseId, index, list) => courseId && list.indexOf(courseId) === index);
}

async function validateFinalActions(actions, context, debug, allowActions) {
  if (!allowActions) return [];

  let workingSchedule = [...context.schedule];
  const validated = [];

  for (const action of asArray(actions)) {
    const validation = await validateUiAction(action, workingSchedule);
    debug.finalActionValidation.push({ action, validation });
    if (!validation.ok) continue;

    validated.push(validation.action);
    if (validation.action.type === 'add_course') {
      workingSchedule.push(validation.action.courseId);
    } else if (validation.action.type === 'remove_course') {
      workingSchedule = workingSchedule.filter((id) => id !== validation.action.courseId);
    } else if (validation.action.type === 'replace_course') {
      workingSchedule = workingSchedule
        .filter((id) => id !== validation.action.removeCourseId)
        .concat(validation.action.courseId);
    }
  }

  return validated;
}

async function buildApiResponse(content, context, debug, requestMessages) {
  const log = context.log || (() => {});
  const { parsed, raw } = parseFinalJson(content);
  log('final:raw', {
    parsed: Boolean(parsed),
    ...summarizeMessage(raw),
  });
  const final = parsed && typeof parsed === 'object'
    ? {
        ...(parsed.message && typeof parsed.message === 'object' ? parsed.message : parsed),
        uiActions: parsed.uiActions || (parsed.message && parsed.message.uiActions),
      }
    : { text: raw };
  const latestText = latestUserText(requestMessages);
  const allowActions = explicitScheduleChangeRequested(latestText, requestMessages);
  let uiActions = await validateFinalActions(final.uiActions, context, debug, allowActions);
  if (allowActions && uiActions.length === 0) {
    const fallbackActions = await extractRequestedUiActions(latestText, context.schedule, requestMessages);
    debug.fallbackActionExtraction = fallbackActions;
    uiActions = await validateFinalActions(fallbackActions, context, debug, true);
  }
  const text = String(final.text || raw || 'I found a grounded answer from the course data, but could not format it cleanly.').trim();
  log('final:validated', {
    allowActions,
    suggestions: final.suggestions || [],
    uiActions,
    validation: debug.finalActionValidation.map((entry) => ({
      action: entry.action,
      ok: entry.validation && entry.validation.ok,
      reason: entry.validation && entry.validation.reason,
    })),
    responseTextLength: text.length,
  });

  return {
    message: {
      role: 'agent',
      text,
      suggestions: await sanitizeSuggestions(final.suggestions),
    },
    uiActions,
    debug,
  };
}

function createJsonTextFieldStreamer(onTextDelta = () => {}) {
  let raw = '';
  let position = 0;
  let textStarted = false;
  let textDone = false;

  const decodeEscape = (text, index) => {
    const next = text[index + 1];
    if (!next) return null;
    if (next === 'n') return { value: '\n', length: 2 };
    if (next === 'r') return { value: '\r', length: 2 };
    if (next === 't') return { value: '\t', length: 2 };
    if (next === '"' || next === '\\' || next === '/') return { value: next, length: 2 };
    if (next === 'u') {
      const hex = text.slice(index + 2, index + 6);
      if (hex.length < 4) return null;
      return { value: String.fromCharCode(parseInt(hex, 16)), length: 6 };
    }
    return { value: next, length: 2 };
  };

  return {
    feed(chunk) {
      if (textDone || !chunk) return;
      raw += chunk;
      if (!textStarted) {
        const match = raw.match(/"text"\s*:\s*"/);
        if (!match) return;
        textStarted = true;
        position = match.index + match[0].length;
      }

      let emitted = '';
      while (position < raw.length) {
        const char = raw[position];
        if (char === '"') {
          textDone = true;
          break;
        }
        if (char === '\\') {
          const decoded = decodeEscape(raw, position);
          if (!decoded) break;
          emitted += decoded.value;
          position += decoded.length;
          continue;
        }
        emitted += char;
        position += 1;
      }
      if (emitted) onTextDelta(emitted);
    },
  };
}

async function buildLocalActionFallback(body = {}, reason) {
  const messages = asArray(body.messages);
  const studentName = String(body.studentName || '').trim();
  const context = buildContext({ ...body, studentName });
  context.log = body.log || (() => {});
  const latestText = latestUserText(messages);
  context.log('fallback:consider', {
    reason: reason ? publicErrorMessage(reason) : 'Model unavailable',
    latestText,
  });
  if (!explicitScheduleChangeRequested(latestText, messages)) return null;

  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
    localFallbackReason: reason ? publicErrorMessage(reason) : 'Model unavailable',
  };
  const requestedActions = await extractRequestedUiActions(latestText, context.schedule, messages);
  context.log('fallback:actions', { requestedActions });
  const uiActions = await validateFinalActions(requestedActions, context, debug, true);
  if (!uiActions.length) return null;

  const descriptions = await Promise.all(uiActions.map(async (action) => {
    const course = await resolveCurrentCourseSummary(action.courseId);
    const verb = action.type === 'add_course' ? 'add' : action.type === 'remove_course' ? 'remove' : 'replace with';
    return `${verb} ${action.courseId}${course ? ` (${course.name})` : ''}`;
  }));

  return {
    message: {
      role: 'agent',
      text: `The model is unavailable, but I validated this active-semester schedule change locally: ${descriptions.join(', ')}.`,
      suggestions: [],
    },
    uiActions,
    debug,
  };
}

async function runAgentChat({ messages, profile, schedule, activeSem, planningTermLabel, studentName, log }) {
  const context = buildContext({ profile, schedule, activeSem, planningTermLabel, studentName });
  context.log = log || (() => {});
  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
  };

  const modelMessages = buildModelMessages(messages, context.profile, context.schedule, context.activeSem, context.planningTermLabel, context.studentName);
  context.log('agent:start', {
    mode: 'json',
    activeSem: context.activeSem,
    planningTermLabel: context.planningTermLabel,
    schedule: context.schedule,
    messageCount: asArray(messages).length,
    latestUserText: latestUserText(messages),
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    context.log('model:request', { mode: 'json', round, messages: modelMessages.length, tools: toolSchemas.length });
    const completion = await callOpenRouter({
      messages: modelMessages,
      tools: toolSchemas,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      temperature: 0.2,
      max_tokens: 1000,
    });

    const choice = completion.choices && completion.choices[0];
    const responseMessage = choice && choice.message;
    if (!responseMessage) throw new Error('OpenRouter returned no assistant message.');

    const toolCalls = responseMessage.tool_calls || [];
    context.log('model:response', {
      mode: 'json',
      round,
      contentLength: String(responseMessage.content || '').length,
      toolCalls: toolCalls.map((call) => ({
        id: call.id,
        name: call.function && call.function.name,
        rawArgumentsLength: String(call.function && call.function.arguments || '').length,
      })),
    });
    if (!toolCalls.length) {
      return buildApiResponse(responseMessage.content, context, debug, messages);
    }

    modelMessages.push({
      role: 'assistant',
      content: responseMessage.content || '',
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const executed = await executeToolCall(toolCall, context);
      debug.toolCalls.push(executed);
      modelMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(executed.result),
      });
    }
  }

  modelMessages.push({
    role: 'system',
    content: 'The tool round limit was reached. Return the final answer now as only the required JSON object.',
  });

  const completion = await callOpenRouter({
    messages: modelMessages,
    temperature: 0.2,
    max_tokens: 700,
  });
  const responseMessage = completion.choices && completion.choices[0] && completion.choices[0].message;
  if (!responseMessage) throw new Error('OpenRouter returned no final assistant message.');
  return buildApiResponse(responseMessage.content, context, debug, messages);
}

async function runAgentChatStream(body = {}, onEvent = () => {}) {
  const { messages } = body;
  const context = buildContext(body);
  context.log = body.log || (() => {});
  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
  };
  const modelMessages = buildModelMessages(messages, context.profile, context.schedule, context.activeSem, context.planningTermLabel, context.studentName);

  const emit = (event) => onEvent(event);
  context.log('agent:start', {
    mode: 'stream',
    activeSem: context.activeSem,
    planningTermLabel: context.planningTermLabel,
    schedule: context.schedule,
    messageCount: asArray(messages).length,
    latestUserText: latestUserText(messages),
  });
  emit({ type: 'status', text: 'Thinking...' });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const textStreamer = createJsonTextFieldStreamer((text) => emit({ type: 'delta', text }));
    context.log('model:request', { mode: 'stream', round, messages: modelMessages.length, tools: toolSchemas.length });
    const completion = await callOpenRouterStream({
      messages: modelMessages,
      tools: toolSchemas,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      temperature: 0.2,
      max_tokens: 1000,
    }, (chunk) => textStreamer.feed(chunk));

    const choice = completion.choices && completion.choices[0];
    const responseMessage = choice && choice.message;
    if (!responseMessage) throw new Error('OpenRouter returned no assistant message.');

    const toolCalls = responseMessage.tool_calls || [];
    context.log('model:response', {
      mode: 'stream',
      round,
      contentLength: String(responseMessage.content || '').length,
      toolCalls: toolCalls.map((call) => ({
        id: call.id,
        name: call.function && call.function.name,
        rawArgumentsLength: String(call.function && call.function.arguments || '').length,
      })),
    });
    if (!toolCalls.length) {
      return buildApiResponse(responseMessage.content, context, debug, messages);
    }

    emit({ type: 'status', text: 'Checking current catalog...' });
    modelMessages.push({
      role: 'assistant',
      content: responseMessage.content || '',
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const executed = await executeToolCall(toolCall, context);
      debug.toolCalls.push(executed);
      modelMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(executed.result),
      });
    }
    emit({ type: 'status', text: 'Writing answer...' });
  }

  modelMessages.push({
    role: 'system',
    content: 'The tool round limit was reached. Return the final answer now as only the required JSON object.',
  });

  const textStreamer = createJsonTextFieldStreamer((text) => emit({ type: 'delta', text }));
  const completion = await callOpenRouterStream({
    messages: modelMessages,
    temperature: 0.2,
    max_tokens: 700,
  }, (chunk) => textStreamer.feed(chunk));
  const responseMessage = completion.choices && completion.choices[0] && completion.choices[0].message;
  if (!responseMessage) throw new Error('OpenRouter returned no final assistant message.');
  return buildApiResponse(responseMessage.content, context, debug, messages);
}

module.exports = {
  buildLocalActionFallback,
  publicErrorMessage,
  runAgentChat,
  runAgentChatStream,
};
