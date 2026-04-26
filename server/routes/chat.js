const express = require('express');
const { buildLocalActionFallback, publicErrorMessage, runAgentChat, runAgentChatStream } = require('../chat/agent');
const { OPENROUTER_MODEL } = require('../chat/openrouter');

const router = express.Router();

function requestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createLogger(id) {
  return (event, payload = {}) => {
    const safePayload = JSON.stringify(payload, (key, value) => {
      if (/key|token|authorization/i.test(key)) return '[redacted]';
      if (typeof value === 'string' && value.length > 800) return `${value.slice(0, 800)}...`;
      return value;
    });
    console.log(`[agent ${id}] ${event} ${safePayload}`);
  };
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeAgentStreamEvent(res, event) {
  if (!event || !event.type) return;
  const { type, ...payload } = event;

  // Chat stream event contract:
  // - progress_text/progress_text_delta: ephemeral assistant framing shown only while working.
  // - tool_activity_*: safe tool input/result summaries for the pending progress/trace UI.
  // - final_text_delta: ordinary Markdown final answer text.
  // - trace_summary/proposal/final/done: compact final metadata and completion.
  if (type === 'final_text_delta') {
    writeSse(res, 'final_text_delta', payload);
    writeSse(res, 'delta', payload); // Backward-compatible alias for older clients.
    return;
  }
  if (type === 'progress_text_delta' || type === 'progress_text') {
    writeSse(res, type, payload);
    return;
  }
  if (type.startsWith('tool_activity_')) {
    writeSse(res, type, payload);
    return;
  }
  if (type === 'status' || type === 'trace_summary' || type === 'proposal') {
    writeSse(res, type, payload);
  }
}

router.post('/', async (req, res) => {
  const id = requestId();
  const log = createLogger(id);
  const startedAt = Date.now();
  log('request:start', {
    path: '/api/chat',
    model: OPENROUTER_MODEL,
    activeSem: req.body && req.body.activeSem,
    schedule: req.body && req.body.schedule,
    messageCount: Array.isArray(req.body && req.body.messages) ? req.body.messages.length : 0,
  });

  if (!process.env.OPENROUTER_API_KEY) {
    const fallback = await buildLocalActionFallback({ ...(req.body || {}), log }, new Error('OPENROUTER_API_KEY is not set'));
    log('request:no-key', { fallback: Boolean(fallback) });
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
    const result = await runAgentChat({ ...(req.body || {}), log });
    if (result.debug.toolCalls.length) {
      log('tools:summary', { names: result.debug.toolCalls.map((call) => call.name) });
    }
    log('request:end', {
      ms: Date.now() - startedAt,
      suggestions: result.message && result.message.suggestions,
      uiActions: result.uiActions,
    });
    res.json(result);
  } catch (error) {
    log('request:error', { ms: Date.now() - startedAt, error: error.message, stack: error.stack });
    console.error(`[agent ${id}] error`, error);
    const fallback = await buildLocalActionFallback({ ...(req.body || {}), log }, error);
    log('request:fallback-after-error', { fallback: Boolean(fallback) });
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

router.post('/stream', async (req, res) => {
  const id = requestId();
  const log = createLogger(id);
  const startedAt = Date.now();
  let ended = false;
  log('request:start', {
    path: '/api/chat/stream',
    model: OPENROUTER_MODEL,
    activeSem: req.body && req.body.activeSem,
    schedule: req.body && req.body.schedule,
    messageCount: Array.isArray(req.body && req.body.messages) ? req.body.messages.length : 0,
  });

  res.on('close', () => {
    if (!ended) log('request:client-closed', { ms: Date.now() - startedAt });
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  const sendFinal = (result) => {
    log('sse:final', {
      ms: Date.now() - startedAt,
      textLength: result.message && result.message.text ? result.message.text.length : 0,
      suggestions: result.message && result.message.suggestions,
      uiActions: result.uiActions,
    });
    if (result.traceSummary) writeSse(res, 'trace_summary', result.traceSummary);
    if (result.proposal) writeSse(res, 'proposal', result.proposal);
    writeSse(res, 'final', result);
    writeSse(res, 'done', { ok: true });
    ended = true;
    res.end();
  };

  if (!process.env.OPENROUTER_API_KEY) {
    const fallback = await buildLocalActionFallback({ ...(req.body || {}), log }, new Error('OPENROUTER_API_KEY is not set'));
    log('request:no-key', { fallback: Boolean(fallback) });
    if (fallback) return sendFinal(fallback);

    sendFinal({
      message: {
        role: 'agent',
        text: 'The planner still works, but the chat agent needs OPENROUTER_API_KEY set on the server.',
        suggestions: [],
      },
      uiActions: [],
      debug: { toolCalls: [] },
    });
    return;
  }

  try {
    const result = await runAgentChatStream({ ...(req.body || {}), log }, (event) => {
      if (event.type === 'status') {
        log('sse:status', { text: event.text });
      }
      if (event.type && event.type.startsWith('tool_activity_')) {
        log('sse:tool_activity', {
          type: event.type,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: event.state,
        });
      }
      writeAgentStreamEvent(res, event);
    });
    if (result.debug.toolCalls.length) {
      log('tools:summary', { names: result.debug.toolCalls.map((call) => call.name) });
    }
    sendFinal(result);
  } catch (error) {
    log('request:error', { ms: Date.now() - startedAt, error: error.message, stack: error.stack });
    console.error(`[agent ${id}] stream error`, error);
    const fallback = await buildLocalActionFallback({ ...(req.body || {}), log }, error);
    log('request:fallback-after-error', { fallback: Boolean(fallback) });
    if (fallback) return sendFinal(fallback);

    const message = publicErrorMessage(error);
    writeSse(res, 'error', {
      message: {
        role: 'agent',
        text: message,
        suggestions: [],
      },
      uiActions: [],
      error: message,
    });
    writeSse(res, 'done', { ok: false });
    ended = true;
    res.end();
  }
});

module.exports = router;
