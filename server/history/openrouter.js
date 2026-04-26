const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL
  || process.env.HISTORY_RESEARCH_MODEL
  || process.env.HISTORY_EXTRACT_MODEL
  || 'openai/gpt-4.1-mini';

function parseJson(text) {
  const raw = String(text || '').trim();
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim(),
  ];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // Try the next candidate.
    }
  }

  throw new Error('model output was not valid JSON');
}

async function chatJson({ system, user, model = DEFAULT_MODEL, maxTokens = 1600, temperature = 0 }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for OpenRouter history research.');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Fireroad.ai history research',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 500)}`);
  }

  const payload = JSON.parse(body);
  const rawModelOutput = payload.choices?.[0]?.message?.content || '';
  return {
    model,
    rawModelOutput,
    parsed: parseJson(rawModelOutput),
  };
}

module.exports = {
  DEFAULT_MODEL,
  chatJson,
  parseJson,
};
