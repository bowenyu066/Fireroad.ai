const mockData = require('../../shared/mock-data.js');

const asArray = (value) => (Array.isArray(value) ? value : []);
const unique = (items) => [...new Set(items)];

const getCourse = (id) => {
  const normalized = String(id || '').trim().toLowerCase();
  return mockData.catalog.find((course) => course.id.toLowerCase() === normalized);
};

const getMatch = (id) => mockData.matchScores[id] || { total: 0, interest: 0, workload: 0, reqValue: 0 };

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

function sanitizeSuggestions(suggestions) {
  return unique(asArray(suggestions)
    .map((id) => getCourse(id))
    .filter((course) => course && !course._stub)
    .map((course) => course.id))
    .slice(0, 5);
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

module.exports = {
  asArray,
  courseSummary,
  getCourse,
  getCourseTool,
  getMatch,
  mockData,
  normalizeProfile,
  normalizeSchedule,
  recommendCourses,
  sanitizeSuggestions,
  searchCourses,
  summarizeSchedule,
  toolHandlers,
  toolSchemas,
  validateUiAction,
};
