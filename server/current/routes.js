const express = require('express');
const { summarize } = require('../../shared/personal-course');
const { fetchCurrentCourse, getCurrentCatalog, searchCurrentCourses } = require('./fireroad');
const { normalizeCourseId } = require('./normalize');

const router = express.Router();

function asyncHandler(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error('[current error]', error);
      res.status(500).json({ error: error.message || 'Current course API error' });
    });
  };
}

router.get('/course/:courseId', asyncHandler(async (req, res) => {
  const course = await fetchCurrentCourse(req.params.courseId);
  if (!course) return res.status(404).json({ error: `Course ${req.params.courseId} not found in current catalog.` });
  res.json({ course });
}));

router.get('/search', asyncHandler(async (req, res) => {
  const result = await searchCurrentCourses({
    query: req.query.q || '',
    maxResults: req.query.max_results,
  });
  res.json(result);
}));

router.get('/catalog', asyncHandler(async (req, res) => {
  const catalog = await getCurrentCatalog();
  const maxResults = Math.max(1, Math.min(Number(req.query.max_results) || 250, 2000));
  res.json({
    source: catalog.source,
    sourcePath: catalog.sourcePath,
    demoMode: Boolean(catalog.demoMode),
    loadedAt: new Date(catalog.loadedAt).toISOString(),
    courses: catalog.courses.slice(0, maxResults),
    total: catalog.courses.length,
  });
}));

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function courseText(course) {
  return [
    course.id,
    course.oldId,
    course.name,
    course.desc,
    course.instructorText,
    asArray(course.requirements).join(' '),
    asArray(course.relatedSubjects).join(' '),
    course.area,
  ].join(' ').toLowerCase();
}

function requirementHits(course, remainingReqs) {
  const courseReqs = asArray(course.requirements).map((req) => String(req).toLowerCase());
  return remainingReqs.filter((req) => courseReqs.includes(String(req).toLowerCase()));
}

function topicSignals(profile, markdown) {
  const signals = [];
  const text = `${JSON.stringify(profile || {})}\n${String(markdown || '')}`.toLowerCase();
  const patterns = [
    ['machineLearning', /machine learning|deep learning|artificial intelligence|\bml\b|\bai\b|neural/],
    ['systems', /system|operating system|distributed|network|database|compiler|architecture/],
    ['theory', /theory|algorithm|complexity|proof|automata|computation/],
    ['math', /linear algebra|probability|statistics|optimization|calculus|math/],
    ['hass', /hass|writing|history|philosophy|economics|literature|language/],
  ];
  patterns.forEach(([key, pattern]) => {
    if (pattern.test(text)) signals.push(key);
  });
  return signals;
}

function topicScore(course, signals) {
  const text = courseText(course);
  let score = 0;
  signals.forEach((signal) => {
    if (signal === 'machineLearning' && /machine learning|deep learning|artificial intelligence|neural|inference/.test(text)) score += 12;
    if (signal === 'systems' && /system|operating system|distributed|network|database|compiler|architecture/.test(text)) score += 10;
    if (signal === 'theory' && /theory|algorithm|complexity|proof|automata|computation/.test(text)) score += 10;
    if (signal === 'math' && /linear algebra|probability|statistics|optimization|calculus|mathematics/.test(text)) score += 8;
    if (signal === 'hass' && /hass|writing|history|philosophy|economics|literature|language/.test(text)) score += 8;
  });
  return score;
}

function missingPrereqs(course, completedSet) {
  return [...String(course.prerequisitesRaw || '').matchAll(/\b\d{1,2}\.[A-Z0-9.]+/gi)]
    .map((match) => normalizeCourseId(match[0]))
    .filter((id, index, list) => id && !completedSet.has(id) && list.indexOf(id) === index)
    .slice(0, 5);
}

function departmentOf(courseId) {
  const id = normalizeCourseId(courseId);
  const match = id.match(/^([A-Z]*\d{1,2})\./);
  return match ? match[1] : '';
}

