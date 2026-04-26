const fs = require('fs');
const path = require('path');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.warn('[history] better-sqlite3 unavailable:', e.message);
}

const defaultDbPath = process.env.VERCEL
  ? '/tmp/course_history.db'
  : path.join(__dirname, '..', '..', 'data', 'course_history.db');
const DB_PATH = process.env.HISTORY_DB_PATH || defaultDbPath;
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

function initDb(database = getDb()) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(schema);
  return database;
}

function getDb() {
  if (!Database) return null;
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  DB_PATH,
  closeDb,
  getDb,
  initDb,
};
