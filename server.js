const express = require('express');
const path = require('path');
const mockData = require('./shared/mock-data.js');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini';
const MAX_TOOL_ROUNDS = 5;

app.use(express.json({ limit: '1mb' }));

const getCourse = (id) => {
  const normalized = String(id || '').trim().toLowerCase();
  return mockData.catalog.find((course) => course.id.toLowerCase() === normalized);
};

const getMatch = (id) => mockData.matchScores[id] || { total: 0, interest: 0, workload: 0, reqValue: 0 };

const asArray = (value) => (Array.isArray(value) ? value : []);

const unique = (items) => [...new Set(items)];

function normalizeSchedule(schedule) {
  const ids = [];
  asArray(schedule).forEach((id) => {
    const course = getCourse(id);
    if (course && !ids.includes(course.id)) ids.push(course.id);
  });
  return ids;
}

function normalizeProfile(profile) {
  const incoming = profile && typeof profile === 'object' ? profile : {};
  return {
    ...mockData.profile,
    ...incoming,
    taken: asArray(incoming.taken).length ? asArray(incoming.taken).map(String) : mockData.profile.taken,
    remainingReqs: asArray(incoming.remainingReqs).length ? asArray(incoming.remainingReqs).map(String) : mockData.profile.remainingReqs,
    preferences: {
      ...mockData.profile.preferences,
      ...(incoming.preferences || {}),
    },
  };
}

function scheduleForTool(args = {}, context = {}) {
  const candidate = Array.isArray(args.schedule) && args.schedule.length ? args.schedule : context.schedule;
  return normalizeSchedule(candidate);
}

function profileForTool(args = {}, context = {}) {
  const hasProfileArgs = args.profile && typeof args.profile === 'object' && Object.keys(args.profile).length > 0;
  return normalizeProfile(hasProfileArgs ? args.profile : context.profile);
}

function courseSummary(course) {
  if (!course) return null;
  const match = getMatch(course.id);
  return {
    id: course.id,
    name: course.name,
    units: course.units,
    schedule: course.schedule,
    area: course.area,
    satisfies: course.satisfies,
    prereqs: course.prereqs,
    workload_hours_per_week: course.hydrant,
    rating_overall: course.rating.overall,
    match_score: match.total,
    desc: course.desc,
  };
}

function courseDetail(course) {
  if (!course) return null;
  return {
    ...courseSummary(course),
    instructor: course.instructor,
    rating: course.rating,
    topics: course.topics,
    quote: course.quote,
  };
}

function hasTime(course) {
  return course && Array.isArray(course.days) && course.days.length && course.time && course.time.end > course.time.start;
}

function detectConflicts(courses) {
  const conflicts = [];
  for (let i = 0; i < courses.length; i += 1) {
    for (let j = i + 1; j < courses.length; j += 1) {
      const a = courses[i];
      const b = courses[j];
      if (!hasTime(a) || !hasTime(b)) continue;

      const sharedDays = a.days.filter((day) => b.days.includes(day));
      if (!sharedDays.length) continue;

      const start = Math.max(a.time.start, b.time.start);
      const end = Math.min(a.time.end, b.time.end);
      if (start < end) {
        conflicts.push({
          courses: [a.id, b.id],
          days: sharedDays,
          overlap: { start, end },
          schedules: [a.schedule, b.schedule],
        });
      }
    }
  }
  return conflicts;
}

function summarizeSchedule(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  const profile = profileForTool(args, context);
  const courses = schedule.map(getCourse).filter(Boolean);
  const coveredSet = new Set();

  courses.forEach((course) => {
    course.satisfies.forEach((req) => coveredSet.add(req));
  });

  const coveredRequirements = [...coveredSet].sort();
  const completedBeforeSchedule = mockData.allReqs.filter((req) => req.done).map((req) => req.id);
  const remainingRequirements = profile.remainingReqs.filter((req) => !coveredSet.has(req));
  const fulfilledRequirements = unique([...completedBeforeSchedule, ...coveredRequirements]);

  return {
    schedule,
    courses: courses.map(courseSummary),
    courseCount: courses.length,
    totalUnits: courses.reduce((total, course) => total + course.units, 0),
    estimatedWorkloadHours: Number(courses.reduce((total, course) => total + course.hydrant, 0).toFixed(1)),
    coveredRequirements,
    remainingRequirements,
    completedBeforeSchedule,
    fulfilledRequirements,
    conflicts: detectConflicts(courses),
  };
}

