'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { expandEquivalents } = require('../server/requirements/equivalence');
const {
  expandWithGirCodes,
  loadReqJson,
  resolveMajorKey,
} = require('../server/requirements/evaluate');
const { checkRequirements } = require('../server/requirements/checker');
const PersonalCourse = require('../shared/personal-course');

function course(id, requirements = []) {
  return { id, requirements, equivalentSubjects: [], oldId: null };
}

test('requirement keys resolve from canonical ids and unambiguous UI labels', () => {
  assert.equal(resolveMajorKey('majorAADS'), 'majorAADS');
  assert.equal(resolveMajorKey('Course 10'), 'major10');
  assert.equal(resolveMajorKey('10 Major'), 'major10');
  assert.equal(resolveMajorKey('18 Major (Applied)'), 'major18am');
  assert.equal(resolveMajorKey('Course 18'), 'major18gm');
  assert.equal(resolveMajorKey('Undecided'), null);
});

test('official catalog equivalences expand requirement credit bidirectionally', () => {
  const current = {
    ...course('6.5210'),
    equivalentSubjects: ['18.415'],
  };
  const catalog = {
    loadedAt: `test-${Date.now()}`,
    courses: [current],
  };

  const expanded = expandEquivalents(['6.5210'], catalog);
  assert.ok(expanded.includes('6.5210'));
  assert.ok(expanded.includes('18.415'));

  const reverse = expandEquivalents(['18.415'], catalog);
  assert.ok(reverse.includes('18.415'));
  assert.ok(reverse.includes('6.5210'));
});

test('advisory petition examples do not auto-credit requirements', () => {
  const catalog = {
    loadedAt: `test-petition-${Date.now()}`,
    courses: [],
  };

  const expanded = expandEquivalents(['6.5210'], catalog);
  assert.equal(expanded.includes('6.1210'), false);
});

test('GIR/HASS counts ignore synthetic equivalence ids', () => {
  const source = course('6.5210', ['REST']);
  const target = course('6.1210', ['REST']);
  const catalog = {
    courses: [source, target],
    coursesById: {
      '6.5210': source,
      '6.1210': target,
    },
  };

  const result = expandWithGirCodes(
    ['6.5210', '6.1210'],
    catalog,
    ['6.5210'],
  );

  assert.ok(result.courses.includes('6.1210'));
  assert.equal(result.countMap['GIR:REST'], 1);
  assert.deepEqual(result.codeToIds['GIR:REST'], ['6.5210']);
});

test('GIR/HASS counts de-duplicate old and current ids for one catalog course', () => {
  const canonical = course('21W.000', ['HASS-A']);
  const catalog = {
    courses: [canonical],
    coursesById: {
      '21W.000': canonical,
      '21W.OLD': canonical,
    },
  };

  const result = expandWithGirCodes(
    ['21W.000', '21W.OLD'],
    catalog,
    ['21W.000', '21W.OLD'],
  );

  assert.equal(result.countMap.HASS, 1);
  assert.equal(result.countMap['HASS-A'], 1);
  assert.deepEqual(result.codeToIds.HASS, ['21W.000']);
});

test('current Course 6-4 audit counts 6.4200 and 6.4610 as its two CI-M subjects', () => {
  const requirements = loadReqJson('major6-4');
  const result = checkRequirements(requirements, ['6.4200', '6.4610']);
  const ciM = result.groups.find((group) => group.label === 'Course 6 CI-M');

  assert.ok(ciM);
  assert.equal(ciM.satisfied, true);
  assert.equal(ciM.progress, '2/2');
  assert.deepEqual(ciM.matched.sort(), ['6.4200', '6.4610']);
});

test('6.4610 is added to every current 6-4 audit list that grants it credit', () => {
  const requirements = loadReqJson('major6-4');
  const expectedTitles = [
    'Course 6 CI-M',
    'Social and Ethical Responsibilities of Computing',
    'Mandatory Application CI-M',
    'AI+D_AUS',
    'Application CI-M',
  ];

  const findByTitle = (node, title) => {
    if (node?.title === title) return node;
    for (const child of node?.reqs || []) {
      const match = findByTitle(child, title);
      if (match) return match;
    }
    return null;
  };

  expectedTitles.forEach((title) => {
    const group = findByTitle(requirements, title);
    assert.ok(group, `missing ${title}`);
    assert.ok(group.reqs.some((child) => child.req === '6.4610'), `${title} should include 6.4610`);
  });

  const eecs = requirements.reqs[4].reqs[1].reqs[0];
  assert.ok(eecs.reqs.some((child) => child.req === '6.4610'));
});

test('requirement courses include transcript markdown even when profile.taken is stale', () => {
  const markdown = [
    '## Completed / For-Credit Courses',
    '',
    '| Term | Subject | Title | Units | Level | Grade | Audit Info | Notes |',
    '|---|---|---|---|---|---|---|---|',
    '| Spring 2026 | 6.4200 | Robotics: Science and Systems | 12 | U | A | None | None |',
  ].join('\n');

  assert.deepEqual(
    PersonalCourse.requirementCourseIds([], markdown, ['6.UAR']),
    ['6.4200', '6.UAR'],
  );
});
