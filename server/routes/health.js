const express = require('express');
const { OPENROUTER_MODEL, OPENROUTER_TIMEOUT_MS } = require('../chat/openrouter');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    model: OPENROUTER_MODEL,
    openRouterTimeoutMs: OPENROUTER_TIMEOUT_MS,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
  });
});

module.exports = router;
