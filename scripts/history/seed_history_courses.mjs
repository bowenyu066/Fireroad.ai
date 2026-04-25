import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mockData = require('../../shared/mock-data.js');
const { DB_PATH, getDb, initDb } = require('../../server/history/db.js');
const { createHistoryRepo } = require('../../server/history/repo.js');

const db = getDb();
initDb(db);
const repo = createHistoryRepo(db);

const courseSix = mockData.catalog
  .filter((course) => course.id.startsWith('6.'))
  .map((course) => ({
    id: course.id,
    currentTitle: course.name,
    department: '6',
    area: course.area,
    currentUnits: course.units,
    currentDesc: course.desc || null,
  }));

const seed = db.transaction((courses) => {
  courses.forEach((course) => repo.upsertCourse(course));
});

seed(courseSix);

console.log(`Seeded ${courseSix.length} Course 6 demo courses into ${DB_PATH}`);
console.log(JSON.stringify(repo.getHistoryStats(), null, 2));
