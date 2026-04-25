const express = require('express');
const { OPENROUTER_MODEL } = require('../chat/openrouter');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    model: OPENROUTER_MODEL,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
  });
});

module.exports = router;
