function present(value, fallback = 'unknown') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
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

function sortedTerms(offerings) {
  return unique(offerings.map((offering) => offering.term))
    .sort((a, b) => termRank(a).localeCompare(termRank(b)));
}

function sourceTypesForOffering(offering, documents = []) {
  const fromOffering = [
    offering.homepageUrl ? 'homepage' : null,
    offering.syllabusUrl ? 'syllabus' : null,
    offering.ocwUrl ? 'ocw' : null,
  ];
  const fromDocuments = documents.flatMap((doc) => [
    doc.docType,
    doc.archivedUrl ? 'archive' : null,
  ]);
  return unique([...fromOffering, ...fromDocuments].map((type) => String(type || '').toLowerCase()));
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

function buildOfferingSummary(offering, documents = [], attendancePolicy = null, gradingPolicy = null) {
  const sourceTypes = sourceTypesForOffering(offering, documents);
  const title = offering.titleSnapshot || offering.courseId;
  const sourcePhrase = sourceTypes.length ? `sources: ${sourceTypes.join(', ')}` : 'no sources captured yet';
  const policyPhrase = policyText(attendancePolicy, gradingPolicy);

  return {
    id: offering.id,
    term: offering.term,
    titleSnapshot: offering.titleSnapshot,
    instructorText: offering.instructorText,
    sourceTypes,
    sourceCount: documents.length,
    hasAttendancePolicy: Boolean(attendancePolicy),
    hasGradingPolicy: Boolean(gradingPolicy),
    offeringSummaryText: `${present(offering.term)} offering of ${title}; ${sourcePhrase}; ${policyPhrase}.`,
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

function buildSourceSummary(document, attendancePolicy = null, gradingPolicy = null) {
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

  return {
    id: document.id,
    docType: document.docType,
    url: document.url,
    archivedUrl: document.archivedUrl,
    fetchedAt: document.fetchedAt,
    contentType: document.contentType,
    sourceSummaryText: sourceBits.join('; '),
    evidencePreview,
    hasExtractedPolicy: policy.hasExtractedPolicy,
  };
}

function buildCourseHistorySummary(course, aliases = [], offeringSummaries = []) {
  const terms = sortedTerms(offeringSummaries);
  const summary = {
    offeringCount: offeringSummaries.length,
    homepageCount: offeringSummaries.filter((offering) => offering.sourceTypes.includes('homepage') || offering.homepageUrl).length,
    syllabusCount: offeringSummaries.filter((offering) => offering.sourceTypes.includes('syllabus') || offering.syllabusUrl).length,
    archiveCount: offeringSummaries.filter((offering) => offering.sourceTypes.includes('archive')).length,
    ocwCount: offeringSummaries.filter((offering) => offering.sourceTypes.includes('ocw') || offering.ocwUrl).length,
    attendancePolicyCount: offeringSummaries.filter((offering) => offering.hasAttendancePolicy).length,
    gradingPolicyCount: offeringSummaries.filter((offering) => offering.hasGradingPolicy).length,
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

  const range = summary.earliestTerm === summary.latestTerm
    ? summary.latestTerm
    : `${summary.earliestTerm} through ${summary.latestTerm}`;
  const policyCoverage = [
    `${summary.attendancePolicyCount}/${summary.offeringCount} attendance`,
    `${summary.gradingPolicyCount}/${summary.offeringCount} grading`,
  ].join(', ');
  const sourceCoverage = [
    summary.syllabusCount ? `${summary.syllabusCount} syllabus` : null,
    summary.homepageCount ? `${summary.homepageCount} homepage` : null,
    summary.archiveCount ? `${summary.archiveCount} archive` : null,
    summary.ocwCount ? `${summary.ocwCount} OCW` : null,
  ].filter(Boolean).join(', ') || 'no source URLs';

  summary.topSummaryText = `${courseName} has ${summary.offeringCount} captured offering${summary.offeringCount === 1 ? '' : 's'} (${range}); ${sourceCoverage}; policy coverage: ${policyCoverage}.`;
  if (aliases.length) {
    summary.topSummaryText += ` Known aliases: ${aliases.map((alias) => alias.aliasId).join(', ')}.`;
  }
  return summary;
}

function buildOfferingDetailSummary(offering, documents = [], attendancePolicy = null, gradingPolicy = null) {
  const summary = buildOfferingSummary(offering, documents, attendancePolicy, gradingPolicy);
  return {
    sourceCount: summary.sourceCount,
    sourceTypes: summary.sourceTypes,
    hasAttendancePolicy: summary.hasAttendancePolicy,
    hasGradingPolicy: summary.hasGradingPolicy,
    offeringSummaryText: summary.offeringSummaryText,
  };
}

module.exports = {
  buildCourseHistorySummary,
  buildOfferingDetailSummary,
  buildOfferingSummary,
  buildSourceSummary,
  sourceTypesForOffering,
};