function scoreSearchResult(course, query, tokens) {
  if (!query) return getMatch(course.id).total || 1;

  const haystack = [
    course.id,
    course.name,
    course.desc,
    course.area,
    course.satisfies.join(' '),
    course.prereqs.join(' '),
  ].join(' ').toLowerCase();

  let score = 0;
  if (course.id.toLowerCase() === query) score += 100;
  if (course.id.toLowerCase().includes(query)) score += 40;
  if (course.name.toLowerCase().includes(query)) score += 30;
  if (course.desc.toLowerCase().includes(query)) score += 12;
  if (course.area.toLowerCase().includes(query)) score += 8;
  if (course.satisfies.some((req) => req.toLowerCase().includes(query))) score += 12;

  tokens.forEach((token) => {
    if (haystack.includes(token)) score += 5;
  });

  return score;
}

function searchCourses(args = {}) {
  const query = String(args.query || '').trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const maxResults = Math.max(1, Math.min(Number(args.max_results) || 5, 10));
  const areas = asArray(args.areas).map((area) => String(area).toLowerCase());
  const satisfies = asArray(args.satisfies).map((req) => String(req).toLowerCase());
  const maxWorkload = Number(args.max_workload) || null;

  const results = mockData.catalog
    .filter((course) => !course._stub || course.id.toLowerCase() === query)
    .filter((course) => !areas.length || areas.includes(course.area.toLowerCase()))
    .filter((course) => !satisfies.length || satisfies.every((req) => course.satisfies.map((r) => r.toLowerCase()).includes(req)))
    .filter((course) => !maxWorkload || course.hydrant <= maxWorkload)
    .map((course) => ({ course, score: scoreSearchResult(course, query, tokens) }))
    .filter((result) => result.score > 0 || !query)
    .sort((a, b) => b.score - a.score || getMatch(b.course.id).total - getMatch(a.course.id).total)
    .slice(0, maxResults)
    .map(({ course, score }) => ({
      ...courseSummary(course),
      search_score: score,
    }));

  return {
    query,
    filters: { areas, satisfies, max_workload: maxWorkload },
    results,
  };
}

function getCourseTool(args = {}) {
  const course = getCourse(args.course_id || args.courseId);
  if (!course) {
    return { found: false, reason: `No course found for ${args.course_id || args.courseId || 'unknown id'}` };
  }
  return { found: true, course: courseDetail(course) };
}

function isMlCourse(course) {
  const text = `${course.id} ${course.name} ${course.desc}`.toLowerCase();
  return /machine learning|deep learning|neural|probabilistic|inference|representation/.test(text);
}

function isTheoryCourse(course) {
  const text = `${course.name} ${course.desc} ${(course.topics || []).map((topic) => topic.title).join(' ')}`.toLowerCase();
  return /theory|probabilistic|statistical|automata|computability|complexity|kernel|bayesian|proof/.test(text);
}

function recommendCourses(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  const profile = profileForTool(args, context);
  const maxResults = Math.max(1, Math.min(Number(args.max_results) || 5, 10));
  const maxWorkload = Number(args.max_workload) || null;
  const targetRequirements = asArray(args.target_requirements).length
    ? asArray(args.target_requirements).map(String)
    : profile.remainingReqs;
  const scheduledSet = new Set(schedule);
  const takenSet = new Set([...asArray(profile.taken).map(String), ...schedule]);

  const recommendations = mockData.catalog
    .filter((course) => !course._stub)
    .filter((course) => !scheduledSet.has(course.id))
    .filter((course) => !maxWorkload || course.hydrant <= maxWorkload)
    .map((course) => {
      const match = getMatch(course.id);
      const reasons = [];
      let rankScore = match.total || 0;

      const reqHits = course.satisfies.filter((req) => targetRequirements.includes(req));
      if (reqHits.length) {
        rankScore += reqHits.length * 12;
        reasons.push(`covers ${reqHits.join(', ')}`);
      }

      const goal = String(profile.preferences && profile.preferences.goal ? profile.preferences.goal : '').toLowerCase();
      if ((goal.includes('ml') || goal.includes('research') || goal.includes('engineer')) && isMlCourse(course)) {
        rankScore += 8;
        reasons.push('fits ML goals');
      }

      const style = String(profile.preferences && profile.preferences.style ? profile.preferences.style : '').toLowerCase();
      if ((style.includes('theory') || style.includes('mix')) && isTheoryCourse(course)) {
        rankScore += 4;
        reasons.push('fits theory-leaning style');
      }

      if (course.hydrant <= 10) {
        rankScore += 3;
        reasons.push('lighter workload');
      } else if (course.hydrant >= 13) {
        reasons.push('heavier workload');
      }

      const missingPrereqs = course.prereqs.filter((prereq) => !takenSet.has(prereq));
      if (missingPrereqs.length) {
        rankScore -= missingPrereqs.length * 4;
        reasons.push(`check prereqs: ${missingPrereqs.join(', ')}`);
      }

      return {
        ...courseSummary(course),
        rank_score: rankScore,
        reasons,
        missingPrereqs,
      };
    })
    .sort((a, b) => b.rank_score - a.rank_score || b.match_score - a.match_score)
    .slice(0, maxResults);

  return {
    schedule,
    targetRequirements,
    recommendations,
  };
}

