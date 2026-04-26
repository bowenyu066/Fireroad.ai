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

// Collect all explicit course IDs (leaf req nodes) from a subtree
function extractCourseIds(node, out = []) {
  if (node['plain-string']) return out;
  if (node.req && !node.reqs) {
    const id = String(node.req).toUpperCase();
    if (!out.includes(id)) out.push(id);
    return out;
  }
  for (const child of (node.reqs || [])) extractCourseIds(child, out);
  return out;
}

// Find all groups whose title contains query (case-insensitive), return title + course list
function findMatchingGroups(node, query) {
  const results = [];
  const q = query.toLowerCase().trim();
  function walk(n) {
    if (n.title && String(n.title).toLowerCase().includes(q)) {
      results.push({ title: n.title, courses: extractCourseIds(n) });
    }
    for (const child of (n.reqs || [])) walk(child);
  }
  walk(node);
  return results;
}

// Return course lists for groups matching groupQuery within a major's requirement tree
function getRequirementGroupCourses(major, groupQuery) {
  const key = resolveMajorKey(major);
  if (!key) return null;
  const reqJson = loadReqJson(key);
  if (!reqJson) return null;
  return findMatchingGroups(reqJson, groupQuery);
}

// Find all named requirement groups that a given course satisfies
function getCourseRequirementGroups(major, courseId) {
  const key = resolveMajorKey(major);
  if (!key) return null;
  const reqJson = loadReqJson(key);
  if (!reqJson) return null;

  const id = String(courseId).toUpperCase();
  const groups = [];

  function walk(node, ancestors) {
    const path = node.title ? [...ancestors, node.title] : ancestors;
    if (node.req && !node.reqs && String(node.req).toUpperCase() === id) {
      if (path.length) groups.push(path.join(' > '));
    }
    for (const child of (node.reqs || [])) walk(child, path);
  }

  walk(reqJson, []);
  return groups;
}

module.exports = { checkMajorRequirements, getRequirementGroupCourses, getCourseRequirementGroups, loadReqJson, resolveMajorKey };
