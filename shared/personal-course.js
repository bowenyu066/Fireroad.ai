// Shared parser for generated personal_course.md files.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PersonalCourse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COURSE_SECTIONS = [
    ['## Completed / For-Credit Courses', 'completed'],
    ['## Listener Courses', 'listener'],
    ['## Dropped Courses', 'dropped'],
    ['## Other Transcript Entries', 'other'],
  ];

  function normalizeCourseId(value) {
    return String(value || '').trim().toUpperCase();
  }

  function splitTableRow(row) {
    return String(row || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function sectionBody(markdown, heading) {
    const text = String(markdown || '');
    const start = text.indexOf(heading);
    if (start === -1) return '';
    const rest = text.slice(start + heading.length);
    const next = rest.search(/\n## /);
    return next === -1 ? rest : rest.slice(0, next);
  }

  function parseCourseRows(markdown) {
    const courses = [];

    COURSE_SECTIONS.forEach(([heading, status]) => {
      const body = sectionBody(markdown, heading);
      const source = heading.replace(/^## /, '');
      body.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) return;
        if (/^\|\s*-+/.test(trimmed) || /^\|\s*Term\s*\|/i.test(trimmed)) return;

        const cells = splitTableRow(trimmed);
        if (cells.length < 8 || /^none$/i.test(cells[0]) || cells[1] === '—') return;
        const id = normalizeCourseId(cells[1]);
        if (!id || id === 'UNKNOWN') return;

        courses.push({
          term: /^unknown$/i.test(cells[0]) ? '' : cells[0],
          id,
          name: /^unknown$/i.test(cells[2]) ? '' : cells[2],
          units: /^unknown$/i.test(cells[3]) ? '' : cells[3],
          level: /^unknown$/i.test(cells[4]) ? '' : cells[4],
          grade: /^unknown$/i.test(cells[5]) ? '' : cells[5],
          auditInfo: /^unknown$/i.test(cells[6]) ? '' : cells[6],
          notes: /^unknown$/i.test(cells[7]) ? '' : cells[7],
          status,
          source,
          preference: 'neutral',
        });
      });
    });

    return courses;
  }

  function parseCoursePreferences(markdown) {
    const body = sectionBody(markdown, '## Course Preferences');
    const preferences = {};
    body.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) return;
      if (/^\|\s*-+/.test(trimmed) || /Subject|Course/i.test(trimmed)) return;
      const cells = splitTableRow(trimmed);
      if (cells.length < 2) return;
      const id = normalizeCourseId(cells[0]);
      const rating = String(cells[cells.length - 1] || '').trim().toLowerCase();
      if (!id || id === 'UNKNOWN' || id === 'NONE') return;
      if (/thumb[_\s-]?up|like/.test(rating)) preferences[id] = 'thumb_up';
      else if (/thumb[_\s-]?down|dislike/.test(rating)) preferences[id] = 'thumb_down';
      else if (/neutral/.test(rating)) preferences[id] = 'neutral';
    });
    return preferences;
  }

  function termIdFromLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const direct = compact.match(/^(IAP|SU|S|F)(\d{2})$/);
    if (direct) return `${direct[1]}${direct[2]}`;
    const yearThenTerm = compact.match(/^(20\d{2}|19\d{2})(SPRING|SPR|SP|FALL|FA|SUMMER|SUM|SU|IAP|JANUARY|JAN)$/);
    if (yearThenTerm) {
      const year = yearThenTerm[1].slice(-2);
      const term = yearThenTerm[2];
      if (/^SP/.test(term) || term === 'SPRING') return `S${year}`;
      if (/^FA/.test(term) || term === 'FALL') return `F${year}`;
      if (/^SU/.test(term) || term === 'SUMMER') return `SU${year}`;
      return `IAP${year}`;
    }
    const termThenYear = compact.match(/^(SPRING|SPR|SP|FALL|FA|SUMMER|SUM|SU|IAP|JANUARY|JAN)(20\d{2}|19\d{2})$/);
    if (termThenYear) {
      const year = termThenYear[2].slice(-2);
      const term = termThenYear[1];
      if (/^SP/.test(term) || term === 'SPRING') return `S${year}`;
      if (/^FA/.test(term) || term === 'FALL') return `F${year}`;
      if (/^SU/.test(term) || term === 'SUMMER') return `SU${year}`;
      return `IAP${year}`;
    }

    const yearMatch = raw.match(/\b(20\d{2}|19\d{2})\b/);
    const twoDigitYearMatch = raw.match(/\b(\d{2})\b/);
    const year = yearMatch ? yearMatch[1].slice(-2) : (twoDigitYearMatch ? twoDigitYearMatch[1] : '');
    if (!year) return '';

    if (/spring|spr|sp/i.test(raw) || /^SP\d{4}$/i.test(compact) || /^\d{4}SP$/i.test(compact)) return `S${year}`;
    if (/fall|fa/i.test(raw) || /^FA\d{4}$/i.test(compact) || /^\d{4}FA$/i.test(compact)) return `F${year}`;
    if (/summer|sum|su/i.test(raw) || /^SU\d{4}$/i.test(compact) || /^\d{4}SU$/i.test(compact)) return `SU${year}`;
    if (/iap|january|jan/i.test(raw) || /^IAP\d{4}$/i.test(compact) || /^\d{4}IAP$/i.test(compact)) return `IAP${year}`;
    return '';
  }

  function planFromCompletedCourses(markdown) {
    const plan = {};
    parseCourseRows(markdown)
      .filter((course) => course.status === 'completed')
      .forEach((course) => {
        const termId = termIdFromLabel(course.term);
        if (!termId) return;
        if (!plan[termId]) plan[termId] = [];
        if (!plan[termId].includes(course.id)) plan[termId].push(course.id);
      });
    return plan;
  }

  function summarize(markdown) {
    const courses = parseCourseRows(markdown);
    const coursePreferences = parseCoursePreferences(markdown);
    const completedCourses = courses.filter((course) => course.status === 'completed');
    const listenerCourses = courses.filter((course) => course.status === 'listener');
    const droppedCourses = courses.filter((course) => course.status === 'dropped');
    return {
      courses,
      completedCourses,
      listenerCourses,
      droppedCourses,
      completedCourseIds: [...new Set(completedCourses.map((course) => course.id))],
      listenerCourseIds: [...new Set(listenerCourses.map((course) => course.id))],
      droppedCourseIds: [...new Set(droppedCourses.map((course) => course.id))],
      coursePreferences,
      completedPlan: planFromCompletedCourses(markdown),
    };
  }

  return {
    normalizeCourseId,
    parseCourseRows,
    parseCoursePreferences,
    planFromCompletedCourses,
    sectionBody,
    summarize,
    termIdFromLabel,
  };
});
