import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DB_PATH, getDb, initDb } = require('../../server/history/db.js');
const { createHistoryRepo } = require('../../server/history/repo.js');

const db = getDb();
initDb(db);

const repo = createHistoryRepo(db);
console.log(`Initialized history database at ${DB_PATH}`);
console.log(JSON.stringify(repo.getHistoryStats(), null, 2));
