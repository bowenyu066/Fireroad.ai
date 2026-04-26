'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { checkRequirements } = require('../requirements/checker');

const router = express.Router();
const REQS_DIR = path.join(__dirname, '..', '..', 'data', 'requirements');

// Map the short major code (from profile.major) to a JSON filename key
const MAJOR_KEY_MAP = {
  '6-1':   'major6-1',
  '6-2':   'major6-2',
  '6-3':   'major6-3',
  '6-4':   'major6-4',
  '6-5':   'major6-5',
  '6-7':   'major6-7',
  '6-9':   'major6-9',
  '6-14':  'major6-14',
  '18':    'major18gm',
  '18-c':  'major18c',
  '18-am': 'major18am',
  '18-pm': 'major18pm',
  '8':     'major8',
  '16':    'major16',
};

// Accept 'Course 6-3', '6-3', or 'major6-3'
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
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// POST /api/requirements/check
// Body: { major: "Course 6-3", courses: ["6.100A", "6.1010", ...] }
router.post('/check', (req, res) => {
  const { major, majorKey, courses = [] } = req.body || {};
  const key = resolveMajorKey(majorKey || major);

  if (!key) {
    return res.status(400).json({ error: 'Provide major (e.g. "Course 6-3") or majorKey (e.g. "major6-3")' });
  }

  const reqJson = loadJson(key);
  if (!reqJson) {
    return res.status(404).json({ error: `No requirements found for "${key}"` });
  }

  res.json(checkRequirements(reqJson, courses));
});

module.exports = router;
