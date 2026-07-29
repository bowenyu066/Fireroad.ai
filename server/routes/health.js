const express = require('express');
const { AI_MODEL, AI_PROVIDER, AI_TIMEOUT_MS, hasAiApiKey } = require('../chat/provider');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    provider: AI_PROVIDER,
    model: AI_MODEL,
    timeoutMs: AI_TIMEOUT_MS,
    hasApiKey: hasAiApiKey(),
  });
});

module.exports = router;
