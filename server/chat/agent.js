const { SYSTEM_PROMPT } = require('./prompt');
const { OPENROUTER_MODEL, callOpenRouter, publicErrorMessage } = require('./openrouter');
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

  if (!handler) {
    return {
      name,
      args,
      result: { error: `Unknown tool: ${name}` },
    };
  }

  if (args._parseError) {
    return {
      name,
      args,
      result: { error: `Could not parse tool arguments: ${args._parseError}` },
    };
  }

  try {
    return {
      name,
      args,
      result: await handler(args, context),
    };
  } catch (error) {
    return {
      name,
      args,
      result: { error: error.message },
    };
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
  const { parsed, raw } = parseFinalJson(content);
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

async function buildLocalActionFallback(body = {}, reason) {
  const messages = asArray(body.messages);
  const studentName = String(body.studentName || '').trim();
  const context = {
    profile: normalizeProfile({ ...(body.profile || {}), ...(studentName ? { name: studentName } : {}) }),
    schedule: normalizeSchedule(body.schedule),
    activeSem: body.activeSem || null,
    planningTermLabel: body.planningTermLabel || null,
    studentName,
  };
  const latestText = latestUserText(messages);
  if (!explicitScheduleChangeRequested(latestText, messages)) return null;

  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
    localFallbackReason: reason ? publicErrorMessage(reason) : 'Model unavailable',
  };
  const requestedActions = await extractRequestedUiActions(latestText, context.schedule, messages);
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

async function runAgentChat({ messages, profile, schedule, activeSem, planningTermLabel, studentName }) {
  const effectiveStudentName = String(studentName || '').trim();
  const context = {
    profile: normalizeProfile({ ...(profile || {}), ...(effectiveStudentName ? { name: effectiveStudentName } : {}) }),
    schedule: normalizeSchedule(schedule),
    activeSem: activeSem || null,
    planningTermLabel: planningTermLabel || null,
    studentName: effectiveStudentName,
  };
  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
  };

  const modelMessages = buildModelMessages(messages, context.profile, context.schedule, context.activeSem, context.planningTermLabel, context.studentName);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
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

module.exports = {
  buildLocalActionFallback,
  publicErrorMessage,
  runAgentChat,
};
