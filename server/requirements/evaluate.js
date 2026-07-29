'use strict';

// Shared requirement evaluator used by BOTH the HTTP route (/api/requirements/check)
// and the chat agent (server/chat/tools.js). Centralizing it here fixes a prior bug
// where the agent path skipped GIR/HASS code expansion (so GIRs always read as
// unsatisfied for the agent) and ignored official course equivalences.
//
// Pipeline: taken ids -> expand official equivalences -> expand GIR/HASS attribute codes
//           -> checkRequirements -> resolve abstract codes back to real course ids.
// Curated petition examples remain advisory and are not part of this pipeline.

const fs = require('fs');
const path = require('path');
const { checkRequirements } = require('./checker');
const { expandEquivalents } = require('./equivalence');
const { getCurrentCatalog } = require('../current/fireroad');
const { normalizeCourseId } = require('../current/normalize');
const requirementIndex = require('../../data/reqs.json');
const requirementOverrides = require('../../data/requirement-overrides.json');

const REQS_DIR = path.join(__dirname, '..', '..', 'data', 'requirements');

const MAJOR_KEY_MAP = {
  '6-1': 'major6-1', '6-2': 'major6-2', '6-3': 'major6-3',
  '6-4': 'major6-4', '6-5': 'major6-5', '6-7': 'major6-7',
  '6-9': 'major6-9', '6-14': 'major6-14',
  '18': 'major18gm', '18-c': 'major18c',
  '18-am': 'major18am', '18-pm': 'major18pm',
  '8': 'major8', '8-flex': 'major8flex', '16': 'major16',
  'girs': 'girs',
};

const GIR_ATTR_CODES = new Set(['PHY1', 'PHY2', 'CAL1', 'CAL2', 'CHEM', 'BIOL', 'REST', 'LAB']);
const HASS_CODES = new Set(['HASS', 'HASS-A', 'HASS-H', 'HASS-S', 'CI-H', 'CI-HW']);

const REQUIREMENT_KEYS = new Map(
  Object.keys(requirementIndex).map((key) => [key.toLowerCase(), key]),
);

const GIR_CODE_LABELS = {
  'GIR:PHY1': 'Physics I', 'GIR:PHY2': 'Physics II',
  'GIR:CAL1': 'Calculus I', 'GIR:CAL2': 'Calculus II',
  'GIR:CHEM': 'Chemistry', 'GIR:BIOL': 'Biology',
  'GIR:REST': 'REST Subject', 'GIR:LAB': 'Lab Subject',
  'HASS': 'HASS (8 subjects)',
  'HASS-A': 'HASS-A', 'HASS-S': 'HASS-S', 'HASS-H': 'HASS-H',
  'CI-H': 'CI-H', 'CI-HW': 'CI-HW',
};

function resolveMajorKey(raw) {
  if (!raw) return null;
  const original = String(raw).trim();
  const directKey = REQUIREMENT_KEYS.get(original.toLowerCase());
  if (directKey) return directKey;

  const s = original.replace(/^course\s+/i, '').trim().toLowerCase();
  if (MAJOR_KEY_MAP[s]) return MAJOR_KEY_MAP[s];

  // Accept human-facing labels from data/reqs.json as well as canonical keys.
  // Only resolve an unambiguous label; e.g. bare "18" intentionally keeps the
  // explicit General Mathematics default above because several 18 options share it.
  const matches = Object.entries(requirementIndex).filter(([, metadata]) => {
    const labels = [
      metadata['short-title'],
      metadata['medium-title'],
      metadata['title-no-degree'],
      metadata.title,
    ];
    return labels.some((label) => String(label || '').trim().toLowerCase() === s);
  });
  if (matches.length === 1) return matches[0][0];
  return null;
}

