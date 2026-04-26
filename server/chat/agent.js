const { SYSTEM_PROMPT } = require('./prompt');
const { OPENROUTER_MODEL, callOpenRouter, callOpenRouterStream, publicErrorMessage } = require('./openrouter');
const {
  asArray,
  buildStudentPlanningContext,
  majorToDepartments,
  normalizeProfile,
  normalizeSchedule,
  resolveCurrentCourseSummary,
  sanitizeSuggestions,
  toolHandlers,
  toolSchemas,
  validateUiAction,
} = require('./tools');
const { checkMajorRequirements } = require('../requirements');

const MAX_TOOL_ROUNDS = 5;

const TOOL_DISPLAY_NAMES = {
  search_current_courses: 'Searching current MIT catalog',
  search_courses: 'Searching current MIT catalog',
  get_current_course: 'Looking up course details',
  get_course: 'Looking up course details',
  summarize_semester_plan: 'Checking current semester plan',
  summarize_schedule: 'Checking current semester plan',
  recommend_courses: 'Ranking course recommendations',
  validate_ui_action: 'Validating proposed plan change',
  get_course_history_summary: 'Checking historical offerings',
  get_offering_history: 'Reading historical offering details',
  check_requirements: 'Checking degree requirements',
  check_schedule_conflicts: 'Checking schedule conflicts',
};

const TOOL_TRACE_LABELS = {
  search_current_courses: 'current catalog',
  search_courses: 'current catalog',
  get_current_course: 'current catalog',
  get_course: 'current catalog',
  summarize_semester_plan: 'current semester plan',
  summarize_schedule: 'current semester plan',
  recommend_courses: 'course recommendations',
  validate_ui_action: 'proposed plan change',
  get_course_history_summary: 'historical offerings',
  get_offering_history: 'historical offerings',
  check_requirements: 'degree requirements',
  check_schedule_conflicts: 'schedule conflicts',
};

function normalizeContentText(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  if (Array.isArray(content)) return content.map(normalizeContentText).join('');
  if (typeof content === 'object') {
    if (content.text !== undefined) return normalizeContentText(content.text);
    if (content.content !== undefined) return normalizeContentText(content.content);
    if (content.message !== undefined) return normalizeContentText(content.message);
    if (content.label !== undefined) return normalizeContentText(content.label);
    if (content.name !== undefined) return normalizeContentText(content.name);
    if (content.title !== undefined) return normalizeContentText(content.title);
  }
  return '';
}

function textForPreview(value) {
  const text = normalizeContentText(value);
  if (text) return text;
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '';
    }
  }
  return String(value === null || value === undefined ? '' : value);
}

