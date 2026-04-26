const express = require('express');
const { createHistoryRepo } = require('./repo');
const {
  buildCourseHistorySummary,
  buildOfferingDetailSummary,
  buildOfferingSummary,
  buildSourceSummary,
} = require('./summary');

const router = express.Router();

function asyncHandler(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error('[history error]', error);
      res.status(500).json({ error: error.message || 'History API error' });
    });
  };
}

router.get('/stats', asyncHandler(async (req, res) => {
  const repo = createHistoryRepo();
  res.json({ stats: repo.getHistoryStats() });
}));

router.get('/course/:courseId', asyncHandler(async (req, res) => {
  const repo = createHistoryRepo();
  const course = repo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json({ error: `Course ${req.params.courseId} not found in history database.` });

  const aliases = repo.getCourseAliases(course.id);
  const offerings = repo.listCourseOfferings(course.id).map((offering) => {
    const documents = repo.listOfferingDocuments(offering.id);
    return buildOfferingSummary(
      offering,
      documents,
      repo.getLatestAttendancePolicy(offering.id),
      repo.getLatestGradingPolicy(offering.id),
      { aliases },
    );
  }).filter((offering) => offering.includeInPastOfferings !== false);

  res.json({
    course,
    aliases,
    summary: buildCourseHistorySummary(course, aliases, offerings),
    offerings,
  });
}));

router.get('/course/:courseId/offerings', asyncHandler(async (req, res) => {
  const repo = createHistoryRepo();
  const course = repo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json({ error: `Course ${req.params.courseId} not found in history database.` });

  const aliases = repo.getCourseAliases(course.id);
  const offerings = repo.listCourseOfferings(course.id).map((offering) => buildOfferingSummary(
    offering,
    repo.listOfferingDocuments(offering.id),
    repo.getLatestAttendancePolicy(offering.id),
    repo.getLatestGradingPolicy(offering.id),
    { aliases },
  )).filter((offering) => offering.includeInPastOfferings !== false);

  res.json({
    course,
    offerings,
  });
}));

router.get('/offering/:offeringId', asyncHandler(async (req, res) => {
  const repo = createHistoryRepo();
  const offering = repo.getOfferingById(req.params.offeringId);
  if (!offering) return res.status(404).json({ error: `Offering ${req.params.offeringId} not found in history database.` });

  const documents = repo.listOfferingDocuments(offering.id);
  const attendancePolicy = repo.getLatestAttendancePolicy(offering.id);
  const gradingPolicy = repo.getLatestGradingPolicy(offering.id);
  const aliases = repo.getCourseAliases(offering.courseId);

  res.json({
    offering,
    summary: buildOfferingDetailSummary(offering, documents, attendancePolicy, gradingPolicy, { aliases }),
    sources: documents.map((document) => buildSourceSummary(
      document,
      attendancePolicy,
      gradingPolicy,
      repo.getLatestExtractionRun(document.id),
    )),
    attendancePolicy,
    gradingPolicy,
  });
}));

module.exports = router;
