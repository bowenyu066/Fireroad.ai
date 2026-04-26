function present(value, fallback = 'unknown') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function courseIdsFromUrl(url) {
  const raw = String(url || '').toLowerCase();
  const ids = [];
  const patterns = [
    /(?:^|[^a-z0-9])(\d{1,2})[._-](\d{2,4}[a-z]?)(?=$|[^a-z0-9])/g,
    /mitx\+(\d{1,2})\.(\d{2,4}[a-z]?)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw))) {
      ids.push(`${match[1]}.${match[2].replace(/^0+(\d{2})$/, '0$1')}`);
    }
  }
  return unique(ids);
}

function validCourseIds(offering, context = {}) {
  return unique([
    offering.courseId,
    ...(context.aliases || []).map((alias) => alias.aliasId || alias.alias_id || alias),
  ].map((id) => String(id || '').toLowerCase()));
}

function sourceMatchesCourse(url, offering, context = {}) {
  const ids = courseIdsFromUrl(url);
  if (!ids.length) return true;
  const allowed = validCourseIds(offering, context);
  return allowed.includes(ids[0]);
}

function normalizeUrlForDisplay(url) {
  try {
    const parsed = new URL(url);
    const keepCatalogHash = parsed.hostname.includes('student.mit.edu') && parsed.pathname.includes('/catalog/');
    if (!keepCatalogHash) parsed.hash = '';
    parsed.searchParams.delete('activate_block_id');
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');

    if (parsed.hostname.includes('openlearninglibrary.mit.edu')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const courseIndex = parts.indexOf('courses');
      if (courseIndex >= 0 && parts[courseIndex + 1]) {
        parsed.pathname = `/courses/${parts[courseIndex + 1]}/about`;
        parsed.search = '';
      }
    }

    if (parsed.hostname.includes('ocw.mit.edu')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const courseIndex = parts.indexOf('courses');
      if (courseIndex >= 0 && parts[courseIndex + 1]) {
        parsed.pathname = `/courses/${parts[courseIndex + 1]}/`;
        parsed.search = '';
      }
    }

    return parsed.toString();
  } catch (error) {
    return String(url || '').trim();
  }
}

function sourceGroupKey(url) {
  const normalized = normalizeUrlForDisplay(url);
  try {
    const parsed = new URL(normalized);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch (error) {
    return normalized;
  }
}

function termRank(term) {
  const raw = String(term || '').toUpperCase();
  const match = raw.match(/^(\d{4})(FA|SP|SU|IAP)$/) || raw.match(/^(FA|SP|SU|IAP)(\d{4})$/);
  if (!match) return raw;
  const year = match[1].length === 4 ? match[1] : match[2];
  const season = match[1].length === 4 ? match[2] : match[1];
  const seasonOrder = { IAP: 1, SP: 2, SU: 3, FA: 4 };
  return `${year}${String(seasonOrder[season] || 0).padStart(2, '0')}`;
}

function currentTermRank(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month === 1) return `${year}01`;
  if (month <= 5) return `${year}02`;
  if (month <= 8) return `${year}03`;
  return `${year}04`;
}

function isDatedPastTerm(term, date = new Date()) {
  const raw = String(term || '').toUpperCase();
  if (!/^\d{4}(FA|SP|SU|IAP)$/.test(raw)) return false;
  return termRank(raw) < currentTermRank(date);
}

function sortedTerms(offerings) {
  return unique(offerings.map((offering) => offering.term))
    .filter((term) => /^\d{4}(FA|SP|SU|IAP)$/i.test(String(term || '')))
    .sort((a, b) => termRank(a).localeCompare(termRank(b)));
}

