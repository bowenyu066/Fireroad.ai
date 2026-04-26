// Shared parser for generated personal_course.md files.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PersonalCourse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COURSE_SECTIONS = [
    ['## Completed / For-Credit Courses', 'completed'],
    ['## Prior Credits', 'prior_credit'],
    ['## Prior Credit', 'prior_credit'],
    ['## Listener Courses', 'listener'],
    ['## Dropped Courses', 'dropped'],
    ['## Other Transcript Entries', 'other'],
  ];

  function normalizeCourseId(value) {
    return String(value || '').trim().toUpperCase();
  }

  function decodeMarkdownCell(value) {
    return String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&#38;/gi, '&')
      .replace(/\\&/g, '&')
      .replace(/＆/g, '&');
  }

  function splitTableRow(row) {
    return String(row || '')
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sectionBody(markdown, heading) {
    const text = String(markdown || '');
    const pattern = new RegExp(`(^|\\n)${escapeRegExp(heading)}\\s*(\\n|$)`);
    const match = pattern.exec(text);
    if (!match) return '';
    const rest = text.slice(match.index + match[0].length);
    const next = rest.search(/\n## /);
    return next === -1 ? rest : rest.slice(0, next);
  }

  function normalizeGradeCode(value) {
    return decodeMarkdownCell(value).trim().toUpperCase().replace(/\s+/g, '');
  }

  function classifyCourseStatus(sectionStatus, grade, auditInfo, notes) {
    const gradeCode = normalizeGradeCode(grade);
    const auditCode = normalizeGradeCode(auditInfo);
    const notesCode = normalizeGradeCode(notes);
    const evidence = [gradeCode, auditCode, notesCode].join(' ');
    if (/\bLIS\b/.test(evidence)) return 'listener';
    if (/\bDR\b/.test(evidence)) return 'dropped';
    if (gradeCode === 'S' || /&$/.test(gradeCode) || /(?:TRANSFER|ADVANCEDSTANDING|ASE|PRIORCREDIT)/.test(evidence)) return 'prior_credit';
    return sectionStatus;
  }

  // MIT ASE/advanced-standing grades end in `&` (e.g. `A&`, `B&`, `P&`).
  // The LLM that parses the transcript sometimes strips the `&` even though
  // the prompt says to keep it. When a row lands in Prior Credits and its
  // grade is a bare letter grade, restore the `&` so downstream classification
  // and display stay correct.
  function restoreAseAmpersand(sectionStatus, grade, auditInfo) {
    if (sectionStatus !== 'prior_credit') return grade;
    const code = normalizeGradeCode(grade);
    if (!code) return grade;
    if (/&$/.test(code)) return grade;
    if (code === 'S') return grade; // MIT transfer credit
    const auditCode = normalizeGradeCode(auditInfo);
    if (/TRANSFERCREDIT/.test(auditCode)) return grade;
    if (/^[A-FPX][+\-]?$/.test(code)) return `${String(grade).trim()}&`;
    return grade;
  }

  function normalizePriorCreditCourseId(id, status) {
    const courseId = normalizeCourseId(id);
    if (status !== 'prior_credit') return courseId;
    const introPhysicsAliases = {
      '8.01L': '8.01',
      '8.02L': '8.02',
    };
    return introPhysicsAliases[courseId] || courseId;
  }

  function countsTowardRequirements(course) {
    return course && (course.status === 'completed' || course.status === 'prior_credit');
  }

  function belongsInTermPlan(course) {
    return course && course.status === 'completed';
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
        const rawId = normalizeCourseId(cells[1]);
        if (!rawId || rawId === 'UNKNOWN') return;

        const rawGrade = /^unknown$/i.test(cells[5]) ? '' : cells[5];
        const auditInfo = /^unknown$/i.test(cells[6]) ? '' : cells[6];
        const notes = /^unknown$/i.test(cells[7]) ? '' : cells[7];
        const grade = restoreAseAmpersand(status, rawGrade, auditInfo);
        const nextStatus = classifyCourseStatus(status, grade, auditInfo, notes);
        const id = normalizePriorCreditCourseId(rawId, nextStatus);

        courses.push({
          term: /^unknown$/i.test(cells[0]) ? '' : cells[0],
          id,
          name: /^unknown$/i.test(cells[2]) ? '' : cells[2],
          units: /^unknown$/i.test(cells[3]) ? '' : cells[3],
          level: /^unknown$/i.test(cells[4]) ? '' : cells[4],
          grade,
          auditInfo,
          notes,
          status: nextStatus,
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

    const academicYear = raw.match(/\b(20\d{2}|19\d{2})\b\D+\b(20\d{2}|19\d{2})\b/)
      || compact.match(/(20\d{2}|19\d{2})(20\d{2}|19\d{2})/);
    if (academicYear) {
      const startYear = academicYear[1].slice(-2);
      const endYear = academicYear[2].slice(-2);
      if (/fall|fa/i.test(raw) || /^FA/.test(compact) || /^FALL/.test(compact)) return `F${startYear}`;
      if (/spring|spr|sp/i.test(raw) || /^SP/.test(compact) || /^SPRING/.test(compact)) return `S${endYear}`;
      if (/summer|sum|su/i.test(raw) || /^SU/.test(compact) || /^SUMMER/.test(compact)) return `SU${endYear}`;
      if (/iap|january|jan/i.test(raw) || /^IAP/.test(compact) || /^JAN/.test(compact)) return `IAP${endYear}`;
    }

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
      .filter(belongsInTermPlan)
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
    const priorCreditCourses = courses.filter((course) => course.status === 'prior_credit');
    const requirementCourses = courses.filter(countsTowardRequirements);
    const listenerCourses = courses.filter((course) => course.status === 'listener');
    const droppedCourses = courses.filter((course) => course.status === 'dropped');
    return {
      courses,
      completedCourses,
      priorCreditCourses,
      requirementCourses,
      listenerCourses,
      droppedCourses,
      completedCourseIds: [...new Set(requirementCourses.map((course) => course.id))],
      termCompletedCourseIds: [...new Set(completedCourses.map((course) => course.id))],
      priorCreditCourseIds: [...new Set(priorCreditCourses.map((course) => course.id))],
      listenerCourseIds: [...new Set(listenerCourses.map((course) => course.id))],
      droppedCourseIds: [...new Set(droppedCourses.map((course) => course.id))],
      coursePreferences,
      completedPlan: planFromCompletedCourses(markdown),
    };
  }

  return {
    belongsInTermPlan,
    countsTowardRequirements,
    normalizeCourseId,
    normalizeGradeCode,
    parseCourseRows,
    parseCoursePreferences,
    planFromCompletedCourses,
    sectionBody,
    summarize,
    termIdFromLabel,
  };
});
