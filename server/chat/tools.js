const mockData = require('../../shared/mock-data.js');
const { summarize: summarizePersonalCourse } = require('../../shared/personal-course');
const { fetchCurrentCourse, searchCurrentCourses } = require('../current/fireroad');
const { normalizeCourseId } = require('../current/normalize');
const { createHistoryRepo } = require('../history/repo');
const { checkMajorRequirements, getRequirementGroupCourses, getCourseRequirementGroups, resolveMajorKey } = require('../requirements');
const mostTaken = require('../../data/most_taken.json');

const asArray = (value) => (Array.isArray(value) ? value : []);
const unique = (items) => [...new Set(items)];
const policySignalCache = new Map();

// Return the most relevant course departments for a given major so searches
// don't scan all 5000+ courses unnecessarily.
function majorToDepartments(major) {
  const code = String(major || '').replace(/^course\s+/i, '').replace(/^major/i, '').trim().split(/[:\s]/)[0].toLowerCase();
  if (code.startsWith('6')) return ['6', '18', '8'];
  if (code === '18') return ['18', '6', '8'];
  if (code === '8') return ['8', '18', '6'];
  if (code === '16') return ['16', '6', '18'];
  if (code === '2') return ['2', '6', '18'];
  return [];
}

function yearKey(year) {
  const map = { freshman: 'Y1', sophomore: 'Y2', junior: 'Y3', senior: 'Y4' };
  return map[String(year || '').toLowerCase()] || null;
}

function mostTakenScore(courseId, profile) {
  const majorRaw = String(profile.major || '').replace(/^course\s+/i, '').trim();
  const majorCode = majorRaw.split(/[:\s]/)[0].toLowerCase();
  const yk = yearKey(profile.year);
  const majorData = mostTaken[majorCode];
  if (!majorData || !yk) return 0;
  const yearData = majorData[yk] || [];
  const idx = yearData.findIndex(([id]) => normalizeCourseId(id) === normalizeCourseId(courseId));
  if (idx < 0) return 0;
  return Math.max(0, 20 - idx * 4);
}

const getCourse = (id) => {
  const normalized = normalizeCourseId(id);
  return mockData.catalog.find((course) => normalizeCourseId(course.id) === normalized);
};

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
    ...incoming,
    taken: asArray(incoming.taken).map(normalizeCourseId).filter(Boolean),
    remainingReqs: asArray(incoming.remainingReqs).map(String).filter(Boolean),
    preferences: {
      ...(incoming.preferences || {}),
    },
  };
}

function personalSummaryFromContext(context = {}) {
  return summarizePersonalCourse(context.personalCourseMarkdown || '');
}

function completedCourseIds(profile = {}, personal = { completedCourseIds: [] }) {
  return unique([
    ...asArray(profile.taken).map(normalizeCourseId),
    ...asArray(personal.completedCourseIds).map(normalizeCourseId),
  ].filter(Boolean));
}

function requirementStatusForProfile(profile = {}, courseIds = []) {
  const majorKey = resolveMajorKey(profile.majorKey || profile.major);
  const checked = checkMajorRequirements(profile.majorKey || profile.major, courseIds);
  if (!majorKey || !checked) {
    return {
      available: false,
      majorKey,
      title: profile.major || '',
      satisfiedCount: 0,
      totalCount: 0,
      groups: [],
      unsatisfiedGroups: [],
      unmetCourseIds: [],
    };
  }
  const unsatisfiedGroups = asArray(checked.groups)
    .filter((group) => !group.satisfied)
    .map((group) => ({
      id: group.id,
      label: group.label,
      progress: group.progress,
      unmet: asArray(group.unmet).slice(0, 8),
      isManual: Boolean(group.isManual),
      subGroups: asArray(group.subGroups)
        .filter((sub) => !sub.satisfied)
        .map((sub) => ({
          id: sub.id,
          label: sub.label,
          progress: sub.progress,
          unmet: asArray(sub.unmet).slice(0, 5),
          isManual: Boolean(sub.isManual),
        })),
    }));
  return {
    available: true,
    majorKey,
    title: checked.title,
    fullTitle: checked.fullTitle,
    satisfiedCount: checked.satisfiedCount,
    totalCount: checked.totalCount,
    groups: checked.groups,
    unsatisfiedGroups,
    unmetCourseIds: unique(unsatisfiedGroups.flatMap((group) => [
      ...asArray(group.unmet),
      ...asArray(group.subGroups).flatMap((sub) => asArray(sub.unmet)),
    ].map(normalizeCourseId)).filter(Boolean)),
  };
}

