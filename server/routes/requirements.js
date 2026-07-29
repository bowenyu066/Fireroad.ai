'use strict';

const express = require('express');
const { evaluateMajorRequirements, resolveMajorKey } = require('../requirements/evaluate');

const router = express.Router();

// POST /api/requirements/check
// Body: { major | majorKey, courses: [] }
// Evaluates degree requirements with GIR/HASS expansion plus official catalog
// equivalences. Petition examples remain advisory (see server/requirements/evaluate.js).
router.post('/check', async (req, res) => {
  try {
    const { major, majorKey, courses = [] } = req.body || {};
    const key = resolveMajorKey(majorKey || major);

    if (!key) {
      return res.status(400).json({ error: 'Provide major (e.g. "Course 6-3") or majorKey (e.g. "girs")' });
    }

    const result = await evaluateMajorRequirements(key, courses);
    if (!result) {
      return res.status(404).json({ error: `No requirements found for "${key}"` });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
