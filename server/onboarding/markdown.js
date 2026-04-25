const COURSE_SECTIONS = [
  ['## Completed / For-Credit Courses', 'completed'],
  ['## Listener Courses', 'listener'],
  ['## Dropped Courses', 'dropped'],
  ['## Other Transcript Entries', 'other'],
];

function splitTableRow(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function sectionBody(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return '';
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

function parseCourseRows(markdown) {
  const courses = [];

  COURSE_SECTIONS.forEach(([heading, status]) => {
    const body = sectionBody(markdown, heading);
    const category = heading.replace(/^## /, '');
    body.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) return;
      if (/^\|\s*-+/.test(trimmed) || /^\|\s*Term\s*\|/i.test(trimmed)) return;

      const cells = splitTableRow(trimmed);
      if (cells.length < 8 || cells[0] === 'None' || cells[1] === '—') return;

      courses.push({
        id: cells[1],
        name: cells[2] === 'Unknown' ? '' : cells[2],
        term: cells[0] === 'Unknown' ? '' : cells[0],
        grade: cells[5] === 'Unknown' ? '' : cells[5],
        status,
        source: category,
        preference: 'neutral',
      });
    });
  });

  return courses;
}

module.exports = {
  parseCourseRows,
};