function compactPersonalization(profile = {}) {
  const personalization = profile.preferences && profile.preferences.personalization;
  if (!personalization || typeof personalization !== 'object') return null;
  return {
    workload: personalization.workload || {},
    commitments: personalization.commitments || {},
    topicRatings: personalization.topicRatings || {},
    formatPreferences: personalization.formatPreferences || {},
    desiredCoursesPerDirection: personalization.desiredCoursesPerDirection || {},
    freeformNotes: personalization.freeformNotes || '',
    progress: personalization.progress || {},
  };
}

function buildStudentPlanningContext(context = {}) {
  const profile = normalizeProfile(context.profile || {});
  const personal = personalSummaryFromContext(context);
  const completed = completedCourseIds(profile, personal);
  const schedule = normalizeSchedule(context.schedule);
  const allCoursesForRequirements = unique([...completed, ...schedule]);
  const requirementStatus = requirementStatusForProfile(profile, allCoursesForRequirements);

  return {
    profile: {
      name: profile.name || '',
      major: profile.major || '',
      majorLabel: profile.majorLabel || '',
      year: profile.year || '',
      gradYear: profile.gradYear || '',
    },
    activeSemester: {
      activeSem: context.activeSem || null,
      label: context.planningTermLabel || null,
      schedule,
    },
    courseHistory: {
      completedCourseIds: completed,
      listenerCourseIds: asArray(personal.listenerCourseIds),
      droppedCourseIds: asArray(personal.droppedCourseIds),
      completedPlan: personal.completedPlan || {},
      coursePreferences: personal.coursePreferences || {},
      counts: {
        completed: asArray(personal.completedCourses).length,
        listener: asArray(personal.listenerCourses).length,
        dropped: asArray(personal.droppedCourses).length,
      },
    },
    personalization: compactPersonalization(profile),
    requirementStatus: {
      available: requirementStatus.available,
      majorKey: requirementStatus.majorKey,
      title: requirementStatus.title,
      satisfiedCount: requirementStatus.satisfiedCount,
      totalCount: requirementStatus.totalCount,
      unsatisfiedGroups: asArray(requirementStatus.unsatisfiedGroups).slice(0, 12),
      unmetCourseIds: asArray(requirementStatus.unmetCourseIds).slice(0, 40),
    },
  };
}

function isNearGraduation(profile = {}) {
  const year = String(profile.year || '').toLowerCase();
  const gradYear = Number(profile.gradYear);
  const currentYear = new Date().getFullYear();
  return year.includes('senior') || year.includes('meng') || (Number.isFinite(gradYear) && gradYear <= currentYear + 1);
}

function workloadPlanForProfile(profile = {}, schedule = []) {
  const personalization = profile.preferences && profile.preferences.personalization
    ? profile.preferences.personalization
    : {};
  const workload = personalization.workload || {};
  const commitments = personalization.commitments || {};
  const challenge = String(workload.challengePreference || '').toLowerCase();
  const weeklyBudget = Number(workload.weeklyCourseHoursBudget);
  let level = 'medium';

  if (/low|light|lighter|gentle|gentler|easy/.test(challenge)) level = 'low';
  if (/high|heavy|push|challenge|hard|cracked/.test(challenge)) level = 'high';
  if (/medium|moderate|balanced/.test(challenge)) level = 'medium';

  const commitmentHours = commitmentCount(commitments) * 4;
  const defaultTargetHours = level === 'low' ? 28 : level === 'high' ? 48 : 36;
  const targetHours = Math.max(12, Number.isFinite(weeklyBudget) && weeklyBudget > 0
    ? weeklyBudget - commitmentHours
    : defaultTargetHours - commitmentHours);
  const existingCount = normalizeSchedule(schedule).length;
  const maxCoursesBeforeSchedule = level === 'low' ? 3 : level === 'high' ? 4 : 3;
  const maxTechnicalBeforeSchedule = level === 'low' ? 2 : level === 'high' ? 4 : 3;

  return {
    level,
    targetHours: Number(targetHours.toFixed(1)),
    maxCourses: Math.max(1, maxCoursesBeforeSchedule - existingCount),
    maxTechnicalCourses: maxTechnicalBeforeSchedule,
    hasExplicitWeeklyBudget: Number.isFinite(weeklyBudget) && weeklyBudget > 0,
  };
}

function technicalCourseCount(courseIds = []) {
  return normalizeSchedule(courseIds).filter((id) => isTechnicalCourseId(id)).length;
}

function isTechnicalCourseId(courseId) {
  return /^(1|2|3|4|5|6|8|9|10|12|16|18|20|22|24)\./.test(normalizeCourseId(courseId) || '');
}

function isTechnicalCourse(course = {}) {
  return isTechnicalCourseId(course.id) || ['cs', 'eng', 'science', 'math'].includes(String(course.area || '').toLowerCase());
}

