const express = require('express');
const path = require('path');

const chatRoutes = require('./routes/chat');
const healthRoutes = require('./routes/health');
const historyRoutes = require('./routes/history');
const { getDb } = require('./history/db');

function createApp() {
  const app = express();
  const rootDir = path.join(__dirname, '..');

  app.use(express.json({ limit: '1mb' }));
  getDb();

  app.use('/api/health', healthRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/history', historyRoutes);

  app.use(express.static(rootDir));

  app.get('*', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  return app;
}

module.exports = {
  createApp,
};
