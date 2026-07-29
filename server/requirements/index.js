'use strict';

const { checkRequirements } = require('./checker');
const { loadReqJson, resolveMajorKey } = require('./evaluate');

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
