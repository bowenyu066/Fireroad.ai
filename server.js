require('dotenv').config({ quiet: true });

const { createApp } = require('./server/app');
const { OPENROUTER_MODEL } = require('./server/chat/openrouter');

const PORT = Number(process.env.PORT || 3000);
const MAX_PORT_ATTEMPTS = 10;
const app = createApp();

function listen(port, attemptsLeft = MAX_PORT_ATTEMPTS) {
  const server = app.listen(port, () => {
    console.log(`Fireroad.ai prototype running at http://localhost:${port}`);
    console.log(`OpenRouter model: ${OPENROUTER_MODEL}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 0 && !process.env.PORT) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is in use. Trying http://localhost:${nextPort} instead.`);
      listen(nextPort, attemptsLeft - 1);
      return;
    }

    console.error(error);
    process.exit(1);
  });

  return server;
}

if (require.main === module) {
  listen(PORT);
}

module.exports = {
  app,
  listen,
};
