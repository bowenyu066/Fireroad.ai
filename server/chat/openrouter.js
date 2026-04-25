const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini';
const OPENROUTER_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENROUTER_TIMEOUT_MS) || 20000);

function createAbortController() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  return { controller, timeout };
}

function normalizeFetchError(error) {
  if (error && error.name === 'AbortError') {
    const timeoutError = new Error(`OpenRouter request timed out after ${OPENROUTER_TIMEOUT_MS}ms for model ${OPENROUTER_MODEL}.`);
    timeoutError.code = 'OPENROUTER_TIMEOUT';
    return timeoutError;
  }
  return error;
}

async function callOpenRouter(body) {
  const { controller, timeout } = createAbortController();
  let response;
  let raw;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': 'Fireroad.ai Prototype',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        ...body,
      }),
    });
    raw = await response.text();
  } catch (error) {
    throw normalizeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    data = { raw };
  }

  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : raw || response.statusText;
    const error = new Error(`OpenRouter ${response.status}: ${message}`);
    error.status = response.status;
    error.openRouterResponse = data;
    throw error;
  }

  return data;
}

function applyToolCallDelta(toolCalls, deltaToolCalls = []) {
  deltaToolCalls.forEach((part) => {
    const index = Number.isInteger(part.index) ? part.index : toolCalls.length;
    const existing = toolCalls[index] || {
      id: part.id || `call_${index}`,
      type: part.type || 'function',
      function: { name: '', arguments: '' },
    };
    if (part.id) existing.id = part.id;
    if (part.type) existing.type = part.type;
    if (part.function && part.function.name) existing.function.name += part.function.name;
    if (part.function && part.function.arguments) existing.function.arguments += part.function.arguments;
    toolCalls[index] = existing;
  });
}

async function callOpenRouterStream(body, onContentDelta = () => {}) {
  const { controller, timeout } = createAbortController();
  let response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': 'Fireroad.ai Prototype',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        ...body,
        stream: true,
      }),
    });

    if (!response.ok) {
      const raw = await response.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (error) {
        data = { raw };
      }
      const message = data.error && data.error.message ? data.error.message : raw || response.statusText;
      const error = new Error(`OpenRouter ${response.status}: ${message}`);
      error.status = response.status;
      error.openRouterResponse = data;
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls = [];

    const handleBlock = (block) => {
      const dataLines = block
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (!dataLines.length) return false;
      const dataText = dataLines.join('\n').trim();
      if (!dataText || dataText === '[DONE]') return dataText === '[DONE]';

      let payload;
      try {
        payload = JSON.parse(dataText);
      } catch (error) {
        return false;
      }
      const delta = payload.choices && payload.choices[0] && payload.choices[0].delta;
      if (!delta) return false;
      if (delta.content) {
        content += delta.content;
        onContentDelta(delta.content);
      }
      if (delta.tool_calls) applyToolCallDelta(toolCalls, delta.tool_calls);
      return false;
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      let finished = false;
      blocks.forEach((block) => {
        if (handleBlock(block)) finished = true;
      });
      if (finished) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleBlock(buffer);

    return {
      choices: [{
        message: {
          content,
          tool_calls: toolCalls.filter(Boolean),
        },
      }],
    };
  } catch (error) {
    throw normalizeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function publicErrorMessage(error) {
  const key = process.env.OPENROUTER_API_KEY || '__no_key__';
  const message = String(error && error.message ? error.message : error || 'Unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(key, '[redacted]');

  if (message.includes('OpenRouter 401')) {
    return 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY on the server.';
  }
  if (message.includes('OpenRouter 402')) {
    return 'OpenRouter says the account needs credits or billing before the agent can answer.';
  }
  if (message.includes('OpenRouter 404')) {
    return `OpenRouter could not find model ${OPENROUTER_MODEL}. Set OPENROUTER_MODEL to a valid tool-capable model.`;
  }
  if (message.includes('OpenRouter request timed out')) {
    return `OpenRouter model ${OPENROUTER_MODEL} is taking too long to answer. Try a faster tool-capable model or raise OPENROUTER_TIMEOUT_MS.`;
  }
  if (/tool|function|schema|parameter/i.test(message)) {
    return `OpenRouter rejected the tool-calling request: ${message}`;
  }
  return `Backend/model error: ${message}`;
}

module.exports = {
  OPENROUTER_MODEL,
  OPENROUTER_TIMEOUT_MS,
  callOpenRouter,
  callOpenRouterStream,
  publicErrorMessage,
};
