const express = require('express');
const path = require('path');

const chatRoutes = require('./routes/chat');
const currentRoutes = require('./routes/current');
const healthRoutes = require('./routes/health');
const historyRoutes = require('./routes/history');
const { getDb } = require('./history/db');

const boolEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
};

function firebaseConfigScript() {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || '',
  };
  const hasConfig = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
  const options = {
    requireMitEmail: boolEnv('FIREBASE_REQUIRE_MIT_EMAIL', true),
    allowNonMitEmails: boolEnv('FIREBASE_ALLOW_NON_MIT_EMAILS', false),
    requireEmailVerification: boolEnv('FIREBASE_REQUIRE_EMAIL_VERIFICATION', false),
  };

  return [
    'window.FIREBASE_CONFIG = ' + JSON.stringify(hasConfig ? config : null) + ';',
    'window.FIREBASE_AUTH_OPTIONS = ' + JSON.stringify(options) + ';',
  ].join('\n');
}

function createApp() {
  const app = express();
  const rootDir = path.join(__dirname, '..');

  app.use(express.json({ limit: '1mb' }));
  getDb();

  app.get('/firebase-config.js', (req, res) => {
    res.type('application/javascript').send(firebaseConfigScript());
  });

  app.use('/api/health', healthRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/current', currentRoutes);
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
