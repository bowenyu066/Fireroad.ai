const mockData = require('../../shared/mock-data.js');
const { fetchCurrentCourse, searchCurrentCourses } = require('../current/fireroad');
const { normalizeCourseId } = require('../current/normalize');
const { createHistoryRepo } = require('../history/repo');

const asArray = (value) => (Array.isArray(value) ? value : []);
const unique = (items) => [...new Set(items)];

const getCourse = (id) => {
  const normalized = normalizeCourseId(id);
  return mockData.catalog.find((course) => normalizeCourseId(course.id) === normalized);
};

const getMatch = (id) => mockData.matchScores[normalizeCourseId(id)] || { total: 0, interest: 0, workload: 0, reqValue: 0 };

function normalizeSchedule(schedule) {
  const ids = [];
  asArray(schedule).forEach((id) => {
    const normalized = normalizeCourseId(id);
    if (normalized && !ids.includes(normalized)) ids.push(normalized);
  });
  return ids;
}

function normalizeProfile(profile) {
  const incoming = profile && typeof profile === 'object' ? profile : {};
  return {
    ...mockData.profile,
    ...incoming,
    taken: asArray(incoming.taken).length ? asArray(incoming.taken).map(normalizeCourseId) : mockData.profile.taken,
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

function currentCourseSummary(course) {
  if (!course) return null;
  const match = getMatch(course.id);
  return {
    id: course.id,
    name: course.name,
    units: course.units,
    schedule: course.scheduleDisplay,
    area: course.area,
    requirements: course.requirements || [],
    prerequisitesRaw: course.prerequisitesRaw || '',
    workload_hours_per_week: course.totalHours,
    rating: course.rating,
    enrollmentNumber: course.enrollmentNumber,
    match_score: match.total,
    desc: course.desc,
  };
}

async function resolveCurrentCourseSummary(courseId) {
  const course = await fetchCurrentCourse(courseId);
  return course ? currentCourseSummary(course) : null;
}

function hasTime(course) {
  return course && Array.isArray(course.days) && course.days.length && course.time && course.time.end > course.time.start;
}

function detectConflicts(courseIds) {
  const mockCourses = courseIds.map(getCourse).filter(Boolean);
  const conflicts = [];
  for (let i = 0; i < mockCourses.length; i += 1) {
    for (let j = i + 1; j < mockCourses.length; j += 1) {
      const a = mockCourses[i];
      const b = mockCourses[j];
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

async function summarizeSemesterPlan(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  const profile = profileForTool(args, context);
  const courses = (await Promise.all(schedule.map(fetchCurrentCourse))).filter(Boolean);
  const coveredSet = new Set();

  courses.forEach((course) => {
    asArray(course.requirements).forEach((req) => coveredSet.add(req));
  });

  const coveredRequirements = [...coveredSet].sort();
  const completedBeforeSchedule = mockData.allReqs.filter((req) => req.done).map((req) => req.id);
  const remainingRequirements = profile.remainingReqs.filter((req) => !coveredSet.has(req));
  const fulfilledRequirements = unique([...completedBeforeSchedule, ...coveredRequirements]);

  return {
    semesterPlan: schedule,
    courses: courses.map(currentCourseSummary),
    courseCount: courses.length,
    totalUnits: courses.reduce((total, course) => total + (Number(course.units) || 0), 0),
    estimatedWorkloadHours: Number(courses.reduce((total, course) => total + (Number(course.totalHours) || 0), 0).toFixed(1)),
    coveredRequirements,
    remainingRequirements,
    completedBeforeSchedule,
    fulfilledRequirements,
    conflicts: detectConflicts(schedule),
  };
}

async function searchCurrentCoursesTool(args = {}) {
  const result = await searchCurrentCourses({
    query: args.query || '',
    maxResults: args.max_results || 8,
    areas: args.areas,
    requirements: args.requirements || args.satisfies,
    maxWorkload: args.max_workload,
  });
  return {
    ...result,
    results: result.results.map(currentCourseSummary),
  };
}

async function getCurrentCourseTool(args = {}) {
  const course = await fetchCurrentCourse(args.course_id || args.courseId);
  if (!course) {
    return { found: false, reason: `No current course found for ${args.course_id || args.courseId || 'unknown id'}` };
  }
  return { found: true, course: currentCourseSummary(course), detail: course };
}

function isMlCourse(course) {
  const text = `${course.id} ${course.name} ${course.desc}`.toLowerCase();
  return /machine learning|deep learning|neural|probabilistic|inference|representation/.test(text);
}

function isTheoryCourse(course) {
  const text = `${course.name} ${course.desc} ${course.prerequisitesRaw || ''}`.toLowerCase();
  return /theory|probabilistic|statistical|automata|computability|complexity|kernel|bayesian|proof/.test(text);
}

function courseText(course) {
  return `${course.id} ${course.name} ${course.desc} ${course.prerequisitesRaw || ''}`.toLowerCase();
}

function topicMatchesCourse(topic, course) {
  const text = courseText(course);
  const normalized = String(topic || '').replace(/[_\s-]/g, '').toLowerCase();
  const patterns = {
    coding: /program|coding|software|implementation|python|java|code/,
    proofs: /proof|theory|theorem|mathematical|formal/,
    algorithms: /algorithm|complexity|optimization|graph|dynamic programming/,
    probability: /probability|probabilistic|statistics|statistical|inference|stochastic|bayesian/,
    linearalgebra: /linear algebra|matrix|matrices|vector|eigen|optimization/,
    machinelearning: /machine learning|deep learning|neural|artificial intelligence|classification|regression|representation/,
    systems: /operating system|distributed system|computer network|database|compiler|computer architecture|software system/,
  };
  return patterns[normalized] ? patterns[normalized].test(text) : text.includes(normalized);
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function commitmentCount(commitments = {}) {
  return ['urop', 'recruiting', 'ta', 'clubs'].filter((key) => commitments[key] === true).length
    + (String(commitments.other || '').trim() ? 1 : 0);
}

function applyPersonalizationSignals(course, rankScore, reasons, profile, schedule) {
  const personalization = profile.preferences && profile.preferences.personalization;
  if (!personalization || typeof personalization !== 'object') return rankScore;

  let score = rankScore;
  const topicRatings = personalization.topicRatings || {};
  Object.entries(topicRatings).forEach(([topic, ratings]) => {
    if (!ratings || !topicMatchesCourse(topic, course)) return;
    const interest = Number(ratings.interest);
    const skill = Number(ratings.skill);
    if (Number.isFinite(interest)) {
      if (interest >= 8) {
        score += 6;
        reasons.push(`high interest in ${topic}`);
      } else if (interest <= 2) {
        score -= 8;
        reasons.push(`low interest in ${topic}`);
      }
    }
    if (Number.isFinite(skill)) {
      if (skill >= 7) {
        score += 2;
        reasons.push(`strong self-rated ${topic} preparation`);
      } else if (skill <= 3) {
        score -= 3;
        reasons.push(`may need ramp-up in ${topic}`);
      }
    }
  });

  const workload = personalization.workload || {};
  const commitments = personalization.commitments || {};
  const weeklyBudget = Number(workload.weeklyCourseHoursBudget);
  if (Number.isFinite(weeklyBudget) && course.totalHours) {
    const adjustedBudget = Math.max(8, weeklyBudget - commitmentCount(commitments) * 4);
    const targetPerCourse = adjustedBudget / Math.max(schedule.length + 1, 1);
    if (course.totalHours > targetPerCourse + 4) {
      score -= 6;
      reasons.push('workload may exceed stated weekly budget');
    } else if (course.totalHours <= targetPerCourse + 1) {
      score += 3;
      reasons.push('fits stated weekly workload budget');
    }
  }

  const challenge = String(workload.challengePreference || '').toLowerCase();
  if (challenge.includes('high') && course.totalHours >= 12) {
    score += 2;
    reasons.push('matches high challenge preference');
  }
  if ((challenge.includes('low') || challenge.includes('lighter')) && course.totalHours >= 12) {
    score -= 4;
    reasons.push('may be too challenging for stated preference');
  }

  const formatPreferences = personalization.formatPreferences || {};
  const text = courseText(course);
  const formatSignals = [
    ['psets', /problem set|pset|homework|assignment/],
    ['codingLabs', /lab|programming|implementation|coding|project/],
    ['exams', /exam|quiz|midterm|final exam/],
    ['labs', /lab|laboratory/],
    ['finalProjects', /project|capstone|design/],
    ['paperReading', /paper|reading|literature|seminar/],
    ['teamProjects', /team|group|collaborative/],
    ['presentations', /presentation|present/],
  ];
  formatSignals.forEach(([key, pattern]) => {
    if (!pattern.test(text) || !hasNumericValue(formatPreferences[key])) return;
    const value = Number(formatPreferences[key]);
    if (value >= 8) {
      score += 2;
      reasons.push(`matches ${key} preference`);
    } else if (value <= 2) {
      score -= 3;
      reasons.push(`may not match ${key} preference`);
    }
  });

  return score;
}

async function recommendCourses(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  const profile = profileForTool(args, context);
  const maxResults = Math.max(1, Math.min(Number(args.max_results) || 5, 10));
  const maxWorkload = Number(args.max_workload) || null;
  const targetRequirements = asArray(args.target_requirements).length
    ? asArray(args.target_requirements).map(String)
    : profile.remainingReqs;
  const scheduledSet = new Set(schedule);
  const takenSet = new Set([...asArray(profile.taken).map(normalizeCourseId), ...schedule]);

  let pool = await searchCurrentCourses({
    query: '',
    maxResults: Math.max(maxResults * 8, 40),
    maxWorkload,
    requirements: targetRequirements,
  });
  if (!pool.results.length && targetRequirements.length) {
    pool = await searchCurrentCourses({
      query: '',
      maxResults: Math.max(maxResults * 8, 40),
      maxWorkload,
    });
  }

  const recommendations = pool.results
    .filter((course) => !scheduledSet.has(course.id))
    .map((course) => {
      const match = getMatch(course.id);
      const reasons = [];
      let rankScore = match.total || course.matchScore || course.searchScore || 1;

      const reqHits = asArray(course.requirements).filter((req) => targetRequirements.includes(req));
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

      if (course.totalHours && course.totalHours <= 10) {
        rankScore += 3;
        reasons.push('lighter workload');
      } else if (course.totalHours && course.totalHours >= 13) {
        reasons.push('heavier workload');
      }

      const prereqText = String(course.prerequisitesRaw || '');
      const missingPrereqs = [...prereqText.matchAll(/\b\d{1,2}\.[A-Z0-9.]+/gi)]
        .map((matchResult) => normalizeCourseId(matchResult[0]))
        .filter((id) => id && !takenSet.has(id));
      if (missingPrereqs.length) {
        rankScore -= Math.min(missingPrereqs.length, 3) * 4;
        reasons.push(`check prereqs: ${unique(missingPrereqs).join(', ')}`);
      }

      rankScore = applyPersonalizationSignals(course, rankScore, reasons, profile, schedule);

      return {
        ...currentCourseSummary(course),
        rank_score: rankScore,
        reasons,
        missingPrereqs: unique(missingPrereqs),
      };
    })
    .sort((a, b) => b.rank_score - a.rank_score || b.match_score - a.match_score || a.id.localeCompare(b.id))
    .slice(0, maxResults);

  return {
    semesterPlan: schedule,
    targetRequirements,
    recommendations,
  };
}

async function validateUiAction(action, schedule) {
  if (!action || typeof action !== 'object') {
    return { ok: false, reason: 'Action must be an object.' };
  }

  const type = action.type;
  const courseId = normalizeCourseId(action.courseId || action.course_id);
  const course = await fetchCurrentCourse(courseId);
  const currentSchedule = normalizeSchedule(schedule);

  if (!['add_course', 'remove_course', 'replace_course'].includes(type)) {
    return { ok: false, reason: `Unsupported action type: ${type || 'missing'}. Only current-semester add/remove/replace is allowed.` };
  }

  if (!course) {
    return { ok: false, reason: `Course ${courseId || 'unknown'} does not exist in the current catalog.` };
  }

  if (type === 'replace_course') {
    const removeCourseId = normalizeCourseId(action.removeCourseId || action.remove_course_id);
    if (!removeCourseId || !currentSchedule.includes(removeCourseId)) {
      return { ok: false, reason: 'replace_course requires removeCourseId that is already in the current semester plan.' };
    }
    if (currentSchedule.includes(course.id)) {
      return { ok: false, reason: `${course.id} is already in the current semester plan.` };
    }
    return {
      ok: true,
      action: { type: 'replace_course', removeCourseId, courseId: course.id },
      course: currentCourseSummary(course),
    };
  }

  if (type === 'add_course') {
    if (currentSchedule.includes(course.id)) return { ok: false, reason: `${course.id} is already in the current semester plan.` };
    return { ok: true, action: { type, courseId: course.id }, course: currentCourseSummary(course) };
  }

  if (!currentSchedule.includes(course.id)) {
    return { ok: false, reason: `${course.id} is not currently in the current semester plan.` };
  }
  return { ok: true, action: { type, courseId: course.id }, course: currentCourseSummary(course) };
}

async function validateUiActionTool(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  return validateUiAction(args.action, schedule);
}

async function sanitizeSuggestions(suggestions) {
  const ids = unique(asArray(suggestions).map(normalizeCourseId).filter(Boolean)).slice(0, 5);
  const courses = await Promise.all(ids.map(fetchCurrentCourse));
  return courses.filter(Boolean).map((course) => course.id);
}

function getCourseHistorySummary(args = {}) {
  const repo = createHistoryRepo();
  const course = repo.getCourseById(args.course_id || args.courseId);
  if (!course) return { found: false, reason: `No history record found for ${args.course_id || args.courseId || 'unknown id'}` };
  const stats = repo.getCoursePolicyStats(course.id);
  const aliases = repo.getCourseAliases(course.id);
  const offerings = repo.listCourseOfferings(course.id);
  return {
    found: true,
    course,
    aliases,
    stats: {
      offeringCount: stats.offering_count,
      homepageCount: stats.homepage_count,
      syllabusCount: stats.syllabus_count,
      attendancePolicyCount: stats.attendance_policy_count,
      gradingPolicyCount: stats.grading_policy_count,
    },
    offerings: offerings.slice(0, 8),
  };
}

function getOfferingHistory(args = {}) {
  const repo = createHistoryRepo();
  const offering = repo.getOfferingById(args.offering_id || args.offeringId);
  if (!offering) return { found: false, reason: `No history offering found for ${args.offering_id || args.offeringId || 'unknown id'}` };
  return {
    found: true,
    offering,
    documents: repo.listOfferingDocuments(offering.id),
    attendancePolicy: repo.getLatestAttendancePolicy(offering.id),
    gradingPolicy: repo.getLatestGradingPolicy(offering.id),
  };
}

const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'search_current_courses',
      description: 'Search the current MIT course catalog by id, name, description, instructor, requirements, area, and workload. Use for current-semester planning only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number' },
          areas: { type: 'array', items: { type: 'string' } },
          requirements: { type: 'array', items: { type: 'string' } },
          max_workload: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_course',
      description: 'Get normalized current catalog information for one course.',
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
      name: 'summarize_semester_plan',
      description: 'Summarize the active next-semester plan: total units, estimated workload, covered requirements, remaining profile requirements, and obvious current-semester time conflicts.',
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
      description: 'Deterministically rank current catalog courses for the active next-semester plan using match scores, requirements, workload, and profile preferences.',
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
      description: 'Validate a current-semester add/remove/replace UI action. Reject future-term, multi-semester, and roadmap mutations.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['add_course', 'remove_course', 'replace_course'] },
              courseId: { type: 'string' },
              removeCourseId: { type: 'string' },
            },
            required: ['type', 'courseId'],
          },
          schedule: { type: 'array', items: { type: 'string' } },
        },
        required: ['action', 'schedule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_course_history_summary',
      description: 'Get read-only historical offering and policy coverage summary for one course. Use as context or risk signal; do not use it to mutate a plan.',
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
      name: 'get_offering_history',
      description: 'Get read-only historical documents, attendance policy, and grading policy for one offering id.',
      parameters: {
        type: 'object',
        properties: {
          offering_id: { type: 'number' },
        },
        required: ['offering_id'],
      },
    },
  },
];

const toolHandlers = {
  search_courses: searchCurrentCoursesTool,
  get_course: getCurrentCourseTool,
  summarize_schedule: summarizeSemesterPlan,
  search_current_courses: searchCurrentCoursesTool,
  get_current_course: getCurrentCourseTool,
  summarize_semester_plan: summarizeSemesterPlan,
  recommend_courses: recommendCourses,
  validate_ui_action: validateUiActionTool,
  get_course_history_summary: getCourseHistorySummary,
  get_offering_history: getOfferingHistory,
};

module.exports = {
  asArray,
  currentCourseSummary,
  getCourse,
  getCurrentCourseTool,
  getMatch,
  mockData,
  normalizeProfile,
  normalizeSchedule,
  recommendCourses,
  resolveCurrentCourseSummary,
  sanitizeSuggestions,
  searchCurrentCoursesTool,
  summarizeSemesterPlan,
  toolHandlers,
  toolSchemas,
  validateUiAction,
};