function validateUiAction(action, schedule) {
  if (!action || typeof action !== 'object') {
    return { ok: false, reason: 'Action must be an object.' };
  }

  const type = action.type;
  const course = getCourse(action.courseId || action.course_id);
  const currentSchedule = normalizeSchedule(schedule);

  if (!['add_course', 'remove_course'].includes(type)) {
    return { ok: false, reason: `Unsupported action type: ${type || 'missing'}.` };
  }

  if (!course) {
    return { ok: false, reason: `Course ${action.courseId || action.course_id || 'unknown'} does not exist in the catalog.` };
  }

  if (type === 'add_course') {
    if (course._stub) return { ok: false, reason: `${course.id} is only a completed-course stub in this demo catalog.` };
    if (currentSchedule.includes(course.id)) return { ok: false, reason: `${course.id} is already in the schedule.` };
    return { ok: true, action: { type, courseId: course.id }, course: courseSummary(course) };
  }

  if (!currentSchedule.includes(course.id)) {
    return { ok: false, reason: `${course.id} is not currently in the schedule.` };
  }
  return { ok: true, action: { type, courseId: course.id }, course: courseSummary(course) };
}

function validateUiActionTool(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  return validateUiAction(args.action, schedule);
}

const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'search_courses',
      description: 'Search the current MIT demo catalog by course id, name, description, area, requirements, and workload.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number' },
          areas: { type: 'array', items: { type: 'string' } },
          satisfies: { type: 'array', items: { type: 'string' } },
          max_workload: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_course',
      description: 'Get detailed information for one course in the current catalog.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'string' },
        },
        required: ['course_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_schedule',
      description: 'Summarize total units, covered requirements, remaining profile requirements, and obvious time conflicts.',
      parameters: {
        type: 'object',
        properties: {
          schedule: { type: 'array', items: { type: 'string' } },
          profile: { type: 'object' },
        },
        required: ['schedule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend_courses',
      description: 'Deterministically rank courses for the student using match scores, requirements, workload, and profile preferences.',
      parameters: {
        type: 'object',
        properties: {
          schedule: { type: 'array', items: { type: 'string' } },
          profile: { type: 'object' },
          max_results: { type: 'number' },
          max_workload: { type: 'number' },
          target_requirements: { type: 'array', items: { type: 'string' } },
        },
        required: ['schedule', 'profile'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_ui_action',
      description: 'Validate an add/remove course UI action against the current schedule before returning it to the browser.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['add_course', 'remove_course'] },
              courseId: { type: 'string' },
            },
            required: ['type', 'courseId'],
          },
          schedule: { type: 'array', items: { type: 'string' } },
        },
        required: ['action', 'schedule'],
      },
    },
  },
];

const toolHandlers = {
  search_courses: searchCourses,
  get_course: getCourseTool,
  summarize_schedule: summarizeSchedule,
  recommend_courses: recommendCourses,
  validate_ui_action: validateUiActionTool,
};

