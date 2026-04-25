function normalizeCourseId(courseId) {
  return String(courseId || '').trim().toUpperCase();
}

function normalizeTerm(term) {
  const raw = String(term || '').trim();
  if (!raw) return '';

  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const yearFirstMatch = compact.match(/^(\d{4})(FA|FALL|F|SP|SPRING|S|SU|SUMMER|IAP)$/);
  if (yearFirstMatch) {
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
    return `${yearFirstMatch[1]}${seasonMap[yearFirstMatch[2]]}`;
  }

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
    return `${year}${seasonMap[shortMatch[1]]}`;
  }

  return compact;
}

function normalizeDocType(docType) {
  const raw = String(docType || '').trim().toLowerCase();
  if (!raw) return 'unknown';
  if (['syllabus', 'homepage', 'archive', 'ocw', 'catalog', 'pdf', 'html', 'text'].includes(raw)) return raw;
  return raw.replace(/[^a-z0-9_-]+/g, '_');
}

module.exports = {
  normalizeCourseId,
  normalizeDocType,
  normalizeTerm,
};