function profileDepartments(profile, personal) {
  const departments = new Set();
  personal.completedCourseIds.forEach((id) => {
    const dept = departmentOf(id);
    if (dept) departments.add(dept);
  });
  asArray(profile?.taken).forEach((id) => {
    const dept = departmentOf(id);
    if (dept) departments.add(dept);
  });
  const majorText = `${profile?.major || ''} ${profile?.majorLabel || ''}`.toLowerCase();
  if (/course\s*6|computer science|eecs/.test(majorText)) departments.add('6');
  if (/course\s*18|math/.test(majorText)) departments.add('18');
  if (/course\s*8|physics/.test(majorText)) departments.add('8');
  return departments;
}

function recommendCurrentCourses({ schedule, profile, personalCourseMarkdown, maxResults, catalog }) {
  const personal = summarize(personalCourseMarkdown);
  const profileTaken = asArray(profile?.taken).map(normalizeCourseId).filter(Boolean);
  const completedSet = new Set([...profileTaken, ...personal.completedCourseIds]);
  const scheduledSet = new Set(asArray(schedule).map(normalizeCourseId).filter(Boolean));
  const remainingReqs = asArray(profile?.remainingReqs);
  const signals = topicSignals(profile, personalCourseMarkdown);
  const departments = profileDepartments(profile, personal);
  const preferences = personal.coursePreferences || {};
  const limit = Math.max(1, Math.min(Number(maxResults) || 40, 80));

  const results = catalog.courses
    .filter((course) => course && course.id)
    .filter((course) => !completedSet.has(course.id))
    .filter((course) => !scheduledSet.has(course.id))
    .map((course) => {
      const reqHits = requirementHits(course, remainingReqs);
      const prereqMisses = missingPrereqs(course, completedSet);
      const reasons = [];
      let score = 20;

      if (reqHits.length) {
        score += reqHits.length * 14;
        reasons.push(`covers ${reqHits.join(', ')}`);
      }

      const interest = topicScore(course, signals);
      if (interest > 0) {
        score += interest;
        reasons.push('matches your academic history/preferences');
      }

      const dept = departmentOf(course.id);
      if (dept && departments.has(dept)) {
        score += 9;
        reasons.push(`matches your Course ${dept} background`);
      }

      if (Number(course.totalHours) && Number(course.totalHours) <= 10) {
        score += 4;
        reasons.push('moderate workload');
      } else if (Number(course.totalHours) && Number(course.totalHours) >= 14) {
        score -= 3;
        reasons.push('higher workload');
      }

      if (preferences[course.id] === 'thumb_up') {
        score += 18;
        reasons.push('you rated this course positively');
      } else if (preferences[course.id] === 'thumb_down') {
        score -= 25;
        reasons.push('you rated this course negatively');
      }

      if (prereqMisses.length) {
        score -= Math.min(prereqMisses.length, 3) * 5;
        reasons.push(`check prereqs: ${prereqMisses.join(', ')}`);
      } else if (String(course.prerequisitesRaw || '').trim()) {
        score += 3;
        reasons.push('prereqs appear covered by your record');
      }

      return {
        ...course,
        personalMatch: {
          total: Math.max(1, Math.min(100, Math.round(score))),
          interest,
          workload: Number(course.totalHours) || 0,
          reqValue: reqHits.length * 14,
        },
        rankScore: score,
        reasons,
        missingPrereqs: prereqMisses,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore || a.id.localeCompare(b.id))
    .slice(0, limit);

  return {
    source: catalog.source,
    completedCourseIds: [...completedSet],
    scheduledCourseIds: [...scheduledSet],
    results,
  };
}

router.post('/recommendations', asyncHandler(async (req, res) => {
  const catalog = await getCurrentCatalog();
  res.json(recommendCurrentCourses({
    schedule: req.body?.schedule || [],
    profile: req.body?.profile || {},
    personalCourseMarkdown: req.body?.personalCourseMarkdown || '',
    maxResults: req.body?.maxResults || req.body?.max_results,
    catalog,
  }));
}));

module.exports = router;