function sourceTypesForOffering(offering, documents = [], context = {}) {
  const fromOffering = [
    offering.homepageUrl && sourceMatchesCourse(offering.homepageUrl, offering, context) ? 'homepage' : null,
    offering.syllabusUrl && sourceMatchesCourse(offering.syllabusUrl, offering, context) ? 'syllabus' : null,
    offering.ocwUrl && sourceMatchesCourse(offering.ocwUrl, offering, context) ? 'ocw' : null,
  ];
  const filteredDocuments = documents.filter((doc) => sourceMatchesCourse(doc.url || doc.archivedUrl, offering, context));
  const fromDocuments = filteredDocuments.flatMap((doc) => [
    doc.docType,
    doc.archivedUrl ? 'archive' : null,
  ]);
  return unique([...fromOffering, ...fromDocuments].map((type) => String(type || '').toLowerCase()));
}

function sourceLabel(type) {
  const raw = String(type || '').toLowerCase();
  const labels = {
    archive: 'Archive',
    catalog: 'Catalog',
    homepage: 'Homepage',
    html: 'HTML',
    open_learning: 'Open Learning',
    ocw: 'OCW',
    pdf: 'PDF',
    syllabus: 'Syllabus',
    text: 'Text',
    unknown: 'Source',
  };
  return labels[raw] || raw || 'Source';
}

function inferSourceType(type, url) {
  const raw = String(type || '').toLowerCase();
  const href = String(url || '').toLowerCase();
  if (href.includes('ocw.mit.edu')) return 'ocw';
  if (href.includes('openlearninglibrary.mit.edu')) return 'open_learning';
  if (href.includes('student.mit.edu/catalog') || href.includes('fireroad.mit.edu/courses/lookup')) return 'catalog';
  if (href.includes('web.archive.org')) return 'archive';
  return raw || 'unknown';
}

function buildSourceLinks(offering, documents = [], context = {}) {
  const rawLinks = [
    offering.homepageUrl && sourceMatchesCourse(offering.homepageUrl, offering, context) && { docType: 'homepage', url: offering.homepageUrl },
    offering.syllabusUrl && sourceMatchesCourse(offering.syllabusUrl, offering, context) && { docType: 'syllabus', url: offering.syllabusUrl },
    offering.ocwUrl && sourceMatchesCourse(offering.ocwUrl, offering, context) && { docType: 'ocw', url: offering.ocwUrl },
    ...documents.filter((document) => sourceMatchesCourse(document.url || document.archivedUrl, offering, context)).flatMap((document) => [
      document.url && { docType: document.docType || 'unknown', url: document.url, documentId: document.id },
      document.archivedUrl && { docType: 'archive', url: document.archivedUrl, documentId: document.id },
    ]),
  ].filter(Boolean);

  const seen = new Set();
  const counts = {};
  return rawLinks.filter((link) => {
    const displayUrl = normalizeUrlForDisplay(link.url);
    const type = inferSourceType(link.docType, displayUrl);
    const key = sourceGroupKey(displayUrl);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    link.url = displayUrl;
    link.docType = type;
    return true;
  }).map((link) => {
    const type = link.docType;
    counts[type] = (counts[type] || 0) + 1;
    const baseLabel = sourceLabel(type);
    return {
      ...link,
      docType: type,
      label: counts[type] > 1 ? `${baseLabel} ${counts[type]}` : baseLabel,
    };
  });
}

function coverageLevelFromSummary(summary) {
  if (!summary.offeringCount) return 'none';
  const policyCoverage = summary.attendancePolicyCount + summary.gradingPolicyCount;
  const sourceCoverage = summary.homepageCount + summary.syllabusCount + summary.archiveCount + summary.ocwCount;
  if (policyCoverage >= summary.offeringCount && sourceCoverage >= summary.offeringCount) return 'high';
  if (policyCoverage > 0 || sourceCoverage >= Math.ceil(summary.offeringCount / 2)) return 'medium';
  if (sourceCoverage > 0) return 'low';
  return 'minimal';
}