function ratingOnSeven(course = {}) {
  const value = Number(course.rating && course.rating.value);
  const scale = Number(course.rating && course.rating.scale);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (Number.isFinite(scale) && scale > 0 && scale !== 7) return (value / scale) * 7;
  return value;
}

function getPolicySignals(courseId) {
  const normalized = normalizeCourseId(courseId);
  if (policySignalCache.has(normalized)) return policySignalCache.get(normalized);
  try {
    const repo = createHistoryRepo();
    const offerings = repo.listCourseOfferings(normalized);
    const latestOffering = offerings[0];
    const latestAttendance = latestOffering ? repo.getLatestAttendancePolicy(latestOffering.id) : null;
    const latestGrading = latestOffering ? repo.getLatestGradingPolicy(latestOffering.id) : null;
    const stats = repo.getCoursePolicyStats(normalized);
    const result = { stats, latestAttendance, latestGrading };
    policySignalCache.set(normalized, result);
    return result;
  } catch (error) {
    const result = { stats: null, latestAttendance: null, latestGrading: null };
    policySignalCache.set(normalized, result);
    return result;
  }
}

function applyEvaluationSignals(course, score, reasons, profile = {}) {
  const personalization = profile.preferences && profile.preferences.personalization
    ? profile.preferences.personalization
    : {};
  const workload = personalization.workload || {};
  const gradingPreferences = personalization.gradingPreferences || {};
  const attendanceConcern = String(workload.attendanceImportance || '').toLowerCase();
  const gradingConcern = String(workload.gradingImportance || '').toLowerCase();
  const caresAboutAttendance = attendanceConcern === 'low';
  const caresAboutGrading = gradingConcern === 'high'
    || gradingPreferences.preferLenientGrading === true
    || gradingPreferences.avoidHarshCurves === true
    || gradingPreferences.preferClearRubrics === true;
  const text = courseText(course);
  const policies = getPolicySignals(course.id);

  if (caresAboutAttendance) {
    const attendanceHeavyText = /attendance required|attendance mandatory|participation|recitation required|in-person|lab attendance|studio|presentation/.test(text);
    const latestAttendance = policies.latestAttendance || {};
    const required = String(latestAttendance.attendanceRequired || '').toLowerCase();
    const counts = String(latestAttendance.attendanceCountsTowardGrade || '').toLowerCase();
    if (required === 'yes' || counts === 'yes' || attendanceHeavyText) {
      score -= 14;
      reasons.push('attendance-heavy risk for your preference');
    } else if (policies.stats && Number(policies.stats.attendance_policy_count) > 0) {
      score += 3;
      reasons.push('no strong attendance-heavy signal found');
    } else {
      score -= 2;
      reasons.push('attendance policy uncertain');
    }
  }

  if (caresAboutGrading) {
    const rating = ratingOnSeven(course);
    const latestGrading = policies.latestGrading || {};
    const participationWeight = Number(latestGrading.participationWeight);
    const quizWeight = Number(latestGrading.quizWeight);
    const hasClearPolicy = policies.stats && Number(policies.stats.grading_policy_count) > 0;
    if (Number.isFinite(rating)) {
      if (rating >= 5.6) {
        score += 8;
        reasons.push('strong Fireroad rating for grading-sensitive preference');
      } else if (rating < 4.8) {
        score -= 16;
        reasons.push('lower Fireroad rating conflicts with grading priority');
      } else {
        score -= 4;
        reasons.push('grading fit is not clearly strong');
      }
    }
    if (hasClearPolicy) {
      score += 2;
      reasons.push('grading policy evidence available');
    } else {
      score -= 3;
      reasons.push('grading policy uncertain');
    }
    if ((Number.isFinite(participationWeight) && participationWeight >= 10) || (Number.isFinite(quizWeight) && quizWeight >= 25)) {
      score -= 5;
      reasons.push('grading structure may be less forgiving');
    }
  }

  return score;
}

function scheduleForTool(args = {}, context = {}) {
  const candidate = Array.isArray(args.schedule) && args.schedule.length ? args.schedule : context.schedule;
  return normalizeSchedule(candidate);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base = {}, override = {}) {
  const result = { ...(isPlainObject(base) ? base : {}) };
  Object.entries(isPlainObject(override) ? override : {}).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  });
  return result;
}

function profileForTool(args = {}, context = {}) {
  const contextProfile = context.profile && typeof context.profile === 'object' ? context.profile : {};
  const argProfile = args.profile && typeof args.profile === 'object' ? args.profile : {};
  const contextPersonalization = contextProfile.preferences && contextProfile.preferences.personalization;
  const merged = deepMerge(contextProfile, argProfile);
  if (contextPersonalization && typeof contextPersonalization === 'object') {
    merged.preferences = {
      ...(merged.preferences || {}),
      personalization: contextPersonalization,
    };
  }
  return normalizeProfile(merged);
}

