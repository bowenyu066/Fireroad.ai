'use strict';

const fs   = require('fs');
const path = require('path');
const { checkRequirements } = require('./checker');

const REQS_DIR = path.join(__dirname, '..', '..', 'data', 'requirements');

const MAJOR_KEY_MAP = {
  '6-1': 'major6-1', '6-2': 'major6-2', '6-3': 'major6-3',
  '6-4': 'major6-4', '6-5': 'major6-5', '6-7': 'major6-7',
  '6-9': 'major6-9', '6-14': 'major6-14',
  '18':    'major18gm', '18-c':  'major18c',
  '18-am': 'major18am', '18-pm': 'major18pm',
  '8': 'major8', '8-flex': 'major8flex', '16': 'major16',
};

function resolveMajorKey(major) {
  const code = String(major || '').replace(/^course\s+/i, '').trim().toLowerCase();
  if (MAJOR_KEY_MAP[code]) return MAJOR_KEY_MAP[code];
  if (code.startsWith('major')) return code;
  return null;
}

function loadReqJson(key) {
  const file = path.join(REQS_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Synchronous — safe to call from tool handlers
function checkMajorRequirements(major, courses) {
  const key = resolveMajorKey(major);
  if (!key) return null;
  const reqJson = loadReqJson(key);
  if (!reqJson) return null;
  return checkRequirements(reqJson, courses);
}

module.exports = { checkMajorRequirements, loadReqJson, resolveMajorKey };