function loadReqJson(majorKey) {
  const file = path.join(REQS_DIR, `${majorKey}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const reqJson = JSON.parse(fs.readFileSync(file, 'utf8'));
    return applyRequirementOverrides(majorKey, reqJson);
  } catch {
    return null;
  }
}

function findRequirementNodeByTitle(node, title) {
  if (!node || typeof node !== 'object') return null;
  if (node.title === title) return node;
  for (const child of node.reqs || []) {
    const match = findRequirementNodeByTitle(child, title);
    if (match) return match;
  }
  return null;
}

function requirementNodeAtPath(root, targetPath = []) {
  return targetPath.reduce((node, segment) => (
    node && Object.prototype.hasOwnProperty.call(node, segment) ? node[segment] : null
  ), root);
}

// Fireroad's requirement feed can lag the official departmental audit charts.
// Keep generated snapshots untouched and apply small, sourced corrections here.
function applyRequirementOverrides(majorKey, reqJson) {
  const override = requirementOverrides[majorKey];
  if (!override || !Array.isArray(override.operations)) return reqJson;

  override.operations.forEach((operation) => {
    const target = operation.targetTitle
      ? findRequirementNodeByTitle(reqJson, operation.targetTitle)
      : requirementNodeAtPath(reqJson, operation.targetPath);
    if (!target || !Array.isArray(target.reqs)) return;

    const existing = new Set(target.reqs
      .filter((child) => child && child.req && !child.reqs)
      .map((child) => normalizeCourseId(child.req)));
    (operation.addCourses || []).forEach((courseId) => {
      const normalized = normalizeCourseId(courseId);
      if (!normalized || existing.has(normalized)) return;
      target.reqs.push({ req: normalized });
      existing.add(normalized);
    });
  });

  return reqJson;
}

// Expand taken courses into GIR/HASS attribute codes, building a count map for
// count-based leaves and a reverse map (code -> real taken course ids).
function expandWithGirCodes(courseIds, catalog, attributeCourseIds = courseIds) {
  const extra = new Set();
  const countMap = {};
  const codeToIds = {};

  const add = (code, realId) => {
    extra.add(code);
    if (!codeToIds[code]) codeToIds[code] = [];
    if (!codeToIds[code].includes(realId)) codeToIds[code].push(realId);
  };

  // Attribute counts must come from courses the student actually completed or
  // scheduled, not synthetic ids added for an equivalence/substitution. Also
  // de-duplicate old/new ids that resolve to the same canonical catalog course.
  const countedCanonicalIds = new Set();
  attributeCourseIds.forEach((raw) => {
    const id = normalizeCourseId(raw);
    const course = catalog.coursesById[id];
    if (!course) return;
    const canonicalId = normalizeCourseId(course.id) || id;
    if (countedCanonicalIds.has(canonicalId)) return;
    countedCanonicalIds.add(canonicalId);

    let addedToHass = false;
    course.requirements.forEach((req) => {
      if (GIR_ATTR_CODES.has(req)) {
        const code = `GIR:${req}`;
        add(code, canonicalId);
        countMap[code] = (countMap[code] || 0) + 1;
      }
      if (HASS_CODES.has(req)) {
        if (req !== 'HASS') {
          add(req, canonicalId);
          countMap[req] = (countMap[req] || 0) + 1;
        }
        if (!addedToHass) {
          addedToHass = true;
          add('HASS', canonicalId);
          countMap['HASS'] = (countMap['HASS'] || 0) + 1;
        }
      }
    });
  });

  return { courses: [...new Set([...courseIds, ...extra])], countMap, codeToIds };
}

function buildCatalogSamples(catalog) {
  const samples = {};
  GIR_ATTR_CODES.forEach((key) => {
    const code = `GIR:${key}`;
    samples[code] = catalog.courses
      .filter((c) => c.requirements.includes(key))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 5)
      .map((c) => c.id);
  });
  samples['HASS'] = [];
  ['HASS-A', 'HASS-H', 'HASS-S', 'CI-H', 'CI-HW'].forEach((key) => {
    samples[key] = catalog.courses
      .filter((c) => c.requirements.includes(key))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 5)
      .map((c) => c.id);
  });
  return samples;
}

function resolveMatchedCodes(node, codeToIds, catalogSamples) {
  const label = GIR_CODE_LABELS[node.label] || node.label;
  const matched = [...new Set(node.matched.flatMap((c) => codeToIds[c] || [c]))];

  let unmet;
  if (!node.subGroups && node.progress && /^\d+\/\d+$/.test(node.progress)) {
    unmet = [];
  } else {
    unmet = node.unmet.flatMap((c) => {
      if (catalogSamples[c] && catalogSamples[c].length > 0) return catalogSamples[c];
      return [GIR_CODE_LABELS[c] || c];
    });
  }

  return {
    ...node,
    label,
    matched,
    unmet,
    subGroups: node.subGroups
      ? node.subGroups.map((sub) => resolveMatchedCodes(sub, codeToIds, catalogSamples))
      : null,
  };
}

// Async: full requirement evaluation for a major against taken/scheduled courses.
// Returns the same shape as checkRequirements (groups/satisfiedCount/totalCount/...)
// with GIR/HASS codes resolved to real ids, or null if the major key is unknown.
async function evaluateMajorRequirements(major, courseIds = []) {
  const key = resolveMajorKey(major);
  if (!key) return null;
  const reqJson = loadReqJson(key);
  if (!reqJson) return null;

  const catalog = await getCurrentCatalog();

  // 1. Credit official catalog equivalences (not advisory petition examples).
  const actualCourseIds = [...new Set(courseIds.map(normalizeCourseId).filter(Boolean))];
  const withEquivalents = expandEquivalents(actualCourseIds, catalog);
  // 2. Expand GIR/HASS attribute codes.
  const { courses: expanded, countMap, codeToIds } = expandWithGirCodes(
    withEquivalents,
    catalog,
    actualCourseIds,
  );
  // 3. Evaluate.
  const result = checkRequirements(reqJson, expanded, countMap);
  // 4. Resolve abstract codes back to real course ids.
  const samples = buildCatalogSamples(catalog);
  result.groups = result.groups.map((g) => resolveMatchedCodes(g, codeToIds, samples));
  result.majorKey = key;
  return result;
}

module.exports = {
  evaluateMajorRequirements,
  resolveMajorKey,
  loadReqJson,
  applyRequirementOverrides,
  expandWithGirCodes,
  buildCatalogSamples,
  resolveMatchedCodes,
  GIR_CODE_LABELS,
};