function currentCourseSummary(course) {
  if (!course) return null;
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

function conflictScheduleLabel(course) {
  return course.scheduleDisplay || course.scheduleRaw || course.schedule || 'Schedule TBD';
}

function detectConflicts(courses = []) {
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
          schedules: [conflictScheduleLabel(a), conflictScheduleLabel(b)],
        });
      }
    }
  }
  return conflicts;
}

async function summarizeSemesterPlan(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  const profile = profileForTool(args, context);
  const personal = personalSummaryFromContext(context);
  const completed = completedCourseIds(profile, personal);
  const requirementStatus = requirementStatusForProfile(profile, unique([...completed, ...schedule]));
  const courses = (await Promise.all(schedule.map(fetchCurrentCourse))).filter(Boolean);
  const coveredSet = new Set();

  courses.forEach((course) => {
    asArray(course.requirements).forEach((req) => coveredSet.add(req));
  });

  const coveredRequirements = [...coveredSet].sort();
  const completedBeforeSchedule = requirementStatus.available
    ? requirementStatus.groups.filter((group) => group.satisfied).map((group) => group.label)
    : [];
  const remainingRequirements = requirementStatus.available
    ? requirementStatus.unsatisfiedGroups.map((group) => group.label)
    : profile.remainingReqs.filter((req) => !coveredSet.has(req));
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
    degreeRequirements: {
      available: requirementStatus.available,
      title: requirementStatus.title,
      satisfiedCount: requirementStatus.satisfiedCount,
      totalCount: requirementStatus.totalCount,
      unsatisfiedGroups: requirementStatus.unsatisfiedGroups,
      unmetCourseIds: requirementStatus.unmetCourseIds,
    },
    conflicts: detectConflicts(courses),
  };
}

async function searchCurrentCoursesTool(args = {}, context = {}) {
  const result = await searchCurrentCourses({
    query: args.query || '',
    maxResults: args.max_results || 8,
    areas: args.areas,
    requirements: args.requirements || args.satisfies,
    maxWorkload: args.max_workload,
    departments: args.departments,
    semester: context.activeSem || '',
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

function applyPersonalizationSignals(course, rankScore, reasons, profile, schedule, personalizationReasons = []) {
  const personalization = profile.preferences && profile.preferences.personalization;
  if (!personalization || typeof personalization !== 'object') return rankScore;

  let score = rankScore;
  const addReason = (reason) => {
    reasons.push(reason);
    personalizationReasons.push(reason);
  };
  const topicRatings = personalization.topicRatings || {};
  Object.entries(topicRatings).forEach(([topic, ratings]) => {
    if (!ratings || !topicMatchesCourse(topic, course)) return;
    const interest = Number(ratings.interest);
    const skill = Number(ratings.skill);
    if (Number.isFinite(interest)) {
      if (interest >= 8) {
        score += 14;
        addReason(`high interest in ${topic}`);
      } else if (interest <= 2) {
        score -= 16;
        addReason(`low interest in ${topic}`);
      }
    }
    if (Number.isFinite(skill)) {
      if (skill >= 7) {
        score += 5;
        addReason(`strong self-rated ${topic} preparation`);
      } else if (skill <= 3) {
        score -= 6;
        addReason(`may need ramp-up in ${topic}`);
      }
    }
  });

  const workload = personalization.workload || {};
  const workloadPlan = workloadPlanForProfile(profile, schedule);
  if (course.totalHours) {
    const perCourseComfort = workloadPlan.targetHours / Math.max(workloadPlan.maxCourses + schedule.length, 1);
    if (course.totalHours > perCourseComfort + 5) {
      score -= workloadPlan.level === 'high' ? 5 : 14;
      addReason('large share of stated weekly workload budget');
    } else if (course.totalHours <= perCourseComfort + 1) {
      score += 7;
      addReason('fits stated weekly workload budget');
    }
  }

  const challenge = String(workload.challengePreference || '').toLowerCase();
  if (challenge.includes('high') && course.totalHours >= 12) {
    score += 5;
    addReason('matches high challenge preference');
  }
  if ((challenge.includes('low') || challenge.includes('lighter')) && course.totalHours >= 12) {
    score -= 10;
    addReason('may be too challenging for stated preference');
  }

  score = applyEvaluationSignals(course, score, reasons, profile);

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
      score += 6;
      addReason(`matches ${key} preference`);
    } else if (value <= 2) {
      score -= 7;
      addReason(`may not match ${key} preference`);
    }
  });

  return score;
}

