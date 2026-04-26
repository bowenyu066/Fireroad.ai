'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { checkRequirements } = require('../requirements/checker');
const { getCurrentCatalog } = require('../current/fireroad');
const { normalizeCourseId } = require('../current/normalize');

const router = express.Router();
const REQS_DIR = path.join(__dirname, '..', '..', 'data', 'requirements');

const MAJOR_KEY_MAP = {
  '6-1':   'major6-1', '6-2':   'major6-2', '6-3':   'major6-3',
  '6-4':   'major6-4', '6-5':   'major6-5', '6-7':   'major6-7',
  '6-9':   'major6-9', '6-14':  'major6-14',
  '18':    'major18gm', '18-c':  'major18c',
  '18-am': 'major18am', '18-pm': 'major18pm',
  '8': 'major8', '16': 'major16',
  'girs': 'girs',
};

const GIR_ATTR_CODES = new Set(['PHY1','PHY2','CAL1','CAL2','CHEM','BIOL','REST','LAB']);
const HASS_CODES = new Set(['HASS','HASS-A','HASS-H','HASS-S','CI-H','CI-HW']);

function resolveMajorKey(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/^course\s+/i, '').trim().toLowerCase();
  if (MAJOR_KEY_MAP[s]) return MAJOR_KEY_MAP[s];
  if (s.startsWith('major')) return s;
  return null;
}

function loadJson(majorKey) {
  const file = path.join(REQS_DIR, `${majorKey}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Build GIR expansion + reverse map (code → actual course IDs taken).
async function expandWithGirCodes(courseIds) {
  const catalog = await getCurrentCatalog();
  const extra = new Set();
  const countMap = {};
  const codeToIds = {};   // GIR/HASS code → real course IDs that satisfy it (taken)

  const add = (code, realId) => {
    extra.add(code);
    if (!codeToIds[code]) codeToIds[code] = [];
    if (!codeToIds[code].includes(realId)) codeToIds[code].push(realId);
  };

  courseIds.forEach((raw) => {
    const id = normalizeCourseId(raw);
    const course = catalog.coursesById[id];
    if (!course) return;

    let addedToHass = false;
    course.requirements.forEach((req) => {
      if (GIR_ATTR_CODES.has(req)) {
        add(`GIR:${req}`, id);
      }
      if (HASS_CODES.has(req)) {
        if (req !== 'HASS') {
          add(req, id);
          countMap[req] = (countMap[req] || 0) + 1;
        }
        // Each course counts toward the 8-subject HASS total at most once,
        // regardless of how many HASS attribute codes it carries.
        if (!addedToHass) {
          addedToHass = true;
          add('HASS', id);
          countMap['HASS'] = (countMap['HASS'] || 0) + 1;
        }
      }
    });
  });

  return {
    courses: [...new Set([...courseIds, ...extra])],
    countMap,
    codeToIds,
    catalog,
  };
}

const GIR_CODE_LABELS = {
  'GIR:PHY1': 'Physics I',   'GIR:PHY2': 'Physics II',
  'GIR:CAL1': 'Calculus I',  'GIR:CAL2': 'Calculus II',
  'GIR:CHEM': 'Chemistry',   'GIR:BIOL': 'Biology',
  'GIR:REST': 'REST Subject', 'GIR:LAB': 'Lab Subject',
  'HASS': 'HASS (8 subjects)',
  'HASS-A': 'HASS-A',  'HASS-S': 'HASS-S',  'HASS-H': 'HASS-H',
  'CI-H': 'CI-H',      'CI-HW': 'CI-HW',
};

// For each abstract GIR/HASS code, build a short list of catalog course IDs that satisfy it.
// Used to populate "Still needed" with concrete examples instead of the abstract code name.
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

  // The catch-all HASS count (threshold 8) is handled by progress; suppress from "still needed" pills.
  samples['HASS'] = [];

  // For HASS sub-types, sample concrete course IDs from the catalog.
  ['HASS-A', 'HASS-H', 'HASS-S', 'CI-H', 'CI-HW'].forEach((key) => {
    samples[key] = catalog.courses
      .filter((c) => c.requirements.includes(key))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 5)
      .map((c) => c.id);
  });

  return samples;
}

// Replace abstract GIR/HASS codes in matched/unmet with real course IDs.
// For "still needed": use catalog sample courses instead of abstract code names.
// Count-based leaf nodes (e.g. "HASS 3/8") suppress unmet since progress already says what's needed.
function resolveMatchedCodes(node, codeToIds, catalogSamples) {
  const label = GIR_CODE_LABELS[node.label] || node.label;
  const matched = [...new Set(node.matched.flatMap((c) => codeToIds[c] || [c]))];

  let unmet;
  if (!node.subGroups && node.progress && /^\d+\/\d+$/.test(node.progress)) {
    // Count-based leaf (e.g. HASS threshold 8): progress already communicates the gap.
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

// POST /api/requirements/check
router.post('/check', async (req, res) => {
  try {
    const { major, majorKey, courses = [] } = req.body || {};
    const key = resolveMajorKey(majorKey || major);

    if (!key) {
      return res.status(400).json({ error: 'Provide major (e.g. "Course 6-3") or majorKey (e.g. "girs")' });
    }

    const reqJson = loadJson(key);
    if (!reqJson) {
      return res.status(404).json({ error: `No requirements found for "${key}"` });
    }

    // Always expand GIR/HASS codes so that both GIR and major requirement files
    // use the same evaluation path (courses.json attributes → abstract codes → checker).
    const { courses: expandedCourses, countMap, codeToIds, catalog } = await expandWithGirCodes(courses);

    const result = checkRequirements(reqJson, expandedCourses, countMap);

    // Replace abstract codes (GIR:PHY1, HASS-H …) with real course IDs in matched/unmet.
    const catalogSamples = buildCatalogSamples(catalog);
    result.groups = result.groups.map((g) => resolveMatchedCodes(g, codeToIds, catalogSamples));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