function compactText(value, max = 160) {
  const text = textForPreview(value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function displayNameForTool(toolName) {
  return TOOL_DISPLAY_NAMES[toolName] || `Running ${toolName || 'tool'}`;
}

function traceLabelForTool(toolName) {
  return TOOL_TRACE_LABELS[toolName] || 'course data';
}

function previewToolInput(toolName, args = {}) {
  if (!args || typeof args !== 'object') return '';
  if (args._parseError) return 'Invalid tool input';

  if (toolName === 'search_current_courses' || toolName === 'search_courses') {
    const parts = [];
    if (args.query) parts.push(`query "${compactText(args.query, 60)}"`);
    if (asArray(args.requirements || args.satisfies).length) parts.push(`requirements ${asArray(args.requirements || args.satisfies).slice(0, 4).join(', ')}`);
    if (asArray(args.areas).length) parts.push(`areas ${asArray(args.areas).slice(0, 4).join(', ')}`);
    if (args.max_workload) parts.push(`max ${args.max_workload}h/wk`);
    return parts.join(' · ') || 'broad current catalog search';
  }

  if (toolName === 'get_current_course' || toolName === 'get_course') {
    return compactText(args.course_id || args.courseId || 'course detail lookup', 80);
  }

  if (toolName === 'summarize_semester_plan' || toolName === 'summarize_schedule') {
    const schedule = asArray(args.schedule);
    return schedule.length ? `${schedule.length} courses: ${schedule.slice(0, 6).join(', ')}` : 'active semester plan';
  }

  if (toolName === 'recommend_courses') {
    const requirements = asArray(args.target_requirements);
    const parts = [];
    if (requirements.length) parts.push(`targets ${requirements.slice(0, 5).join(', ')}`);
    if (args.max_results) parts.push(`${args.max_results} results`);
    return parts.join(' · ') || 'personalized ranking';
  }

  if (toolName === 'validate_ui_action') {
    const action = args.action || {};
    const courseId = action.courseId || action.course_id;
    const removeCourseId = action.removeCourseId || action.remove_course_id;
    return compactText([action.type, removeCourseId && `remove ${removeCourseId}`, courseId && `course ${courseId}`].filter(Boolean).join(' · ') || 'plan change', 120);
  }

  if (toolName === 'get_course_history_summary') {
    return compactText(args.course_id || args.courseId || 'course history summary', 80);
  }

  if (toolName === 'get_offering_history') {
    return compactText(args.offering_id || args.offeringId || 'offering history', 80);
  }

  if (toolName === 'check_requirements') {
    const schedule = asArray(args.schedule);
    return compactText([args.major, schedule.length ? `${schedule.length} active courses` : 'student profile'].filter(Boolean).join(' · '), 120);
  }

  if (toolName === 'check_schedule_conflicts') {
    const ids = asArray(args.course_ids);
    return ids.length ? `${ids.length} courses: ${ids.slice(0, 6).join(', ')}` : 'active semester plan';
  }

  return compactText(JSON.stringify(args), 140);
}

function summarizeToolResultForUi(toolName, result) {
  if (!result || typeof result !== 'object') return compactText(result || 'Done', 160);
  if (result.error) return `Error: ${compactText(result.error, 140)}`;

  if (toolName === 'search_current_courses' || toolName === 'search_courses') {
    const ids = asArray(result.results).map((course) => course && course.id).filter(Boolean);
    return ids.length
      ? `Found ${ids.length} courses: ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', ...' : ''}`
      : 'Found 0 courses';
  }

  if (toolName === 'get_current_course' || toolName === 'get_course') {
    if (!result.found) return `Not found: ${compactText(result.reason || 'course unavailable', 120)}`;
    const course = result.course || {};
    return `Found ${course.id || 'course'}${course.name ? `: ${course.name}` : ''}`;
  }

  if (toolName === 'summarize_semester_plan' || toolName === 'summarize_schedule') {
    return `${Number(result.courseCount) || asArray(result.courses).length} courses, ${Number(result.totalUnits) || 0} units, ${Number(result.estimatedWorkloadHours) || 0} estimated hours, ${asArray(result.conflicts).length} conflicts`;
  }

  if (toolName === 'recommend_courses') {
    return `Ranked ${asArray(result.recommendations).length} recommendations`;
  }

  if (toolName === 'validate_ui_action') {
    return result.ok ? 'Valid' : `Rejected: ${compactText(result.reason || 'invalid action', 140)}`;
  }

  if (toolName === 'get_course_history_summary') {
    if (!result.found) return `Not found: ${compactText(result.reason || 'history unavailable', 120)}`;
    const offerings = asArray(result.offerings).length;
    const stats = result.stats || {};
    const policyCount = Number(stats.attendancePolicyCount || 0) + Number(stats.gradingPolicyCount || 0);
    return `Found ${offerings} historical offerings; ${policyCount} policy records`;
  }

  if (toolName === 'get_offering_history') {
    if (!result.found) return `Not found: ${compactText(result.reason || 'offering unavailable', 120)}`;
    const documents = asArray(result.documents).length;
    const policies = [result.attendancePolicy, result.gradingPolicy].filter(Boolean).length;
    return `Found ${documents} documents; ${policies} policy records`;
  }

  if (toolName === 'check_requirements') {
    if (!result.found) return `Not found: ${compactText(result.reason || 'requirements unavailable', 120)}`;
    const groups = asArray(result.groups);
    const unmet = groups.filter((group) => !group.satisfied).length;
    return `Checked ${result.satisfiedCount || 0}/${result.totalCount || groups.length} requirement groups; ${unmet} unmet`;
  }

  if (toolName === 'check_schedule_conflicts') {
    return `${Number(result.conflictCount) || 0} conflicts`;
  }

  return compactText(JSON.stringify(summarizeToolResult(result)), 160);
}

function toolActivityFromExecution(toolCall, args, result, state = 'running') {
  const toolName = toolCall.function && toolCall.function.name;
  return {
    toolCallId: toolCall.id,
    toolName,
    displayName: displayNameForTool(toolName),
    inputPreview: previewToolInput(toolName, args),
    resultSummary: result ? summarizeToolResultForUi(toolName, result) : '',
    state,
  };
}

function buildTraceSummary(toolExecutions = []) {
  const checked = asArray(toolExecutions).map((entry) => ({
    label: traceLabelForTool(entry.name),
    toolName: entry.name,
    displayName: displayNameForTool(entry.name),
    inputPreview: previewToolInput(entry.name, entry.args),
    resultSummary: summarizeToolResultForUi(entry.name, entry.result),
  }));
  return checked.length ? { checked } : null;
}

function publicDebug(debug = {}) {
  return {
    ...debug,
    toolCalls: asArray(debug.toolCalls).map((entry) => ({
      name: entry.name,
      inputPreview: previewToolInput(entry.name, entry.args),
      resultSummary: summarizeToolResultForUi(entry.name, entry.result),
    })),
    finalActionValidation: asArray(debug.finalActionValidation).map((entry) => ({
      action: entry.action,
      ok: Boolean(entry.validation && entry.validation.ok),
      reason: entry.validation && entry.validation.reason,
      courseId: entry.validation && entry.validation.course && entry.validation.course.id,
    })),
  };
}

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
      semesterPlanSummary: result.semesterPlanSummary,
      mode: result.mode,
      personalizationUsed: result.personalizationUsed,
      personalizationReasons: result.personalizationReasons,
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
  const text = normalizeContentText(content);
  return {
    length: text.length,
    preview: text.slice(0, 240),
  };
}

function buildContext({ profile, personalization, personalCourseMarkdown, schedule, activeSem, planningTermLabel, studentName } = {}) {
  const effectiveStudentName = String(studentName || '').trim();
  const nextProfile = profile && typeof profile === 'object' ? { ...profile } : {};
  const nextPreferences = {
    ...(nextProfile.preferences || {}),
    ...(personalization ? { personalization } : {}),
  };
  const context = {
    profile: normalizeProfile({ ...nextProfile, preferences: nextPreferences, ...(effectiveStudentName ? { name: effectiveStudentName } : {}) }),
    personalCourseMarkdown: String(personalCourseMarkdown || '').trim(),
    schedule: normalizeSchedule(schedule),
    activeSem: activeSem || null,
    planningTermLabel: planningTermLabel || null,
    studentName: effectiveStudentName,
  };
  context.studentPlanningContext = buildStudentPlanningContext(context);
  return context;
}

function latestUserText(messages) {
  const last = [...asArray(messages)].reverse().find((message) => message && message.role === 'user');
  return normalizeContentText(last && (last.text ?? last.content));
}

function latestAssistantBeforeLastUser(messages) {
  const list = asArray(messages);
  const lastUserIndex = list.map((message) => message && message.role).lastIndexOf('user');
  const beforeLastUser = lastUserIndex >= 0 ? list.slice(0, lastUserIndex) : list;
  return [...beforeLastUser].reverse().find((message) => message && message.role !== 'user') || null;
}

function buildRequirementContext(profile, schedule) {
  try {
    const allCourses = [...new Set([...asArray(profile.taken), ...schedule])];
    const result = checkMajorRequirements(profile.major, allCourses);
    if (!result) return null;
    return {
      major: result.title,
      satisfiedGroups: result.satisfiedCount,
      totalGroups: result.totalCount,
      unmetGroups: result.groups
        .filter((g) => !g.satisfied)
        .map((g) => ({ label: g.label, progress: g.progress, unmet: g.unmet.slice(0, 4) })),
    };
  } catch {
    return null;
  }
}

function buildModelMessages(messages, context) {
  const { profile, schedule, activeSem, planningTermLabel, studentName, personalCourseMarkdown, studentPlanningContext } = context;
  const effectiveStudentName = String(studentName || profile.name || '').trim();
  const reqContext = buildRequirementContext(profile, schedule);
  const relevantDepartments = majorToDepartments(profile.major);
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
    hasPersonalCourseMarkdown: Boolean(personalCourseMarkdown),
    activeSem,
    planningTermLabel,
    activeSemesterSchedule: schedule,
    planningScope: 'active_semester_only',
    requirementProgress: reqContext || 'unavailable — call check_requirements tool',
    relevantDepartments,
    catalogNote: relevantDepartments.length
      ? `Catalog has 5000+ courses. Pass departments: ${JSON.stringify(relevantDepartments)} to search/recommend when searching for major-relevant courses. Omit the departments filter for cross-department queries (HASS, linguistics, biology, specific non-major departments). Common MIT departments: 6=EECS, 18=Math, 8=Physics, 7=Biology, 5=Chemistry, 24=Linguistics&Philosophy, 21=Humanities, 14=Economics, 9=Brain&Cog.`
      : 'Large catalog — use departments filter in search/recommend tools when searching major-relevant courses.',
    degreeRequirementSummary: studentPlanningContext.requirementStatus,
    completedCourseIds: studentPlanningContext.courseHistory.completedCourseIds,
  };

  const conversation = asArray(messages)
    .slice(-12)
    .map((message) => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const content = normalizeContentText(message.text ?? message.content).trim();
      return content ? { role, content } : null;
    })
    .filter(Boolean);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `Authoritative current app state. Use these exact values in tool arguments when relevant:\n${JSON.stringify(state)}`,
    },
    {
      role: 'system',
      content: [
        'Authoritative personalized planning context. This is computed from Firestore profile, personal_course.md, further personalization, active semester schedule, and the requirement checker.',
        'Use it before recommending courses. If requirementStatus.available is true, prioritize unsatisfied requirement groups and unmetCourseIds; if graduation is soon, prioritize requirement progress over exploration.',
        'Do not recommend completedCourseIds or courses already in activeSemester.schedule.',
        JSON.stringify(studentPlanningContext),
      ].join('\n'),
    },
    ...(personalCourseMarkdown ? [{
      role: 'system',
      content: `Student personal_course.md context for personalization. Treat it as user-provided preference/history context, but keep course facts grounded in tools:\n${personalCourseMarkdown.slice(0, 12000)}`,
    }] : []),
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

