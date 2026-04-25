const { createApp } = require('./server/app');
const { OPENROUTER_MODEL } = require('./server/chat/openrouter');

const PORT = process.env.PORT || 3000;
const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Fireroad.ai prototype running at http://localhost:${PORT}`);
    console.log(`OpenRouter model: ${OPENROUTER_MODEL}`);
  });
}

module.exports = {
  app,
};