function personalizationEvidence(profile = {}, personalCourseMarkdown = '') {
  const personalization = profile.preferences && profile.preferences.personalization;
  const reasons = [];
  if (personalization && typeof personalization === 'object') {
    if (Object.keys(personalization.topicRatings || {}).length) reasons.push('topic ratings');
    if (Object.keys(personalization.formatPreferences || {}).length) reasons.push('format preferences');
    if (personalization.workload && Object.values(personalization.workload).some((value) => value !== null && value !== undefined && value !== '')) reasons.push('workload preferences');
    if (personalization.gradingPreferences && Object.values(personalization.gradingPreferences).some((value) => value !== null && value !== undefined)) reasons.push('grading preferences');
    if (String(personalization.freeformNotes || '').trim()) reasons.push('freeform notes');
  }
  if (String(personalCourseMarkdown || '').trim()) reasons.push('personal_course.md');
  return unique(reasons);
}

function courseLooksLikePreference(course, personalCourseMarkdown) {
  const userText = String(personalCourseMarkdown || '').toLowerCase();
  const text = courseText(course);
  let score = 0;
  if (/machine learning|deep learning|\bml\b|artificial intelligence|\bai\b/.test(userText) && isMlCourse(course)) score += 8;
  if (/systems?|operating system|network|database|compiler|architecture/.test(userText) && /system|network|database|compiler|architecture/.test(text)) score += 6;
  if (/theory|proof|algorithm|complexity/.test(userText) && isTheoryCourse(course)) score += 6;
  if (/linear algebra|probability|statistics|optimization/.test(userText) && /linear algebra|probability|statistics|optimization/.test(text)) score += 5;
  return score;
}