function triStateLabel(value, yesLabel, noLabel, unknownLabel = 'Unknown') {
  const raw = String(value || 'unknown').toLowerCase();
  if (raw === 'yes') return yesLabel;
  if (raw === 'no') return noLabel;
  return unknownLabel;
}

function buildAttendancePolicySummary(policy) {
  if (!policy) {
    return {
      status: 'missing',
      summaryText: 'Attendance: Not specified in the available source.',
      evidencePreview: '',
    };
  }

  const required = triStateLabel(policy.attendanceRequired, 'required', 'not required', 'requirement unknown');
  const grade = triStateLabel(policy.attendanceCountsTowardGrade, 'counts toward grade', 'does not count toward grade', 'grade impact unknown');
  const notes = previewText(policy.attendanceNotes, 180);
  const bits = [`Attendance: ${required}`, grade].filter(Boolean);
  if (notes) bits.push(notes);

  return {
    status: 'available',
    required: policy.attendanceRequired || 'unknown',
    countsTowardGrade: policy.attendanceCountsTowardGrade || 'unknown',
    notes: policy.attendanceNotes,
    summaryText: bits.join('; '),
    evidencePreview: previewText(policy.evidenceText, 220),
    confidence: policy.confidence,
    reviewStatus: policy.reviewStatus,
  };
}

function weightBits(policy) {
  return [
    ['participation', policy.participationWeight],
    ['homework', policy.homeworkWeight],
    ['project', policy.projectWeight],
    ['lab', policy.labWeight],
    ['quiz', policy.quizWeight],
    ['midterm', policy.midtermWeight],
    ['final', policy.finalWeight],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => {
      const numeric = Number(value);
      const displayValue = Number.isFinite(numeric) && numeric > 0 && numeric <= 1
        ? numeric * 100
        : numeric;
      return `${label} ${Number.isFinite(displayValue) ? displayValue : value}%`;
    });
}

function buildGradingPolicySummary(policy) {
  if (!policy) {
    return {
      status: 'missing',
      summaryText: 'Grading: Not specified in the available source.',
      evidencePreview: '',
    };
  }

  const weights = weightBits(policy);
  const participation = triStateLabel(policy.hasParticipationComponent, 'participation included', 'no participation component', '');
  const letterGrade = triStateLabel(policy.letterGrade, 'letter graded', 'not letter graded', '');
  const notes = [
    weights.length ? weights.join(', ') : null,
    participation,
    letterGrade,
    previewText(policy.gradingNotes, 140),
    previewText(policy.latePolicyText, 140),
  ].filter(Boolean);

  return {
    status: 'available',
    letterGrade: policy.letterGrade || 'unknown',
    hasParticipationComponent: policy.hasParticipationComponent || 'unknown',
    weights: Object.fromEntries([
      ['participation', policy.participationWeight],
      ['homework', policy.homeworkWeight],
      ['project', policy.projectWeight],
      ['lab', policy.labWeight],
      ['quiz', policy.quizWeight],
      ['midterm', policy.midtermWeight],
      ['final', policy.finalWeight],
    ].filter(([, value]) => value !== null && value !== undefined && value !== '')),
    summaryText: `Grading: ${notes.length ? notes.join('; ') : 'policy found, details unavailable'}`,
    evidencePreview: previewText(policy.evidenceText, 220),
    confidence: policy.confidence,
    reviewStatus: policy.reviewStatus,
  };
}

function policyText(attendancePolicy, gradingPolicy) {
  const parts = [];
  if (attendancePolicy) {
    parts.push(`attendance ${present(attendancePolicy.attendanceRequired)}`);
  } else {
    parts.push('attendance unavailable');
  }
  if (gradingPolicy) {
    if (gradingPolicy.hasParticipationComponent) {
      parts.push(`participation ${gradingPolicy.hasParticipationComponent}`);
    } else if (gradingPolicy.letterGrade) {
      parts.push(`letter grade ${gradingPolicy.letterGrade}`);
    } else {
      parts.push('grading extracted');
    }
  } else {
    parts.push('grading unavailable');
  }
  return parts.join('; ');
}

