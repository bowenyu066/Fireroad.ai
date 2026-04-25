function normalizeCourseId(courseId) {
  return String(courseId || '').trim().toUpperCase();
}

function normalizeTerm(term) {
  const raw = String(term || '').trim();
  if (!raw) return '';

  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const shortMatch = compact.match(/^(FA|FALL|F|SP|SPRING|S|SU|SUMMER|IAP)(\d{2}|\d{4})$/);
  if (shortMatch) {
    const seasonMap = {
      FA: 'FA',
      FALL: 'FA',
      F: 'FA',
      SP: 'SP',
      SPRING: 'SP',
      S: 'SP',
      SU: 'SU',
      SUMMER: 'SU',
      IAP: 'IAP',
    };
    const year = shortMatch[2].length === 2 ? `20${shortMatch[2]}` : shortMatch[2];
    return `${seasonMap[shortMatch[1]]}${year}`;
  }

  return compact;
}

function normalizeDocType(docType) {
  const raw = String(docType || '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (['syllabus', 'homepage', 'ocw', 'catalog', 'pdf', 'html'].includes(raw)) return raw;
  return raw.replace(/[^a-z0-9_-]+/g, '_');
}

module.exports = {
  normalizeCourseId,
  normalizeDocType,
  normalizeTerm,
};
