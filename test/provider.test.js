const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRequestBody, resolveProviderConfig } = require('../server/chat/provider');

test('prefers PP API when its key and base URL are configured', () => {
  const config = resolveProviderConfig({
    PPAPI_API_KEY: 'pp-test-key',
    PPAPI_BASE_URL: 'https://example.test/v1',
    OPENAI_API_KEY: 'openai-test-key',
    OPENROUTER_API_KEY: 'openrouter-test-key',
  });

  assert.equal(config.provider, 'ppapi');
  assert.equal(config.model, 'gpt-5.6-terra');
  assert.equal(config.url, 'https://example.test/v1/chat/completions');
});

test('honors an explicit OpenRouter provider override', () => {
  const config = resolveProviderConfig({
    AI_PROVIDER: 'openrouter',
    PPAPI_API_KEY: 'pp-test-key',
    PPAPI_BASE_URL: 'https://example.test/v1',
    OPENROUTER_API_KEY: 'openrouter-test-key',
    OPENROUTER_MODEL: 'openai/gpt-4.1-mini',
  });

  assert.equal(config.provider, 'openrouter');
  assert.equal(config.model, 'openai/gpt-4.1-mini');
});

test('normalizes the pp-api provider alias', () => {
  const config = resolveProviderConfig({
    AI_PROVIDER: 'pp-api',
    PPAPI_API_KEY: 'pp-test-key',
    PPAPI_BASE_URL: 'https://example.test/v1/chat/completions',
  });

  assert.equal(config.provider, 'ppapi');
  assert.equal(config.url, 'https://example.test/v1/chat/completions');
});

test('adapts token limits for PP API without sending OpenAI-only reasoning options', () => {
  const config = resolveProviderConfig({
    PPAPI_API_KEY: 'pp-test-key',
    PPAPI_BASE_URL: 'https://example.test/v1',
    PPAPI_MODEL: 'gpt-5.6-terra',
  });
  const request = buildRequestBody(config, {
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ type: 'function', function: { name: 'search', parameters: { type: 'object' } } }],
    max_tokens: 100,
  });

  assert.equal(request.max_tokens, undefined);
  assert.equal(request.max_completion_tokens, 100);
  assert.equal(request.reasoning_effort, undefined);
});

test('sets GPT-5 Chat Completions tool calls to no reasoning for direct OpenAI', () => {
  const config = resolveProviderConfig({
    OPENAI_API_KEY: 'openai-test-key',
    OPENAI_MODEL: 'gpt-5.6-terra',
  });
  const request = buildRequestBody(config, {
    tools: [{ type: 'function', function: { name: 'search', parameters: { type: 'object' } } }],
  });

  assert.equal(request.reasoning_effort, 'none');
});

test('keeps the existing OpenRouter request shape', () => {
  const config = resolveProviderConfig({
    OPENROUTER_API_KEY: 'openrouter-test-key',
  });
  const request = buildRequestBody(config, {
    tools: [{ type: 'function', function: { name: 'search', parameters: { type: 'object' } } }],
    max_tokens: 100,
  });

  assert.equal(request.max_tokens, 100);
  assert.equal(request.max_completion_tokens, undefined);
  assert.equal(request.reasoning_effort, undefined);
});