function buildOfferingSummary(offering, documents = [], attendancePolicy = null, gradingPolicy = null, context = {}) {
  const sourceTypes = sourceTypesForOffering(offering, documents, context);
  const sourceLinks = buildSourceLinks(offering, documents, context);
  const title = offering.titleSnapshot || offering.courseId;
  const sourcePhrase = sourceTypes.length ? `sources: ${sourceTypes.join(', ')}` : 'no sources captured yet';
  const policyPhrase = policyText(attendancePolicy, gradingPolicy);
  const generatedSummary = `${present(offering.term)} offering of ${title}; ${sourcePhrase}; ${policyPhrase}.`;
  const offeringMarkdown = looksLikeOfferingMarkdown(offering.notes) ? normalizeDisplayMarkdown(previewMarkdown(offering.notes)) : '';

  return {
    id: offering.id,
    term: offering.term,
    includeInPastOfferings: isDatedPastTerm(offering.term),
    titleSnapshot: offering.titleSnapshot,
    instructorText: offering.instructorText,
    sourceTypes,
    sourceCount: sourceLinks.length || documents.length,
    documentCount: documents.length,
    sourceLinks,
    hasAttendancePolicy: Boolean(attendancePolicy),
    hasGradingPolicy: Boolean(gradingPolicy),
    attendancePolicySummary: buildAttendancePolicySummary(attendancePolicy),
    gradingPolicySummary: buildGradingPolicySummary(gradingPolicy),
    offeringMarkdownText: offeringMarkdown,
    offeringSummaryText: previewMarkdownAsText(offeringMarkdown, 360) || previewText(offering.notes, 360) || generatedSummary,
    homepageUrl: offering.homepageUrl,
    syllabusUrl: offering.syllabusUrl,
    ocwUrl: offering.ocwUrl,
    notes: offering.notes,
  };
}

function policyForDocument(document, attendancePolicy, gradingPolicy) {
  const matchesAttendance = attendancePolicy && attendancePolicy.evidenceDocumentId === document.id;
  const matchesGrading = gradingPolicy && gradingPolicy.evidenceDocumentId === document.id;
  return {
    matchesAttendance,
    matchesGrading,
    hasExtractedPolicy: Boolean(matchesAttendance || matchesGrading),
  };
}

function previewText(text, maxLength = 260) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function previewMarkdown(text, maxLength = 1400) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function looksLikeOfferingMarkdown(text) {
  const raw = String(text || '');
  return raw.includes('**Course Format:**')
    || raw.includes('**Attendance:**')
    || raw.includes('**Grading:**')
    || raw.includes('**Attendance Policy:**')
    || raw.includes('**Grading Policy:**');
}

function normalizeDisplayMarkdown(text) {
  return String(text || '')
    .replace(/\*\*Attendance Policy:\*\*/gi, '**Attendance:**')
    .replace(/\*\*Grading Policy:\*\*/gi, '**Grading:**');
}

function previewMarkdownAsText(text, maxLength = 360) {
  return previewText(String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\s*\n+\s*/g, ' '), maxLength);
}

function parseExtractionJson(extractionRun) {
  if (!extractionRun || !extractionRun.parsedJson) return null;
  try {
    return JSON.parse(extractionRun.parsedJson);
  } catch (error) {
    return null;
  }
}

function extractedSourceSummary(extractionRun) {
  const parsed = parseExtractionJson(extractionRun);
  return previewText(
    parsed?.source_summary
      || parsed?.sourceSummary
      || parsed?.source?.summary
      || parsed?.summary,
    360,
  );
}

