const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini';

async function callOpenRouter(body) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
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

  const raw = await response.text();
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
  if (/tool|function|schema|parameter/i.test(message)) {
    return `OpenRouter rejected the tool-calling request: ${message}`;
  }
  return `Backend/model error: ${message}`;
}

module.exports = {
  OPENROUTER_MODEL,
  callOpenRouter,
  publicErrorMessage,
};
