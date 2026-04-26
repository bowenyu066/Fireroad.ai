const fs = require('fs/promises');
const path = require('path');

const mockData = require('../../shared/mock-data.js');
const { findMockCourse, normalizeCourseId, normalizeCurrentCourse } = require('./normalize');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', '..', 'data', 'courses.json');
const CURRENT_CATALOG_PATH = process.env.CURRENT_CATALOG_PATH || DEFAULT_CATALOG_PATH;
const CATALOG_TTL_MS = Number(process.env.CURRENT_CATALOG_TTL_MS) || 5 * 60 * 1000;

let catalogCache = null;
let catalogInflight = null;

function indexCourses(courses) {
  const coursesById = {};
  courses.forEach((course) => {
    coursesById[course.id] = course;
    if (course.oldId) coursesById[normalizeCourseId(course.oldId)] = course;
    course.relatedSubjects.forEach((subjectId) => {
      const normalized = normalizeCourseId(subjectId);
      if (normalized && !coursesById[normalized]) coursesById[normalized] = course;
    });
  });
  return coursesById;
}

function getMatchScore(courseId) {
  const match = mockData.matchScores[normalizeCourseId(courseId)] || mockData.matchScores[courseId] || {};
  return match.total || 0;
}

function fallbackCatalog() {
  const courses = mockData.catalog
    .filter((course) => !course._stub)
    .map((course) => normalizeCurrentCourse({ id: course.id }, { mockCourse: course }))
    .filter(Boolean);
  return {
    source: 'mock',
    sourcePath: null,
    loadedAt: Date.now(),
    courses,
    coursesById: indexCourses(courses),
  };
}

function listRawCourses(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  throw new Error('Current catalog snapshot must be a JSON array or object.');
}

async function loadLocalCatalogSnapshot() {
  const file = await fs.readFile(CURRENT_CATALOG_PATH, 'utf8');
  const rawCourses = listRawCourses(JSON.parse(file));

  const courses = rawCourses
    .filter((course) => course && course.public !== false)
    .map((course) => normalizeCurrentCourse(course, { mockCourse: findMockCourse(course.subject_id) }))
    .filter(Boolean);

  return {
    source: 'local_snapshot',
    sourcePath: CURRENT_CATALOG_PATH,
    loadedAt: Date.now(),
    courses,
    coursesById: indexCourses(courses),
  };
}

async function getCurrentCatalog() {
  const now = Date.now();
  if (catalogCache && now - catalogCache.loadedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }

  if (!catalogInflight) {
    catalogInflight = loadLocalCatalogSnapshot()
      .then((catalog) => {
        catalogCache = catalog;
        return catalogCache;
      })
      .catch((error) => {
        console.warn('[current catalog] falling back to mock data:', error.message);
        catalogCache = { ...fallbackCatalog(), error: error.message };
        return catalogCache;
      })
      .finally(() => {
        catalogInflight = null;
      });
  }

  return catalogInflight;
}

async function fetchCurrentCourse(courseId) {
  const id = normalizeCourseId(courseId);
  if (!id) return null;

  const catalog = await getCurrentCatalog();
  const course = catalog.coursesById[id];
  if (course) return course;
  return catalog.source === 'mock' ? normalizeCurrentCourse(null, { mockCourse: findMockCourse(id) }) : null;
}

function scoreCourse(course, query, tokens) {
  const matchScore = getMatchScore(course.id);
  let score = 0;
  if (!query) return matchScore || 1;

  const haystack = [
    course.id,
    course.oldId,
    course.name,
    course.desc,
    course.instructorText,
    course.requirements.join(' '),
    course.relatedSubjects.join(' '),
    course.area,
  ].join(' ').toLowerCase();

  if (course.id.toLowerCase() === query) score += 120;
  if (course.id.toLowerCase().includes(query)) score += 60;
  if (String(course.oldId || '').toLowerCase() === query) score += 70;
  if (course.name.toLowerCase().includes(query)) score += 40;
  if (course.desc.toLowerCase().includes(query)) score += 18;
  if (course.requirements.some((req) => req.toLowerCase().includes(query))) score += 12;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += 6;
  });
  return score > 0 ? score + Math.min(matchScore, 10) : 0;
}

function expandSearchTokens(tokens) {
  const expanded = [...tokens];
  tokens.forEach((token) => {
    if (token === 'ml') expanded.push('machine', 'learning');
    if (token === 'ai') expanded.push('artificial', 'intelligence');
    if (token === 'hass') expanded.push('hass-a', 'hass-h', 'hass-s');
  });
  return [...new Set(expanded)];
}

async function searchCurrentCourses(options = {}) {
  const query = String(options.query || '').trim().toLowerCase();
  const tokens = expandSearchTokens(query.split(/\s+/).filter(Boolean));
  const maxResults = Math.max(1, Math.min(Number(options.maxResults || options.max_results) || 10, 50));
  const maxWorkload = Number(options.maxWorkload || options.max_workload) || null;
  const areas = Array.isArray(options.areas) ? options.areas.map((area) => String(area).toLowerCase()) : [];
  const requirements = Array.isArray(options.requirements || options.satisfies)
    ? (options.requirements || options.satisfies).map((req) => String(req).toLowerCase())
    : [];

  const catalog = await getCurrentCatalog();
  const results = catalog.courses
    .filter((course) => !areas.length || areas.includes(String(course.area).toLowerCase()))
    .filter((course) => !requirements.length || requirements.some((req) => course.requirements.map((r) => r.toLowerCase()).includes(req)))
    .filter((course) => !maxWorkload || !course.totalHours || course.totalHours <= maxWorkload)
    .map((course) => ({ course, searchScore: scoreCourse(course, query, tokens) }))
    .filter((result) => result.searchScore > 0 || !query)
    .sort((a, b) => b.searchScore - a.searchScore || a.course.id.localeCompare(b.course.id))
    .slice(0, maxResults)
    .map(({ course, searchScore }) => ({ ...course, searchScore, matchScore: getMatchScore(course.id) }));

  return {
    query,
    source: catalog.source,
    filters: { areas, requirements, maxWorkload },
    results,
  };
}

module.exports = {
  fetchCurrentCourse,
  getCurrentCatalog,
  searchCurrentCourses,
};
