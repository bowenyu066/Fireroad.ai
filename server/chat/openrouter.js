// Backward-compatible aliases for older scripts. New code should import ./provider.
const provider = require('./provider');

module.exports = {
  ...provider,
  OPENROUTER_MODEL: provider.AI_MODEL,
  OPENROUTER_TIMEOUT_MS: provider.AI_TIMEOUT_MS,
  callOpenRouter: provider.callAi,
  callOpenRouterStream: provider.callAiStream,
};
