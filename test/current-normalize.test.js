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
