const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function chatCompletionsUrl(value, fallback) {
  const url = String(value || fallback).replace(/\/+$/, '');
  return url.endsWith('/chat/completions') ? url : `${url}/chat/completions`;
}

function resolveProviderConfig(env = process.env) {
  const requestedValue = String(env.AI_PROVIDER || '').trim().toLowerCase();
  const requested = ['pp', 'pp-api'].includes(requestedValue) ? 'ppapi' : requestedValue;
  if (requested && !['ppapi', 'openai', 'openrouter'].includes(requested)) {
    throw new Error(`Unsupported AI_PROVIDER "${requestedValue}". Use "ppapi", "openai", or "openrouter".`);
  }

  const provider = requested
    || (env.PPAPI_API_KEY ? 'ppapi' : env.OPENAI_API_KEY ? 'openai' : 'openrouter');
  if (provider === 'ppapi') {
    if (!env.PPAPI_BASE_URL) {
      throw new Error('PPAPI_BASE_URL is required when PP API is selected.');
    }
    return {
      provider,
      label: 'PP API',
      apiKey: env.PPAPI_API_KEY || '',
      apiKeyEnv: 'PPAPI_API_KEY',
      model: env.AI_MODEL || env.PPAPI_MODEL || 'gpt-5.6-terra',
      timeoutMs: Number(env.AI_TIMEOUT_MS || env.PPAPI_TIMEOUT_MS) || 120000,
      url: chatCompletionsUrl(env.PPAPI_BASE_URL, ''),
    };
  }

  if (provider === 'openai') {
    return {
      provider,
      label: 'OpenAI',
      apiKey: env.OPENAI_API_KEY || '',
      apiKeyEnv: 'OPENAI_API_KEY',
      model: env.AI_MODEL || env.OPENAI_MODEL || 'gpt-5.6-terra',
      timeoutMs: Number(env.AI_TIMEOUT_MS || env.OPENAI_TIMEOUT_MS) || 120000,
      url: chatCompletionsUrl(env.OPENAI_BASE_URL, DEFAULT_OPENAI_URL),
    };
  }

  return {
    provider,
    label: 'OpenRouter',
    apiKey: env.OPENROUTER_API_KEY || '',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    model: env.AI_MODEL || env.OPENROUTER_MODEL || 'anthropic/claude-opus-4-7',
    timeoutMs: Number(env.AI_TIMEOUT_MS || env.OPENROUTER_TIMEOUT_MS) || 120000,
    url: chatCompletionsUrl(env.OPENROUTER_BASE_URL, DEFAULT_OPENROUTER_URL),
    siteUrl: env.OPENROUTER_SITE_URL || 'http://localhost:3000',
  };
}

const CONFIG = resolveProviderConfig();
const AI_PROVIDER = CONFIG.provider;
const AI_MODEL = CONFIG.model;
const AI_TIMEOUT_MS = CONFIG.timeoutMs;

function hasAiApiKey() {
  return Boolean(CONFIG.apiKey);
}

function buildRequestBody(config, body = {}) {
  const requestBody = {
    model: config.model,
    ...body,
  };

  if (['ppapi', 'openai'].includes(config.provider)) {
    if (requestBody.max_tokens !== undefined && requestBody.max_completion_tokens === undefined) {
      requestBody.max_completion_tokens = requestBody.max_tokens;
      delete requestBody.max_tokens;
    }

    const usesFunctionTools = Array.isArray(requestBody.tools)
      && requestBody.tools.some((tool) => tool && tool.type === 'function');
    if (config.provider === 'openai'
      && usesFunctionTools
      && /^gpt-5(?:\.|-|$)/i.test(requestBody.model)
      && requestBody.reasoning_effort === undefined) {
      requestBody.reasoning_effort = 'none';
    }
  }

  return requestBody;
}

function requestHeaders(config) {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = config.siteUrl;
    headers['X-Title'] = 'Fireroad.ai Prototype';
  }
  return headers;
}

function createAbortController() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
  return { controller, timeout };
}

function normalizeFetchError(error) {
  if (error && error.name === 'AbortError') {
    const timeoutError = new Error(`${CONFIG.label} request timed out after ${CONFIG.timeoutMs}ms for model ${CONFIG.model}.`);
    timeoutError.code = 'AI_PROVIDER_TIMEOUT';
    return timeoutError;
  }
  return error;
}

function responseError(response, data, raw) {
  const message = data.error && data.error.message ? data.error.message : raw || response.statusText;
  const error = new Error(`${CONFIG.label} ${response.status}: ${message}`);
  error.status = response.status;
  error.provider = CONFIG.provider;
  error.providerResponse = data;
  return error;
}

async function callAi(body) {
  if (!hasAiApiKey()) throw new Error(`${CONFIG.apiKeyEnv} is not set`);

  const { controller, timeout } = createAbortController();
  let response;
  let raw;
  try {
    response = await fetch(CONFIG.url, {
      method: 'POST',
      signal: controller.signal,
      headers: requestHeaders(CONFIG),
      body: JSON.stringify(buildRequestBody(CONFIG, body)),
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

  if (!response.ok) throw responseError(response, data, raw);
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

function contentPartToText(part) {
  if (part === null || part === undefined) return '';
  if (typeof part === 'string') return part;
  if (Array.isArray(part)) return part.map(contentPartToText).join('');
  if (typeof part === 'object') {
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (Array.isArray(part.content)) return part.content.map(contentPartToText).join('');
  }
  return '';
}

async function callAiStream(body, onContentDelta = () => {}) {
  if (!hasAiApiKey()) throw new Error(`${CONFIG.apiKeyEnv} is not set`);

  const { controller, timeout } = createAbortController();
  let response;
  try {
    response = await fetch(CONFIG.url, {
      method: 'POST',
      signal: controller.signal,
      headers: requestHeaders(CONFIG),
      body: JSON.stringify(buildRequestBody(CONFIG, { ...body, stream: true })),
    });

    if (!response.ok) {
      const raw = await response.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (error) {
        data = { raw };
      }
      throw responseError(response, data, raw);
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
        const textDelta = contentPartToText(delta.content);
        if (textDelta) {
          content += textDelta;
          onContentDelta(textDelta);
        }
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
  let message = String(error && error.message ? error.message : error || 'Unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
  [process.env.PPAPI_API_KEY, process.env.OPENAI_API_KEY, process.env.OPENROUTER_API_KEY].filter(Boolean).forEach((key) => {
    message = message.replaceAll(key, '[redacted]');
  });

  if (error && error.status === 401) {
    return `${CONFIG.label} rejected the API key. Check ${CONFIG.apiKeyEnv} on the server.`;
  }
  if (error && [402, 429].includes(error.status)) {
    return `${CONFIG.label} says the account needs available quota or billing before the agent can answer.`;
  }
  if (error && error.status === 404) {
    return `${CONFIG.label} could not find model ${CONFIG.model}. Set AI_MODEL to a valid tool-capable model.`;
  }
  if (error && error.code === 'AI_PROVIDER_TIMEOUT') {
    return `${CONFIG.label} model ${CONFIG.model} is taking too long to answer. Try a faster tool-capable model or raise AI_TIMEOUT_MS.`;
  }
  if (/tool|function|schema|parameter/i.test(message)) {
    return `${CONFIG.label} rejected the tool-calling request: ${message}`;
  }
  return `Backend/model error: ${message}`;
}

module.exports = {
  AI_MODEL,
  AI_PROVIDER,
  AI_TIMEOUT_MS,
  buildRequestBody,
  callAi,
  callAiStream,
  hasAiApiKey,
  publicErrorMessage,
  resolveProviderConfig,
};
