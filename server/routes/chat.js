const express = require('express');
const { buildLocalActionFallback, publicErrorMessage, runAgentChat } = require('../chat/agent');

const router = express.Router();

router.post('/', async (req, res) => {
  if (!process.env.OPENROUTER_API_KEY) {
    const fallback = buildLocalActionFallback(req.body, new Error('OPENROUTER_API_KEY is not set'));
    if (fallback) return res.json(fallback);

    return res.status(503).json({
      message: {
        role: 'agent',
        text: 'The planner still works, but the chat agent needs OPENROUTER_API_KEY set on the server.',
        suggestions: [],
      },
      uiActions: [],
      debug: { toolCalls: [] },
    });
  }

  try {
    const result = await runAgentChat(req.body || {});
    if (result.debug.toolCalls.length) {
      console.log('[agent tools]', result.debug.toolCalls.map((call) => call.name).join(', '));
    }
    res.json(result);
  } catch (error) {
    console.error('[agent error]', error);
    const fallback = buildLocalActionFallback(req.body, error);
    if (fallback) return res.json(fallback);

    const message = publicErrorMessage(error);
    res.status(error.status && error.status < 500 ? 502 : 500).json({
      message: {
        role: 'agent',
        text: message,
        suggestions: [],
      },
      uiActions: [],
      error: message,
    });
  }
});

module.exports = router;