const SYSTEM_PROMPT = `You are Fireroad.ai's MIT course-planning agent.

Ground every course-specific answer in the provided tools and current state. The catalog is a small demo catalog, so do not invent course ids, requirements, instructors, ratings, schedules, or prerequisites. Prefer calling tools over guessing.

Use recommend_courses or search_courses for recommendations, get_course for detail questions, summarize_schedule for requirement/unit/conflict questions, and validate_ui_action before returning an add/remove action.

Only include uiActions when the user explicitly asks to modify the schedule, such as adding, removing, dropping, swapping, or replacing a course. For recommendation or advice questions, return suggestions but no uiActions.

Final response format: return only valid JSON with this shape:
{"text":"brief natural-language answer","suggestions":["6.3900"],"uiActions":[{"type":"add_course","courseId":"6.3900"}]}

Keep explanations brief, concrete, and tied to the catalog/profile/schedule.`;

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

function buildModelMessages(messages, profile, schedule) {
  const state = {
    profile: {
      name: profile.name,
      major: profile.major,
      year: profile.year,
      gradYear: profile.gradYear,
      taken: profile.taken,
      remainingReqs: profile.remainingReqs,
      preferences: profile.preferences,
    },
    currentSchedule: schedule,
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

async function callOpenRouter(body) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
      'X-Title': 'Fireroad.ai Prototype',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      ...body,
    }),
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    data = { raw };
  }

  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : raw || response.statusText;
    const error = new Error(`OpenRouter ${response.status}: ${message}`);
    error.status = response.status;
    error.openRouterResponse = data;
    throw error;
  }

  return data;
}

function publicErrorMessage(error) {
  const key = process.env.OPENROUTER_API_KEY || '__no_key__';
  const message = String(error && error.message ? error.message : error || 'Unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(key, '[redacted]');

  if (message.includes('OpenRouter 401')) {
    return 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY on the server.';
  }
  if (message.includes('OpenRouter 402')) {
    return 'OpenRouter says the account needs credits or billing before the agent can answer.';
  }
  if (message.includes('OpenRouter 404')) {
    return `OpenRouter could not find model ${OPENROUTER_MODEL}. Set OPENROUTER_MODEL to a valid tool-capable model.`;
  }
  if (/tool|function|schema|parameter/i.test(message)) {
    return `OpenRouter rejected the tool-calling request: ${message}`;
  }
  return `Backend/model error: ${message}`;
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

function executeToolCall(toolCall, context) {
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
      result: handler(args, context),
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
  if (/\b(should|could|would|can)\s+i\s+(add|put|include|enroll|register|remove|drop|delete|swap|replace)\b/.test(lower)) {
    return false;
  }
  const hasMutationVerb = /\b(add|put|include|enroll|register|remove|drop|delete|swap|replace)\b/.test(lower);
  const hasCourseOrScheduleContext = /\b(schedule|plan|semester|course|class)\b/.test(lower) || /\b\d{1,2}\.[\w.]+\b/.test(lower);
  return hasMutationVerb && hasCourseOrScheduleContext;
}

function extractRequestedUiActions(text, schedule, messages = []) {
  if (isAffirmativeScheduleConfirmation(text, messages)) {
    const previousAgent = latestAssistantBeforeLastUser(messages);
    const suggestions = sanitizeSuggestions(previousAgent && previousAgent.suggestions);
    const lower = String(text || '').toLowerCase();
    const ids = /\b(all|both)\b/.test(lower) ? suggestions : suggestions.slice(0, 1);
    return ids.map((courseId) => ({ type: 'add_course', courseId }));
  }

  const lower = String(text || '').toLowerCase();
  const mentionedIds = mockData.catalog
    .filter((course) => !course._stub && lower.includes(course.id.toLowerCase()))
    .map((course) => course.id);

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

function sanitizeSuggestions(suggestions) {
  return unique(asArray(suggestions)
    .map((id) => getCourse(id))
    .filter((course) => course && !course._stub)
    .map((course) => course.id))
    .slice(0, 5);
}

function validateFinalActions(actions, context, debug, allowActions) {
  if (!allowActions) return [];

  let workingSchedule = [...context.schedule];
  const validated = [];

  asArray(actions).forEach((action) => {
    const validation = validateUiAction(action, workingSchedule);
    debug.finalActionValidation.push({ action, validation });
    if (!validation.ok) return;

    validated.push(validation.action);
    if (validation.action.type === 'add_course') {
      workingSchedule.push(validation.action.courseId);
    } else {
      workingSchedule = workingSchedule.filter((id) => id !== validation.action.courseId);
    }
  });

  return validated;
}

function buildApiResponse(content, context, debug, requestMessages) {
  const { parsed, raw } = parseFinalJson(content);
  const final = parsed && typeof parsed === 'object'
    ? {
        ...(parsed.message && typeof parsed.message === 'object' ? parsed.message : parsed),
        uiActions: parsed.uiActions || (parsed.message && parsed.message.uiActions),
      }
    : { text: raw };
  const latestText = latestUserText(requestMessages);
  const allowActions = explicitScheduleChangeRequested(latestText, requestMessages);
  let uiActions = validateFinalActions(final.uiActions, context, debug, allowActions);
  if (allowActions && uiActions.length === 0) {
    const fallbackActions = extractRequestedUiActions(latestText, context.schedule, requestMessages);
    debug.fallbackActionExtraction = fallbackActions;
    uiActions = validateFinalActions(fallbackActions, context, debug, true);
  }
  const text = String(final.text || raw || 'I found a grounded answer from the course data, but could not format it cleanly.').trim();

  return {
    message: {
      role: 'agent',
      text,
      suggestions: sanitizeSuggestions(final.suggestions),
    },
    uiActions,
    debug,
  };
}

function buildLocalActionFallback(body = {}, reason) {
  const messages = asArray(body.messages);
  const context = {
    profile: normalizeProfile(body.profile),
    schedule: normalizeSchedule(body.schedule),
  };
  const latestText = latestUserText(messages);
  if (!explicitScheduleChangeRequested(latestText, messages)) return null;

  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
    localFallbackReason: reason ? publicErrorMessage(reason) : 'Model unavailable',
  };
  const requestedActions = extractRequestedUiActions(latestText, context.schedule, messages);
  const uiActions = validateFinalActions(requestedActions, context, debug, true);
  if (!uiActions.length) return null;

  const descriptions = uiActions.map((action) => {
    const course = getCourse(action.courseId);
    const verb = action.type === 'add_course' ? 'add' : 'remove';
    return `${verb} ${course.id} (${course.name})`;
  });

  return {
    message: {
      role: 'agent',
      text: `The model is unavailable, but I validated this schedule change locally: ${descriptions.join(', ')}.`,
      suggestions: [],
    },
    uiActions,
    debug,
  };
}

async function runAgentChat({ messages, profile, schedule }) {
  const context = {
    profile: normalizeProfile(profile),
    schedule: normalizeSchedule(schedule),
  };
  const debug = {
    model: OPENROUTER_MODEL,
    toolCalls: [],
    finalActionValidation: [],
  };

  const modelMessages = buildModelMessages(messages, context.profile, context.schedule);

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

    toolCalls.forEach((toolCall) => {
      const executed = executeToolCall(toolCall, context);
      debug.toolCalls.push(executed);
      modelMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(executed.result),
      });
    });
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

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: OPENROUTER_MODEL,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
  });
});

