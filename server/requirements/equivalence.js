'use strict';

// Course-equivalence layer for requirement checking and petition context.
//
// Official same-course equivalences are pulled automatically from the catalog
// (`equivalentSubjects` and `oldId`) and credited bidirectionally. Curated
// petition examples in data/substitutions.json are advisory only: MIT EECS says
// every petition is decided case by case, so they never auto-credit requirements.
//
// `expandEquivalents` widens a student's taken-course set with everything those
// courses credit, so the requirement checker matches an officially equivalent
// course against a requirement that names the original.

const fs = require('fs');
const path = require('path');
const { normalizeCourseId } = require('../current/normalize');

const SUBS_PATH = process.env.SUBSTITUTIONS_PATH
  || path.join(__dirname, '..', '..', 'data', 'substitutions.json');

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// Read curated petition rules. Missing/invalid file is non-fatal (returns []).
function loadSubstitutions() {
  let raw;
  try {
    raw = fs.readFileSync(SUBS_PATH, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.substitutions || []);
    return list.filter((entry) => entry && entry.course);
  } catch (error) {
    console.warn('[substitutions] failed to parse', SUBS_PATH, '-', error.message);
    return [];
  }
}

// Build a directed credit map: takenId -> Set(ids it credits).
// Cached per catalog snapshot (keyed by loadedAt) since it walks the whole catalog.
let mapCache = { key: null, map: null };

function buildEquivalenceMap(catalog) {
  const key = catalog ? catalog.loadedAt : 'no-catalog';
  if (mapCache.key === key && mapCache.map) return mapCache.map;

  const map = new Map();
  const add = (from, to) => {
    const f = normalizeCourseId(from);
    const t = normalizeCourseId(to);
    if (!f || !t || f === t) return;
    if (!map.has(f)) map.set(f, new Set());
    map.get(f).add(t);
  };

  // Official same-course equivalences from the catalog (bidirectional).
  if (catalog && Array.isArray(catalog.courses)) {
    for (const course of catalog.courses) {
      asArray(course.equivalentSubjects).forEach((eq) => {
        add(course.id, eq);
        add(eq, course.id);
      });
      if (course.oldId) {
        add(course.id, course.oldId);
        add(course.oldId, course.id);
      }
    }
  }

  mapCache = { key, map };
  return map;
}

// Widen taken-course ids with the transitive closure of everything they credit.
function expandEquivalents(courseIds, catalog) {
  const map = buildEquivalenceMap(catalog);
  const out = new Set(asArray(courseIds).map(normalizeCourseId).filter(Boolean));
  let frontier = [...out];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      const credits = map.get(id);
      if (!credits) continue;
      for (const credited of credits) {
        if (!out.has(credited)) {
          out.add(credited);
          next.push(credited);
        }
      }
    }
    frontier = next;
  }
  return [...out];
}

// All curated substitution rules touching a course (as source or target).
function getKnownSubstitutions(courseId) {
  const id = normalizeCourseId(courseId);
  return loadSubstitutions().filter((entry) => {
    if (normalizeCourseId(entry.course) === id) return true;
    return asArray(entry.satisfies).map(normalizeCourseId).includes(id);
  });
}

module.exports = {
  loadSubstitutions,
  buildEquivalenceMap,
  expandEquivalents,
  getKnownSubstitutions,
};
