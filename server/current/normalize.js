const mockData = require('../../shared/mock-data.js');

function normalizeCourseId(courseId) {
  return String(courseId || '').trim().toUpperCase();
}

function areaForCourseId(courseId) {
  const id = normalizeCourseId(courseId);
  if (id.startsWith('6.')) return 'cs';
  if (id.startsWith('18.')) return 'math';
  if (id.startsWith('8.')) return 'physics';
  if (id.startsWith('7.')) return 'bio';
  if (id.startsWith('21') || id.startsWith('24') || id.startsWith('17') || id.startsWith('14') || id.startsWith('15')) return 'hass';
  return 'other';
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function splitRequirements(raw) {
  return asArray(raw)
    .flatMap((value) => value.split(/[;,]/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatTime(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const match = value.match(/^(\d{1,2})(?:\.(\d{1,2}))?-(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (!match) return value;
  const [, sh, sm = '0', eh, em = '0'] = match;
  const fmt = (h, m) => {
    const minuteValue = m.length === 1 ? Math.round(Number(`0.${m}`) * 60) : Number(m);
    const minutes = String(minuteValue).padStart(2, '0');
    return minutes === '00' ? h : `${h}:${minutes}`;
  };
  return `${fmt(sh, sm)}-${fmt(eh, em)}`;
}

function formatSchedule(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  const meetings = value
    .split(';')
    .flatMap((block) => {
      const [kind, rest] = block.split(',', 2);
      return String(rest || '')
        .split(',')
        .map((entry) => {
          const parts = entry.split('/');
          if (parts.length < 4) return null;
          return `${kind.trim()} ${parts[1]} ${formatTime(parts[3])}`;
        })
        .filter(Boolean);
    });

  if (!meetings.length) return value;
  const shown = meetings.slice(0, 3).join('; ');
  return meetings.length > 3 ? `${shown}; +${meetings.length - 3} more` : shown;
}

function findMockCourse(courseId) {
  const id = normalizeCourseId(courseId);
  return mockData.catalog.find((course) => normalizeCourseId(course.id) === id) || null;
}

function normalizeCurrentCourse(raw, options = {}) {
  const mockCourse = options.mockCourse || findMockCourse(raw && (raw.subject_id || raw.id));
  const id = normalizeCourseId((raw && (raw.subject_id || raw.id)) || (mockCourse && mockCourse.id));
  if (!id) return null;

  const requirements = [
    ...splitRequirements(raw && raw.gir_attribute),
    ...splitRequirements(raw && raw.hass_attribute),
    ...splitRequirements(raw && raw.communication_requirement),
    ...asArray(mockCourse && mockCourse.satisfies),
  ].filter((value, index, list) => list.indexOf(value) === index);

  const inClassHours = Number(raw && raw.in_class_hours);
  const outOfClassHours = Number(raw && raw.out_of_class_hours);
  const hasHourParts = Number.isFinite(inClassHours) || Number.isFinite(outOfClassHours);
  const totalHours = hasHourParts
    ? Number(((Number.isFinite(inClassHours) ? inClassHours : 0) + (Number.isFinite(outOfClassHours) ? outOfClassHours : 0)).toFixed(2))
    : (mockCourse && mockCourse.hydrant) || null;

  const rawSchedule = (raw && raw.schedule) || (mockCourse && mockCourse.schedule) || '';
  const ratingValue = Number(raw && raw.rating);

  return {
    id,
    name: (raw && raw.title) || (mockCourse && mockCourse.name) || id,
    desc: (raw && raw.description) || (mockCourse && mockCourse.desc) || '',
    units: Number(raw && raw.total_units) || (mockCourse && mockCourse.units) || 0,
    instructorText: asArray(raw && raw.instructors).join(', ') || (mockCourse && mockCourse.instructor) || '',
    prerequisitesRaw: (raw && raw.prerequisites) || asArray(mockCourse && mockCourse.prereqs).join(', '),
    requirements,
    scheduleRaw: rawSchedule,
    scheduleDisplay: formatSchedule(rawSchedule) || rawSchedule || 'Schedule TBD',
    relatedSubjects: asArray(raw && raw.related_subjects),
    rating: Number.isFinite(ratingValue)
      ? { value: ratingValue, scale: 7, source: 'fireroad' }
      : (mockCourse && mockCourse.rating ? { ...mockCourse.rating, scale: 5, source: 'mock' } : null),
    enrollmentNumber: raw && raw.enrollment_number ? Number(raw.enrollment_number) : null,
    inClassHours: Number.isFinite(inClassHours) ? inClassHours : null,
    outOfClassHours: Number.isFinite(outOfClassHours) ? outOfClassHours : null,
    totalHours,
    catalogUrl: (raw && raw.url) || null,
    oldId: (raw && raw.old_id) || null,
    offered: {
      fall: Boolean(raw && raw.offered_fall),
      iap: Boolean(raw && raw.offered_IAP),
      spring: Boolean(raw && raw.offered_spring),
      summer: Boolean(raw && raw.offered_summer),
    },
    level: (raw && raw.level) || null,
    area: (mockCourse && mockCourse.area) || areaForCourseId(id),
    source: raw ? 'fireroad' : 'mock',
  };
}

module.exports = {
  areaForCourseId,
  findMockCourse,
  formatSchedule,
  normalizeCourseId,
  normalizeCurrentCourse,
};
