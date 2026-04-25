const express = require('express');
const { fetchCurrentCourse, getCurrentCatalog, searchCurrentCourses } = require('./fireroad');

const router = express.Router();

function asyncHandler(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error('[current error]', error);
      res.status(500).json({ error: error.message || 'Current course API error' });
    });
  };
}

router.get('/course/:courseId', asyncHandler(async (req, res) => {
  const course = await fetchCurrentCourse(req.params.courseId);
  if (!course) return res.status(404).json({ error: `Course ${req.params.courseId} not found in current catalog.` });
  res.json({ course });
}));

router.get('/search', asyncHandler(async (req, res) => {
  const result = await searchCurrentCourses({
    query: req.query.q || '',
    maxResults: req.query.max_results,
  });
  res.json(result);
}));

router.get('/catalog', asyncHandler(async (req, res) => {
  const catalog = await getCurrentCatalog();
  const maxResults = Math.max(1, Math.min(Number(req.query.max_results) || 250, 2000));
  res.json({
    source: catalog.source,
    sourcePath: catalog.sourcePath,
    loadedAt: new Date(catalog.loadedAt).toISOString(),
    courses: catalog.courses.slice(0, maxResults),
    total: catalog.courses.length,
  });
}));

module.exports = router;