async function recommendCourses(args = {}, context = {}) {
  const schedule = scheduleForTool(args, context);
  const profile = profileForTool(args, context);
  const workloadPlan = workloadPlanForProfile(profile, schedule);
  const mode = ['preference_first', 'requirement_first', 'balanced'].includes(args.mode)
    ? args.mode
    : 'balanced';
  const requestedMaxResults = Math.max(1, Math.min(Number(args.max_results) || workloadPlan.maxCourses, 10));
  const maxResults = Math.max(1, Math.min(requestedMaxResults, workloadPlan.maxCourses));
  const requestedCourseWorkload = Number(args.max_workload);
  const maxWorkload = Number.isFinite(requestedCourseWorkload) && requestedCourseWorkload > 0 && requestedCourseWorkload <= 25
    ? requestedCourseWorkload
    : null;
  const personal = personalSummaryFromContext(context);
  const completed = completedCourseIds(profile, personal);
  const requirementStatus = requirementStatusForProfile(profile, unique([...completed, ...schedule]));
  const targetRequirements = asArray(args.target_requirements).length
    ? asArray(args.target_requirements).map(String)
    : requirementStatus.unsatisfiedGroups.map((group) => group.label);
  const unmetCourseIds = asArray(requirementStatus.unmetCourseIds).map(normalizeCourseId);
  const scheduledSet = new Set(schedule);
  const takenSet = new Set([...completed, ...schedule]);
  const nearGraduation = isNearGraduation(profile);
  const scheduledCourses = (await Promise.all(schedule.map(fetchCurrentCourse))).filter(Boolean);
  const scheduledHours = scheduledCourses.reduce((total, course) => total + (Number(course.totalHours) || 0), 0);

  const departments = asArray(args.departments).length
    ? asArray(args.departments)
    : majorToDepartments(profile.major);

  let pool = await searchCurrentCourses({
    query: '',
    maxResults: Math.max(maxResults * 10, 50),
    maxWorkload,
    requirements: targetRequirements,
    departments,
  });
  if (!pool.results.length && targetRequirements.length) {
    pool = await searchCurrentCourses({
      query: '',
      maxResults: Math.max(maxResults * 8, 40),
      maxWorkload,
      departments,
    });
  }
  const exactUnmetCourses = (await Promise.all(unmetCourseIds.slice(0, 40).map(fetchCurrentCourse))).filter(Boolean);
  const poolById = new Map();
  [...exactUnmetCourses, ...pool.results].forEach((course) => {
    if (course && course.id && !poolById.has(course.id)) poolById.set(course.id, course);
  });

  const scored = [...poolById.values()]
    .filter((course) => !scheduledSet.has(course.id) && !takenSet.has(course.id))
    .map((course) => {
      const reasons = [];
      const searchScore = Number(course.searchScore);
      let rankScore = Number.isFinite(searchScore) && searchScore > 0 ? searchScore : 20;

      const exactRequirementHit = unmetCourseIds.includes(course.id);
      if (exactRequirementHit) {
        rankScore += mode === 'preference_first' ? (nearGraduation ? 70 : 50) : (nearGraduation ? 95 : 75);
        reasons.push('listed as unmet in your degree requirements');
      }

      const reqHits = asArray(course.requirements).filter((req) => targetRequirements.includes(req));
      if (reqHits.length) {
        rankScore += reqHits.length * (mode === 'preference_first' ? 8 : 14);
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

      const mtScore = mostTakenScore(course.id, profile);
      if (mtScore > 0) {
        rankScore += mtScore;
        reasons.push('popular among similar students');
      }

      const personalizationReasons = [];
      const beforePersonalizationScore = rankScore;
      rankScore = applyPersonalizationSignals(course, rankScore, reasons, profile, schedule, personalizationReasons);
      if (mode === 'preference_first') {
        rankScore += (rankScore - beforePersonalizationScore) * 0.35;
      } else if (mode === 'requirement_first') {
        rankScore -= Math.max(0, rankScore - beforePersonalizationScore) * 0.2;
      }
      const preferenceScore = courseLooksLikePreference(course, context.personalCourseMarkdown);
      if (preferenceScore) {
        rankScore += preferenceScore * (mode === 'requirement_first' ? 0.75 : 1.5);
        reasons.push('matches signals from personal_course.md');
        personalizationReasons.push('matches signals from personal_course.md');
      }

      return {
        ...currentCourseSummary(course),
        rank_score: rankScore,
        reasons,
        personalizationReasons: unique(personalizationReasons),
        missingPrereqs: unique(missingPrereqs),
      };
    })
    .sort((a, b) => b.rank_score - a.rank_score || a.id.localeCompare(b.id));

  const recommendations = [];
  let plannedHours = scheduledHours;
  let plannedTechnicalCount = technicalCourseCount(schedule);
  const workloadAllowance = workloadPlan.level === 'high' ? 8 : workloadPlan.level === 'low' ? 2 : 4;
  for (const candidate of scored) {
    if (recommendations.length >= maxResults) break;
    const hours = Number(candidate.workload_hours_per_week) || 12;
    const technical = isTechnicalCourse(candidate);
    const exactRequirementHit = unmetCourseIds.includes(candidate.id);
    const wouldExceedHours = plannedHours + hours > workloadPlan.targetHours + workloadAllowance;
    const wouldExceedTechnical = technical && plannedTechnicalCount >= workloadPlan.maxTechnicalCourses;

    if (wouldExceedTechnical && !exactRequirementHit) continue;
    if (wouldExceedHours && recommendations.length >= 1 && !(exactRequirementHit && recommendations.length < 2)) continue;

    const nextCandidate = {
      ...candidate,
      reasons: [...candidate.reasons],
    };
    if (!wouldExceedHours) {
      nextCandidate.reasons.push(`keeps ${workloadPlan.level} workload near budget`);
    } else {
      nextCandidate.reasons.push('important requirement, but pushes stated workload budget');
    }
    if (technical && plannedTechnicalCount + 1 >= workloadPlan.maxTechnicalCourses) {
      nextCandidate.reasons.push('technical-course count capped by workload preference');
    }
    recommendations.push(nextCandidate);
    plannedHours += hours;
    if (technical) plannedTechnicalCount += 1;
  }

  if (!recommendations.length) {
    scored.slice(0, maxResults).forEach((candidate) => {
      recommendations.push({
        ...candidate,
        reasons: [...candidate.reasons, 'best available match, but workload fit needs review'],
      });
    });
    plannedHours = scheduledHours + recommendations.reduce((total, course) => total + (Number(course.workload_hours_per_week) || 0), 0);
    plannedTechnicalCount = technicalCourseCount([...schedule, ...recommendations.map((course) => course.id)]);
  }

  return {
    semesterPlan: schedule,
    mode,
    personalizationUsed: personalizationEvidence(profile, context.personalCourseMarkdown).length > 0,
    personalizationReasons: personalizationEvidence(profile, context.personalCourseMarkdown),
    semesterPlanSummary: {
      workloadPreference: workloadPlan.level,
      targetWeeklyHours: workloadPlan.targetHours,
      existingWeeklyHours: Number(scheduledHours.toFixed(1)),
      addedWeeklyHours: Number((plannedHours - scheduledHours).toFixed(1)),
      projectedWeeklyHours: Number(plannedHours.toFixed(1)),
      recommendedCount: recommendations.length,
      technicalCourseCount: plannedTechnicalCount,
      warnings: [
        plannedHours > workloadPlan.targetHours + workloadAllowance
          ? `Projected weekly workload (${plannedHours.toFixed(1)}h) exceeds ${workloadPlan.level} target (${workloadPlan.targetHours}h).`
          : null,
        recommendations.length < requestedMaxResults
          ? `Returned ${recommendations.length} courses because workload preferences capped the semester bundle.`
          : null,
      ].filter(Boolean),
    },
    targetRequirements,
    degreeRequirements: {
      available: requirementStatus.available,
      title: requirementStatus.title,
      satisfiedCount: requirementStatus.satisfiedCount,
      totalCount: requirementStatus.totalCount,
      unsatisfiedGroups: requirementStatus.unsatisfiedGroups.slice(0, 8),
      unmetCourseIds: requirementStatus.unmetCourseIds.slice(0, 30),
    },
    completedCourseIds: completed,
    recommendations,
  };
}

async function getRequirementCoursesTool(args = {}, context = {}) {
  const profile = profileForTool(args, context);
  const major = args.major || profile.major;
  const groupQuery = String(args.group || '').trim();
  const intersectQuery = String(args.intersect_with || '').trim();

  if (!groupQuery) return { found: false, reason: 'group parameter is required' };

  const matches = getRequirementGroupCourses(major, groupQuery);
  if (!matches || !matches.length) {
    return { found: false, reason: `No requirement group matching "${groupQuery}" found in ${major}` };
  }

  let courseIds = [...new Set(matches.flatMap((m) => m.courses))];
  let intersectGroups = null;

  if (intersectQuery) {
    const intersectMatches = getRequirementGroupCourses(major, intersectQuery);
    if (intersectMatches && intersectMatches.length) {
      const intersectSet = new Set(intersectMatches.flatMap((m) => m.courses));
      courseIds = courseIds.filter((id) => intersectSet.has(id));
      intersectGroups = intersectMatches.map((m) => m.title);
    }
  }

  const courses = (await Promise.all(courseIds.map(fetchCurrentCourse))).filter(Boolean);
  const takenSet = new Set([...asArray(profile.taken).map(normalizeCourseId)]);

  return {
    found: true,
    major,
    matchedGroups: matches.map((m) => m.title),
    intersectGroup: intersectQuery || null,
    intersectMatchedGroups: intersectGroups,
    totalInRequirementJson: courseIds.length,
    catalogCourses: courses.map((c) => ({
      ...currentCourseSummary(c),
      alreadyTaken: takenSet.has(c.id),
    })),
    notInCurrentCatalog: courseIds.filter((id) => !courses.some((c) => normalizeCourseId(c.id) === normalizeCourseId(id))),
  };
}

async function courseRequirementGroupsTool(args = {}, context = {}) {
  const profile = profileForTool(args, context);
  const major = args.major || profile.major;
  const courseId = normalizeCourseId(args.course_id || '');
  if (!courseId) return { found: false, reason: 'course_id is required' };

  const groups = getCourseRequirementGroups(major, courseId);
  if (!groups) return { found: false, reason: `No requirement data for major: ${major}` };

  const course = await fetchCurrentCourse(courseId);
  return {
    found: true,
    courseId,
    courseName: course ? course.name : null,
    major,
    satisfiedGroups: groups,
    satisfiesCount: groups.length,
    note: groups.length === 0 ? `${courseId} does not appear in any named requirement group for ${major}` : null,
  };
}

function checkRequirementsTool(args = {}, context = {}) {
  const profile = profileForTool(args, context);
  const schedule = scheduleForTool(args, context);
  const allCourses = unique([...asArray(profile.taken).map(normalizeCourseId), ...schedule]);
  const result = checkMajorRequirements(args.major || profile.major, allCourses);
  if (!result) {
    return { found: false, reason: `No requirement data for major: ${args.major || profile.major || 'unknown'}` };
  }
  return { found: true, ...result };
}

async function checkScheduleConflictsTool(args = {}, context = {}) {
  const courseIds = asArray(args.course_ids).length ? asArray(args.course_ids) : scheduleForTool(args, context);
  const courses = (await Promise.all(courseIds.map(fetchCurrentCourse))).filter(Boolean);
  const conflicts = [];
  for (let i = 0; i < courses.length; i += 1) {
    for (let j = i + 1; j < courses.length; j += 1) {
      const a = courses[i];
      const b = courses[j];
      if (!hasTime(a) || !hasTime(b)) continue;
      const sharedDays = a.days.filter((d) => b.days.includes(d));
      if (!sharedDays.length) continue;
      const start = Math.max(a.time.start, b.time.start);
      const end = Math.min(a.time.end, b.time.end);
      if (start < end) {
        conflicts.push({
          courses: [a.id, b.id],
          courseNames: [a.name, b.name],
          days: sharedDays,
          overlap: { start, end },
          schedules: [a.scheduleDisplay, b.scheduleDisplay],
        });
      }
    }
  }
  return {
    checkedCourses: courses.map((c) => ({ id: c.id, name: c.name, days: c.days, time: c.time, schedule: c.scheduleDisplay })),
    conflictCount: conflicts.length,
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}

function checkDegreeRequirementsTool(args = {}, context = {}) {
  const profile = profileForTool(args, context);
  const personal = personalSummaryFromContext(context);
  const schedule = scheduleForTool(args, context);
  const courses = asArray(args.courses).length
    ? asArray(args.courses).map(normalizeCourseId)
    : unique([...completedCourseIds(profile, personal), ...schedule]);
  return requirementStatusForProfile(profile, courses);
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
      description: 'Search the current MIT course catalog by id, name, description, instructor, requirements, area, and workload. Use departments to limit to relevant course numbers (e.g. ["6","18"] for EECS students) — critical with a large catalog.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number' },
          areas: { type: 'array', items: { type: 'string' }, description: 'Area names: "cs", "math", "physics", "bio", "hass", "other". NOT department numbers.' },
          requirements: { type: 'array', items: { type: 'string' } },
          max_workload: { type: 'number' },
          departments: { type: 'array', items: { type: 'string' }, description: 'Filter to courses starting with these prefixes, e.g. ["6","18","8"]. Strongly recommended to avoid irrelevant results from 5000+ course catalog.' },
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
      description: 'Build a workload-aware active-semester recommendation bundle using personal_course.md, further personalization, completed courses, current schedule, grading/attendance preferences, degree requirement status, and major department filters.',
      parameters: {
        type: 'object',
        properties: {
          schedule: { type: 'array', items: { type: 'string' } },
          profile: { type: 'object' },
          max_results: { type: 'number' },
          max_workload: { type: 'number' },
          mode: {
            type: 'string',
            enum: ['preference_first', 'requirement_first', 'balanced'],
            description: 'Ranking strategy. preference_first emphasizes saved preferences when requirements are flexible; requirement_first prioritizes unmet requirements; balanced is the default.',
          },
          target_requirements: { type: 'array', items: { type: 'string' } },
          departments: { type: 'array', items: { type: 'string' }, description: 'Override department filter, e.g. ["6","18"]. Defaults to major-appropriate departments.' },
        },
        required: ['schedule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_degree_requirements',
      description: 'Check the student major requirements against completed personal_course.md courses plus the active semester schedule.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'object' },
          courses: { type: 'array', items: { type: 'string' } },
        },
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
      name: 'course_satisfies',
      description: 'Look up which named requirement groups a specific course satisfies within a major\'s requirement tree. Use when the user asks "what does 6.3900 satisfy?" or "does this course count for anything?"',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'string', description: 'Course ID, e.g. "6.3900"' },
          major: { type: 'string', description: 'Override major. Defaults to profile major.' },
        },
        required: ['course_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_requirement_courses',
      description: 'Look up which courses satisfy a named requirement group (e.g. "Data Centric", "Human Centric", "Fundamentals") within a major\'s JSON requirement tree. Use intersect_with to find courses that satisfy two groups at once.',
      parameters: {
        type: 'object',
        properties: {
          group: { type: 'string', description: 'Partial or full name of the requirement group, e.g. "data", "human centric", "CI-M"' },
          major: { type: 'string', description: 'Override major (e.g. "Course 6-4"). Defaults to profile major.' },
          intersect_with: { type: 'string', description: 'Second group name — returns only courses that satisfy BOTH groups.' },
        },
        required: ['group'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_requirements',
      description: 'Check major requirement progress for the student. Returns satisfied/unsatisfied groups with course gaps. Call this at the start of any planning or recommendation conversation to understand what requirements remain.',
      parameters: {
        type: 'object',
        properties: {
          major: { type: 'string', description: 'Override major, e.g. "Course 6-3". Defaults to profile major.' },
          schedule: { type: 'array', items: { type: 'string' } },
          profile: { type: 'object' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_schedule_conflicts',
      description: 'Check for time conflicts among a list of courses using real current catalog schedule data.',
      parameters: {
        type: 'object',
        properties: {
          course_ids: { type: 'array', items: { type: 'string' }, description: 'Course IDs to check. Defaults to active semester schedule.' },
        },
        required: [],
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
  check_degree_requirements: checkDegreeRequirementsTool,
  validate_ui_action: validateUiActionTool,
  course_satisfies: courseRequirementGroupsTool,
  get_requirement_courses: getRequirementCoursesTool,
  check_requirements: checkRequirementsTool,
  check_schedule_conflicts: checkScheduleConflictsTool,
  get_course_history_summary: getCourseHistorySummary,
  get_offering_history: getOfferingHistory,
};

module.exports = {
  asArray,
  buildStudentPlanningContext,
  checkDegreeRequirementsTool,
  currentCourseSummary,
  getCourse,
  getCurrentCourseTool,
  majorToDepartments,
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