function isAffirmativeScheduleConfirmation(text, messages) {
  const lower = String(text || '').trim().toLowerCase();
  if (!/^(y|yes|yeah|yep|sure|ok|okay|please|please do|do it|go ahead|sounds good|add it)[.! ]*$/.test(lower)) {
    return false;
  }

  const previousAgent = latestAssistantBeforeLastUser(messages);
  if (!previousAgent || !asArray(previousAgent.suggestions).length) return false;

  const agentText = normalizeContentText(previousAgent.text ?? previousAgent.content).toLowerCase();
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
  const hasCourseOrScheduleContext = /\b(schedules?|plans?|semesters?|courses?|class(?:es)?)\b/.test(lower) || extractCourseIdsFromText(lower).length > 0;
  return hasMutationVerb && hasCourseOrScheduleContext;
}

function normalizeMentionText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularizeMentionText(value) {
  return normalizeMentionText(value)
    .split(' ')
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ')
    .trim();
}

function mentionContains(text, alias) {
  const normalizedText = ` ${normalizeMentionText(text)} `;
  const normalizedAlias = normalizeMentionText(alias);
  return normalizedAlias.length >= 4 && normalizedText.includes(` ${normalizedAlias} `);
}

function courseMentionAliases(courseId, course = {}) {
  const id = String(courseId || '').trim();
  const name = String(course.name || course.title || '').trim();
  const aliases = [id, name, singularizeMentionText(name)];
  const normalizedName = normalizeMentionText(name);

  if (normalizedName.includes('introduction to machine learning')) {
    aliases.push('intro to ml', 'intro ml', 'intro to machine learning', 'introduction to ml', 'machine learning');
  } else if (normalizedName.includes('machine learning')) {
    aliases.push('machine learning');
  }

  if (normalizedName === 'networks' || normalizedName.endsWith(' networks')) {
    aliases.push('network', 'networks');
  }

  return [...new Set(aliases.map(normalizeMentionText).filter((alias) => alias.length >= 4))];
}

