const { AI_MODEL, callAi, hasAiApiKey } = require('../chat/provider');

const DEFAULT_MODEL = process.env.HISTORY_RESEARCH_MODEL
  || process.env.HISTORY_EXTRACT_MODEL
  || AI_MODEL;

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
  if (!hasAiApiKey()) {
    throw new Error('An API key is required for the configured AI provider.');
  }

  const payload = await callAi({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  });
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
  hasAiApiKey,
  parseJson,
};
