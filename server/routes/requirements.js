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

// Expand a list of course IDs with the GIR/HASS codes they satisfy,
// so the GIR checker can match GIR:PHY1 etc. against the takenSet.
async function expandWithGirCodes(courseIds) {
  const catalog = await getCurrentCatalog();
  const extra = new Set();
  courseIds.forEach((raw) => {
    const course = catalog.coursesById[normalizeCourseId(raw)];
    if (!course) return;
    course.requirements.forEach((req) => {
      if (GIR_ATTR_CODES.has(req)) extra.add(`GIR:${req}`);
      if (HASS_CODES.has(req)) extra.add(req);
    });
  });
  return [...new Set([...courseIds, ...extra])];
}

// POST /api/requirements/check
// Body: { major: "Course 6-3" | "girs", courses: ["6.100A", ...] }
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

    const expandedCourses = key === 'girs' ? await expandWithGirCodes(courses) : courses;
    res.json(checkRequirements(reqJson, expandedCourses));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
