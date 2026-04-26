const fs = require('fs/promises');
const path = require('path');

const { callOpenRouter } = require('../chat/openrouter');

const ROOT_DIR = path.join(__dirname, '..', '..');
const MAX_PROMPT_TEXT_CHARS = 45000;

const promptCache = new Map();

async function readPrompt(promptName) {
  if (promptCache.has(promptName)) return promptCache.get(promptName);
  const promptPath = path.join(ROOT_DIR, promptName);
  const content = await fs.readFile(promptPath, 'utf8');
  promptCache.set(promptName, content);
  return content;
}

function truncatePromptText(value) {
  const text = String(value || '');
  if (text.length <= MAX_PROMPT_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_PROMPT_TEXT_CHARS)}\n\n[Truncated to ${MAX_PROMPT_TEXT_CHARS} characters before model processing.]`;
}

function fillTemplate(template, variables) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return '';
    return truncatePromptText(variables[key]);
  });
}

function stripMarkdownFence(content) {
  const text = String(content || '').trim();
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1].trim() : text;
}

async function runPromptFile(promptName, variables) {
  const template = await readPrompt(promptName);
  const prompt = fillTemplate(template, variables);
  const completion = await callOpenRouter({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });
  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('The model returned an empty onboarding response.');
  }
  return stripMarkdownFence(content);
}

module.exports = {
  runPromptFile,
};