app.post('/api/chat', async (req, res) => {
  if (!process.env.OPENROUTER_API_KEY) {
    const fallback = buildLocalActionFallback(req.body, new Error('OPENROUTER_API_KEY is not set'));
    if (fallback) return res.json(fallback);

    return res.status(503).json({
      message: {
        role: 'agent',
        text: 'The planner still works, but the chat agent needs OPENROUTER_API_KEY set on the server.',
        suggestions: [],
      },
      uiActions: [],
      debug: { toolCalls: [] },
    });
  }

  try {
    const result = await runAgentChat(req.body || {});
    if (result.debug.toolCalls.length) {
      console.log('[agent tools]', result.debug.toolCalls.map((call) => call.name).join(', '));
    }
    res.json(result);
  } catch (error) {
    console.error('[agent error]', error);
    const fallback = buildLocalActionFallback(req.body, error);
    if (fallback) return res.json(fallback);

    const message = publicErrorMessage(error);
    res.status(error.status && error.status < 500 ? 502 : 500).json({
      message: {
        role: 'agent',
        text: message,
        suggestions: [],
      },
      uiActions: [],
      error: message,
    });
  }
});

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Fireroad.ai prototype running at http://localhost:${PORT}`);
    console.log(`OpenRouter model: ${OPENROUTER_MODEL}`);
  });
}

module.exports = {
  app,
  searchCourses,
  getCourseTool,
  summarizeSchedule,
  recommendCourses,
  validateUiAction,
  runAgentChat,
};
