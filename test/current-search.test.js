'use strict';

const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CURRENT_CATALOG_PATH = path.join(__dirname, 'fixtures', 'current-courses.json');
process.env.SPECIAL_SUBJECTS_PATH = path.join(__dirname, 'fixtures', 'missing-special-subjects.json');

const express = require('express');
const currentRoutes = require('../server/current/routes');
const { searchCurrentCourses } = require('../server/current/fireroad');

test('current search defaults to active-term offerings and exposes no legacy score', async () => {
  const result = await searchCurrentCourses({ semester: 'F26', maxResults: 50 });
  const ids = result.results.map((course) => course.id);

  assert.deepEqual(ids, ['21A.100', '6.1000', '6.3900']);
  assert.equal(ids.includes('18.1000'), false);
  result.results.forEach((course) => assert.equal('legacyMockMatchScore' in course, false));

  const realSharedId = result.results.find((course) => course.id === '6.3900');
  assert.deepEqual(realSharedId.requirements, []);
  assert.equal(realSharedId.totalHours, null);
  assert.equal(realSharedId.rating, null);
});

test('current search can include unavailable courses on explicit request', async () => {
  const result = await searchCurrentCourses({
    semester: 'F26',
    includeUnavailable: true,
    maxResults: 50,
  });

  assert.equal(result.results.some((course) => course.id === '18.1000'), true);
  assert.equal(result.filters.includeUnavailable, true);
});

test('department, requirement, and workload filters compose', async () => {
  const result = await searchCurrentCourses({
    semester: 'F26',
    departments: ['21'],
    requirements: ['HASS-A'],
    maxWorkload: 10,
    maxResults: 50,
  });

  assert.deepEqual(result.results.map((course) => course.id), ['21A.100']);
});

test('current search route forwards active-term smart filters', async (t) => {
  const app = express();
  app.use('/api/current', currentRoutes);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/current/search?semester=F26&departments=21&requirements=HASS-A&max_workload=10`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.results.map((course) => course.id), ['21A.100']);
  assert.equal(payload.filters.semester, 'F26');
});
