const fs = require('fs/promises');
const path = require('path');

const mockData = require('../../shared/mock-data.js');
const { findMockCourse, normalizeCourseId, normalizeCurrentCourse } = require('./normalize');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', '..', 'data', 'courses.json');
const CURRENT_CATALOG_PATH = process.env.CURRENT_CATALOG_PATH || DEFAULT_CATALOG_PATH;
// EECS special-subjects overlay (numbers with an "S" after the dot, e.g. 6.S062).
// Generated once per semester by scripts/fetch_special_subjects.py; carries the
// canonical Fireroad course records with real per-term topic names merged in.
const SPECIAL_SUBJECTS_PATH = process.env.SPECIAL_SUBJECTS_PATH
  || path.join(__dirname, '..', '..', 'data', 'special_subjects.json');
const CATALOG_TTL_MS = Number(process.env.CURRENT_CATALOG_TTL_MS) || 5 * 60 * 1000;
const DEMO_MODE = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';

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

function fallbackCatalog() {
  const courses = mockData.catalog
    .filter((course) => !course._stub)
    .map((course) => normalizeCurrentCourse(null, { mockCourse: course }))
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

// Load the EECS special-subjects overlay, if present. Returns normalized courses.
// Missing/invalid overlay is non-fatal — the base catalog still loads.
async function loadSpecialSubjects() {
  let file;
  try {
    file = await fs.readFile(SPECIAL_SUBJECTS_PATH, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(file);
    const subjects = Array.isArray(parsed) ? parsed : (parsed.subjects || []);
    return subjects
      .filter((course) => course && course.public !== false)
      .map((course) => normalizeCurrentCourse(course))
      .filter(Boolean);
  } catch (error) {
    console.warn('[special subjects] failed to parse overlay:', error.message);
    return [];
  }
}

async function loadLocalCatalogSnapshot() {
  const file = await fs.readFile(CURRENT_CATALOG_PATH, 'utf8');
  const rawCourses = listRawCourses(JSON.parse(file));

  const baseCourses = rawCourses
    .filter((course) => course && course.public !== false)
    .map((course) => normalizeCurrentCourse(course))
    .filter(Boolean);

  // Merge the special-subjects overlay: overlay records win by id so real topic
  // names replace any generic placeholder already in the base snapshot.
  const overlay = await loadSpecialSubjects();
  const byId = new Map(baseCourses.map((c) => [c.id, c]));
  overlay.forEach((c) => byId.set(c.id, c));
  const courses = [...byId.values()];

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
        if (!DEMO_MODE) {
          catalogCache = null;
          throw error;
        }
        console.warn('[current catalog] DEMO_MODE=true; falling back to mock data:', error.message);
        catalogCache = { ...fallbackCatalog(), error: error.message, demoMode: true };
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
  let score = 0;
  if (!query) return 1;

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
  if (course.id.toLowerCase().startsWith(query)) score += 80;
  if (course.id.toLowerCase().includes(query)) score += 60;
  if (String(course.oldId || '').toLowerCase() === query) score += 55;
  if (course.name.toLowerCase().includes(query)) score += 40;
  if (course.desc.toLowerCase().includes(query)) score += 18;
  if (course.requirements.some((req) => req.toLowerCase().includes(query))) score += 12;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += 6;
  });
  return score;
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

function semesterSeason(semId) {
  const value = String(semId || '').toUpperCase();
  if (!value) return null;
  if (value.startsWith('IAP')) return 'iap';
  if (value.startsWith('SU')) return 'summer';
  if (value.startsWith('F')) return 'fall';
  if (value.startsWith('S')) return 'spring';
  return null;
}

function booleanOption(value) {
  return value === true || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function matchesDepartment(courseId, department) {
  const id = String(courseId || '').toLowerCase();
  const prefix = String(department || '').toLowerCase().replace(/\.$/, '');
  if (!prefix) return true;
  if (id.startsWith(`${prefix}.`)) return true;
  // Numeric department filters include lettered sub-departments such as 21A/21H.
  return /^\d+$/.test(prefix) && id.startsWith(prefix) && /^[a-z]*\./.test(id.slice(prefix.length));
}

async function searchCurrentCourses(options = {}) {
  const query = String(options.query || '').trim().toLowerCase();
  const tokens = expandSearchTokens(query.split(/\s+/).filter(Boolean));
  const maxResults = Math.max(1, Math.min(Number(options.maxResults || options.max_results) || 10, 50));
  const maxWorkload = Number(options.maxWorkload || options.max_workload) || null;
  const semester = String(options.semester || options.activeSem || '').toUpperCase();
  const season = semesterSeason(semester);
  const includeUnavailable = booleanOption(options.includeUnavailable || options.include_unavailable);
  // Map department numbers to area names in case the agent passes "18" instead of "math"
  const DEPT_TO_AREA = { '6': 'cs', '18': 'math', '8': 'physics', '7': 'bio', '5': 'other', '14': 'hass', '21': 'hass', '24': 'hass' };
  const areas = Array.isArray(options.areas)
    ? options.areas.map((a) => { const s = String(a).toLowerCase(); return DEPT_TO_AREA[s] || s; })
    : [];
  const requirements = Array.isArray(options.requirements || options.satisfies)
    ? (options.requirements || options.satisfies).map((req) => String(req).toLowerCase())
    : [];
  // departments: filter to courses whose ID starts with any of the given prefixes, e.g. ["6", "18"]
  const departments = Array.isArray(options.departments)
    ? options.departments.map((d) => String(d).toLowerCase().replace(/\.$/, ''))
    : [];

  const catalog = await getCurrentCatalog();
  const results = catalog.courses
    .filter((course) => !departments.length || departments.some((department) => matchesDepartment(course.id, department)))
    .filter((course) => !areas.length || areas.includes(String(course.area).toLowerCase()))
    .filter((course) => !requirements.length || requirements.some((req) => course.requirements.map((r) => r.toLowerCase()).includes(req)))
    .filter((course) => !maxWorkload || (Number(course.totalHours) > 0 && Number(course.totalHours) <= maxWorkload))
    .filter((course) => !season || includeUnavailable || !course.offered || course.offered[season] !== false)
    .map((course) => ({ course, searchScore: scoreCourse(course, query, tokens) }))
    .filter((result) => result.searchScore > 0 || !query)
    .sort((a, b) => b.searchScore - a.searchScore || a.course.id.localeCompare(b.course.id))
    .slice(0, maxResults)
    .map(({ course, searchScore }) => ({
      ...course,
      searchScore,
    }));

  return {
    query,
    source: catalog.source,
    filters: { semester, season, includeUnavailable, areas, requirements, maxWorkload, departments },
    results,
  };
}

module.exports = {
  DEMO_MODE,
  fetchCurrentCourse,
  getCurrentCatalog,
  searchCurrentCourses,
};
