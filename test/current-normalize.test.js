'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isGenericSpecialTitle,
  normalizeCurrentCourse,
} = require('../server/current/normalize');

test('generic special-subject titles are marked as not real without an overlay flag', () => {
  const course = normalizeCurrentCourse({
    subject_id: '6.S999',
    title: 'Special Subject in Electrical Engineering and Computer Science',
  });

  assert.equal(course.isSpecial, true);
  assert.equal(course.hasRealTitle, false);
  assert.equal(isGenericSpecialTitle(course.name), true);
});

test('curated special-subject titles remain real', () => {
  const course = normalizeCurrentCourse({
    subject_id: '6.S999',
    title: 'Reliable Machine Learning Systems',
    special_topic: 'Reliable Machine Learning Systems',
  });

  assert.equal(course.isSpecial, true);
  assert.equal(course.hasRealTitle, true);
  assert.equal(course.specialTopic, 'Reliable Machine Learning Systems');
});

test('an explicit overlay flag wins over title inference', () => {
  const course = normalizeCurrentCourse({
    subject_id: '18.S999',
    title: 'Special Subject in Mathematics',
    has_real_title: true,
  });

  assert.equal(course.hasRealTitle, true);
});

test('real catalog rows never inherit legacy mock facts', () => {
  const course = normalizeCurrentCourse({
    subject_id: '6.3900',
    title: 'Introduction to Machine Learning',
    total_units: 12,
    offered_fall: true,
    offered_spring: true,
    in_class_hours: null,
    out_of_class_hours: null,
    rating: null,
  }, {
    mockCourse: {
      id: '6.3900',
      satisfies: ['CI-M'],
      hydrant: 16.5,
      schedule: 'MWF 10',
      rating: { overall: 4.9 },
      area: 'math',
    },
  });

  assert.deepEqual(course.requirements, []);
  assert.equal(course.totalHours, null);
  assert.equal(course.scheduleRaw, '');
  assert.equal(course.rating, null);
  assert.equal(course.area, 'cs');
  assert.equal(course.source, 'fireroad');
});

test('mock facts remain available only for an explicit demo row', () => {
  const course = normalizeCurrentCourse(null, {
    mockCourse: {
      id: '6.DEMO',
      name: 'Demo Course',
      units: 12,
      satisfies: ['CI-M'],
      hydrant: 9,
      area: 'cs',
    },
  });

  assert.deepEqual(course.requirements, ['CI-M']);
  assert.equal(course.totalHours, 9);
  assert.equal(course.source, 'mock');
});