async function extractScheduledCourseMentions(text, schedule = []) {
  const ids = [];
  for (const courseId of normalizeSchedule(schedule)) {
    const course = await resolveCurrentCourseSummary(courseId);
    const aliases = courseMentionAliases(courseId, course || {});
    if (aliases.some((alias) => mentionContains(text, alias))) {
      ids.push(courseId);
    }
  }
  return ids;
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
  const explicitIds = extractCourseIdsFromText(lower);
  const scheduledNameIds = /\b(remove|drop|delete|swap|replace)\b/.test(lower)
    ? await extractScheduledCourseMentions(lower, schedule)
    : [];
  const mentionedIds = [...new Set([...explicitIds, ...scheduledNameIds])];

  if (/\b(remove|drop|delete)\b/.test(lower)) {
    return mentionedIds.map((courseId) => ({ type: 'remove_course', courseId }));
  }

  if (!mentionedIds.length) return [];

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

async function describeUiAction(action) {
  const course = action.courseId ? await resolveCurrentCourseSummary(action.courseId) : null;
  const courseLabel = `${action.courseId || 'course'}${course && course.name ? ` (${course.name})` : ''}`;

  if (action.type === 'remove_course') {
    return `Remove ${courseLabel}`;
  }

  if (action.type === 'replace_course') {
    const removed = action.removeCourseId ? await resolveCurrentCourseSummary(action.removeCourseId) : null;
    const removedLabel = `${action.removeCourseId || 'course'}${removed && removed.name ? ` (${removed.name})` : ''}`;
    return `Replace ${removedLabel} with ${courseLabel}`;
  }

  return `Add ${courseLabel}`;
}

async function buildProposalFromActions(actions, context, options = {}) {
  const validActions = asArray(actions);
  if (!validActions.length) return null;
  const actionItems = await Promise.all(validActions.map(describeUiAction));
  const assumptions = [
    ...(asArray(options.assumptions)),
  ];
  const warnings = [
    ...(asArray(options.warnings)),
  ];

  return {
    type: 'ui_actions',
    title: 'Proposed changes',
    actions: validActions,
    actionItems,
    assumptions,
    warnings,
    source: options.source || 'validated_active_semester_request',
  };
}

async function buildActionResponseText(actions, context) {
  const descriptions = await Promise.all(asArray(actions).map(describeUiAction));
  const termLabel = context.planningTermLabel || context.activeSem || 'the active semester';
  if (!descriptions.length) return '';
  return `Done. ${descriptions.join('; ')} in ${termLabel}.`;
}

async function buildResponseSuggestions(text, debug = {}, uiActions = []) {
  if (asArray(uiActions).length) return [];

  const toolCalls = asArray(debug.toolCalls);
  const recommendationCall = [...toolCalls].reverse().find((entry) => (
    entry && entry.name === 'recommend_courses' && asArray(entry.result && entry.result.recommendations).length
  ));
  if (recommendationCall) {
    return sanitizeSuggestions(recommendationCall.result.recommendations.map((course) => course && course.id));
  }

  const searchCall = [...toolCalls].reverse().find((entry) => (
    entry
    && (entry.name === 'search_current_courses' || entry.name === 'search_courses')
    && asArray(entry.result && entry.result.results).length
  ));
  if (searchCall) {
    return sanitizeSuggestions(searchCall.result.results.map((course) => course && course.id));
  }

  return sanitizeSuggestions(extractCourseIdsFromText(text));
}

async function buildApiResponse(content, context, debug, requestMessages, options = {}) {
  const log = context.log || (() => {});
  const raw = normalizeContentText(content);
  log('final:raw', {
    mode: 'markdown',
    ...summarizeMessage(raw),
  });
  const latestText = latestUserText(requestMessages);
  const allowActions = explicitScheduleChangeRequested(latestText, requestMessages);
  let uiActions = [];
  if (allowActions) {
    const fallbackActions = await extractRequestedUiActions(latestText, context.schedule, requestMessages);
    debug.fallbackActionExtraction = fallbackActions;
    uiActions = await validateFinalActions(fallbackActions, context, debug, true);
  }
  const text = (uiActions.length
    ? await buildActionResponseText(uiActions, context)
    : raw || 'I found a grounded answer from the course data, but could not format it cleanly.').trim();
  const suggestions = await buildResponseSuggestions(text, debug, uiActions);
  const traceSummary = options.traceSummary || buildTraceSummary(debug.toolCalls);
  const proposal = options.proposal || await buildProposalFromActions(uiActions, context);
  log('final:validated', {
    allowActions,
    suggestions,
    uiActions,
    proposal: Boolean(proposal),
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
      suggestions,
      traceSummary,
      proposal,
    },
    uiActions,
    proposal,
    traceSummary,
    debug: publicDebug(debug),
  };
}

async function buildValidatedLocalActionResult(context, messages, debug, options = {}) {
  if (!explicitScheduleChangeRequested(latestUserText(messages), messages)) return null;

  const requestedActions = await extractRequestedUiActions(latestUserText(messages), context.schedule, messages);
  debug.fallbackActionExtraction = requestedActions;
  if (!requestedActions.length) return null;

  const uiActions = await validateFinalActions(requestedActions, context, debug, true);
  if (!uiActions.length) return null;

  const proposal = await buildProposalFromActions(uiActions, context, {
    source: options.source || 'local_validated_active_semester_request',
    warnings: options.warnings,
  });
  const text = await buildActionResponseText(uiActions, context);

  return {
    message: {
      role: 'agent',
      text,
      suggestions: [],
      proposal,
    },
    uiActions,
    proposal,
    debug: publicDebug(debug),
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
  const proposal = await buildProposalFromActions(uiActions, context, {
    source: 'local_fallback_validated_action',
    warnings: ['The model did not answer; this proposal was validated locally from your explicit request.'],
  });

  return {
    message: {
      role: 'agent',
      text: `The model is unavailable, but I validated this active-semester proposal locally: ${descriptions.join(', ')}.`,
      suggestions: [],
      proposal,
    },
    uiActions,
    proposal,
    debug: publicDebug(debug),
  };
}

async function runAgentChat({ messages, profile, personalization, personalCourseMarkdown, schedule, activeSem, planningTermLabel, studentName, log }) {
  const context = buildContext({ profile, personalization, personalCourseMarkdown, schedule, activeSem, planningTermLabel, studentName });
  context.log = log || (() => {});
  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
  };

  const localActionResult = await buildValidatedLocalActionResult(context, messages, debug);
  if (localActionResult) return localActionResult;

  const modelMessages = buildModelMessages(messages, context);
  context.log('agent:start', {
    mode: 'markdown',
    activeSem: context.activeSem,
    planningTermLabel: context.planningTermLabel,
    schedule: context.schedule,
    personalization: {
      fromProfile: Boolean(context.profile.preferences && context.profile.preferences.personalization),
      fromBody: Boolean(personalization),
      evidence: context.studentPlanningContext.personalization,
      personalCourseMarkdownLength: context.personalCourseMarkdown.length,
    },
    requirementStatus: context.studentPlanningContext.requirementStatus,
    completedCourseCount: context.studentPlanningContext.courseHistory.completedCourseIds.length,
    messageCount: asArray(messages).length,
    latestUserText: latestUserText(messages),
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    context.log('model:request', { mode: 'markdown', round, messages: modelMessages.length, tools: toolSchemas.length });
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
      mode: 'markdown',
      round,
      contentLength: normalizeContentText(responseMessage.content).length,
      toolCalls: toolCalls.map((call) => ({
        id: call.id,
        name: call.function && call.function.name,
        rawArgumentsLength: String(call.function && call.function.arguments || '').length,
      })),
    });
    if (!toolCalls.length) {
      return buildApiResponse(normalizeContentText(responseMessage.content), context, debug, messages);
    }

    modelMessages.push({
      role: 'assistant',
      content: normalizeContentText(responseMessage.content),
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
    content: 'The tool round limit was reached. Return the final answer now as concise Markdown text. Do not output JSON.',
  });

  const completion = await callOpenRouter({
    messages: modelMessages,
    temperature: 0.2,
    max_tokens: 700,
  });
  const responseMessage = completion.choices && completion.choices[0] && completion.choices[0].message;
  if (!responseMessage) throw new Error('OpenRouter returned no final assistant message.');
  return buildApiResponse(normalizeContentText(responseMessage.content), context, debug, messages);
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
  const emit = (event) => onEvent(event);
  if (explicitScheduleChangeRequested(latestUserText(messages), messages)) {
    emit({ type: 'status', text: 'Validating proposed plan change' });
    const localActionResult = await buildValidatedLocalActionResult(context, messages, debug);
    if (localActionResult) return localActionResult;
  }
  const modelMessages = buildModelMessages(messages, context);
  const suppressModelProgressText = explicitScheduleChangeRequested(latestUserText(messages), messages);

  context.log('agent:start', {
    mode: 'stream',
    activeSem: context.activeSem,
    planningTermLabel: context.planningTermLabel,
    schedule: context.schedule,
    personalization: {
      fromProfile: Boolean(context.profile.preferences && context.profile.preferences.personalization),
      fromBody: Boolean(body.personalization),
      evidence: context.studentPlanningContext.personalization,
      personalCourseMarkdownLength: context.personalCourseMarkdown.length,
    },
    requirementStatus: context.studentPlanningContext.requirementStatus,
    completedCourseCount: context.studentPlanningContext.courseHistory.completedCourseIds.length,
    messageCount: asArray(messages).length,
    latestUserText: latestUserText(messages),
  });
  emit({ type: 'status', text: 'Thinking...' });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let streamedContent = '';
    let emittedProgressContent = false;
    context.log('model:request', { mode: 'stream', round, messages: modelMessages.length, tools: toolSchemas.length });
    const completion = await callOpenRouterStream({
      messages: modelMessages,
      tools: toolSchemas,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      temperature: 0.2,
      max_tokens: 1000,
    }, (chunk) => {
      streamedContent += chunk || '';
      if (chunk && !suppressModelProgressText) {
        emittedProgressContent = true;
        emit({ type: 'progress_text_delta', text: chunk });
      }
    });

    const choice = completion.choices && completion.choices[0];
    const responseMessage = choice && choice.message;
    if (!responseMessage) throw new Error('OpenRouter returned no assistant message.');

    const toolCalls = responseMessage.tool_calls || [];
    context.log('model:response', {
      mode: 'stream',
      round,
      contentLength: normalizeContentText(responseMessage.content).length,
      toolCalls: toolCalls.map((call) => ({
        id: call.id,
        name: call.function && call.function.name,
        rawArgumentsLength: String(call.function && call.function.arguments || '').length,
      })),
    });
    if (!toolCalls.length) {
      const finalText = normalizeContentText(responseMessage.content) || streamedContent;
      if (finalText && !emittedProgressContent && !suppressModelProgressText) emit({ type: 'final_text_delta', text: finalText });
      return buildApiResponse(finalText, context, debug, messages);
    }

    const interimText = emittedProgressContent || suppressModelProgressText ? '' : compactText(responseMessage.content || streamedContent, 500);
    if (interimText) emit({ type: 'progress_text', text: interimText });
    emit({ type: 'status', text: 'Checking course data...' });
    modelMessages.push({
      role: 'assistant',
      content: normalizeContentText(responseMessage.content),
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function && toolCall.function.name;
      const args = parseToolArguments(toolCall.function && toolCall.function.arguments);
      emit({ type: 'status', text: displayNameForTool(toolName) });
      const startActivity = toolActivityFromExecution(toolCall, args, null, 'running');
      emit({ type: 'tool_activity_start', ...startActivity });
      const executed = await executeToolCall(toolCall, context);
      debug.toolCalls.push(executed);
      const resultActivity = toolActivityFromExecution(toolCall, executed.args, executed.result, executed.result && executed.result.error ? 'error' : 'done');
      emit({
        type: resultActivity.state === 'error' ? 'tool_activity_error' : 'tool_activity_result',
        ...resultActivity,
      });
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
    content: 'The tool round limit was reached. Return the final answer now as concise Markdown text. Do not output JSON.',
  });

  let finalStreamedContent = '';
  const completion = await callOpenRouterStream({
    messages: modelMessages,
    temperature: 0.2,
    max_tokens: 700,
  }, (chunk) => {
    finalStreamedContent += chunk || '';
    if (chunk && !suppressModelProgressText) emit({ type: 'final_text_delta', text: chunk });
  });
  const responseMessage = completion.choices && completion.choices[0] && completion.choices[0].message;
  if (!responseMessage) throw new Error('OpenRouter returned no final assistant message.');
  const finalText = normalizeContentText(responseMessage.content) || finalStreamedContent;
  return buildApiResponse(finalText, context, debug, messages);
}

module.exports = {
  buildLocalActionFallback,
  publicErrorMessage,
  runAgentChat,
  runAgentChatStream,
};
