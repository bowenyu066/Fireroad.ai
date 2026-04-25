const express = require('express');
const { createHistoryRepo } = require('./repo');

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
  const offerings = repo.listCourseOfferings(course.id);
  const stats = repo.getCoursePolicyStats(course.id);
  res.json({
    course,
    aliases,
    offerings,
    stats: {
      offeringCount: stats.offering_count,
      attendancePolicyCount: stats.attendance_policy_count,
      gradingPolicyCount: stats.grading_policy_count,
      hasPolicyCount: Math.max(stats.attendance_policy_count, stats.grading_policy_count),
    },
  });
}));

router.get('/course/:courseId/offerings', asyncHandler(async (req, res) => {
  const repo = createHistoryRepo();
  const course = repo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json({ error: `Course ${req.params.courseId} not found in history database.` });

  res.json({
    course,
    offerings: repo.listCourseOfferings(course.id),
  });
}));

router.get('/offering/:offeringId', asyncHandler(async (req, res) => {
  const repo = createHistoryRepo();
  const offering = repo.getOfferingById(req.params.offeringId);
  if (!offering) return res.status(404).json({ error: `Offering ${req.params.offeringId} not found in history database.` });

  res.json({
    offering,
    documents: repo.listOfferingDocuments(offering.id),
    attendancePolicy: repo.getLatestAttendancePolicy(offering.id),
    gradingPolicy: repo.getLatestGradingPolicy(offering.id),
  });
}));

module.exports = router;