function buildSourceSummary(document, attendancePolicy = null, gradingPolicy = null, extractionRun = null) {
  const policy = policyForDocument(document, attendancePolicy, gradingPolicy);
  const evidencePreview = previewText(
    (policy.matchesAttendance && attendancePolicy.evidenceText)
      || (policy.matchesGrading && gradingPolicy.evidenceText)
      || document.rawText,
  );

  const sourceBits = [
    document.docType || 'unknown source',
    document.url ? 'url available' : null,
    document.archivedUrl ? 'archive available' : null,
    policy.hasExtractedPolicy ? 'policy evidence linked' : 'no extracted policy linked',
  ].filter(Boolean);
  const modelSummary = extractedSourceSummary(extractionRun);

  return {
    id: document.id,
    docType: document.docType,
    url: document.url,
    archivedUrl: document.archivedUrl,
    fetchedAt: document.fetchedAt,
    contentType: document.contentType,
    sourceSummaryText: modelSummary || sourceBits.join('; '),
    evidencePreview,
    hasExtractedPolicy: policy.hasExtractedPolicy,
  };
}

function buildCourseHistorySummary(course, aliases = [], offeringSummaries = []) {
  const displayOfferings = offeringSummaries.filter((offering) => isDatedPastTerm(offering.term));
  const terms = sortedTerms(displayOfferings);
  const summary = {
    offeringCount: displayOfferings.length,
    homepageCount: displayOfferings.filter((offering) => offering.sourceTypes.includes('homepage') || offering.homepageUrl).length,
    syllabusCount: displayOfferings.filter((offering) => offering.sourceTypes.includes('syllabus') || offering.syllabusUrl).length,
    archiveCount: displayOfferings.filter((offering) => offering.sourceTypes.includes('archive')).length,
    ocwCount: displayOfferings.filter((offering) => offering.sourceTypes.includes('ocw') || offering.ocwUrl).length,
    attendancePolicyCount: displayOfferings.filter((offering) => offering.hasAttendancePolicy).length,
    gradingPolicyCount: displayOfferings.filter((offering) => offering.hasGradingPolicy).length,
    earliestTerm: terms[0] || null,
    latestTerm: terms[terms.length - 1] || null,
    coverageLevel: 'none',
    topSummaryText: '',
  };
  summary.coverageLevel = coverageLevelFromSummary(summary);

  const courseName = course && (course.currentTitle || course.id) ? course.currentTitle || course.id : 'This course';
  if (!summary.offeringCount) {
    summary.topSummaryText = `${courseName} has no historical offerings captured yet.`;
    return summary;
  }

  const range = summary.earliestTerm
    ? (summary.earliestTerm === summary.latestTerm ? summary.latestTerm : `${summary.earliestTerm} through ${summary.latestTerm}`)
    : 'undated terms';

  summary.topSummaryText = `${courseName} has records from ${summary.offeringCount} past offering${summary.offeringCount === 1 ? '' : 's'} (${range}).`;
  if (aliases.length) {
    summary.topSummaryText += ` Known aliases: ${aliases.map((alias) => alias.aliasId).join(', ')}.`;
  }
  return summary;
}

function buildOfferingDetailSummary(offering, documents = [], attendancePolicy = null, gradingPolicy = null, context = {}) {
  const summary = buildOfferingSummary(offering, documents, attendancePolicy, gradingPolicy, context);
  return {
    sourceCount: summary.sourceCount,
    sourceTypes: summary.sourceTypes,
    sourceLinks: summary.sourceLinks,
    hasAttendancePolicy: summary.hasAttendancePolicy,
    hasGradingPolicy: summary.hasGradingPolicy,
    attendancePolicySummary: summary.attendancePolicySummary,
    gradingPolicySummary: summary.gradingPolicySummary,
    offeringMarkdownText: summary.offeringMarkdownText,
    offeringSummaryText: summary.offeringSummaryText,
  };
}

module.exports = {
  buildCourseHistorySummary,
  buildOfferingDetailSummary,
  buildOfferingSummary,
  buildSourceSummary,
  isDatedPastTerm,
  sourceTypesForOffering,
};
