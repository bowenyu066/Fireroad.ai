import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DB_PATH, getDb, initDb } = require('../../server/history/db.js');
const { createHistoryRepo } = require('../../server/history/repo.js');
const { normalizeCourseId, normalizeTerm } = require('../../server/history/normalize.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_DIR = path.join(ROOT, 'data', 'history_manifests');
const COURSES_PATH = path.join(ROOT, 'data', 'courses.json');

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export function manifestPathFor(courseOrPath) {
  if (!courseOrPath) throw new Error('Usage: node scripts/history/import_offering_manifest.mjs <courseId|manifestPath>');
  if (courseOrPath.endsWith('.json') || courseOrPath.includes('/') || courseOrPath.includes('\\')) {
    return path.resolve(ROOT, courseOrPath);
  }
  return path.join(MANIFEST_DIR, `${normalizeCourseId(courseOrPath)}.json`);
}

export async function loadManifest(courseOrPath) {
  const manifestPath = manifestPathFor(courseOrPath);
  const manifest = await readJson(manifestPath);
  return { manifestPath, manifest };
}

async function findCurrentCourse(courseId) {
  try {
    const courses = await readJson(COURSES_PATH);
    return (Array.isArray(courses) ? courses : Object.values(courses))
      .find((course) => normalizeCourseId(course.subject_id || course.id) === normalizeCourseId(courseId));
  } catch (error) {
    return null;
  }
}

function areaForCourseId(courseId) {
  const id = normalizeCourseId(courseId);
  if (id.startsWith('6.')) return 'cs';
  if (id.startsWith('18.')) return 'math';
  if (id.startsWith('8.')) return 'physics';
  if (id.startsWith('7.')) return 'bio';
  if (id.startsWith('21') || id.startsWith('24') || id.startsWith('17') || id.startsWith('14') || id.startsWith('15')) return 'hass';
  return 'other';
}

export async function importOfferingManifest(courseOrPath, options = {}) {
  const { manifestPath, manifest } = await loadManifest(courseOrPath);
  const courseId = normalizeCourseId(manifest.courseId);
  if (!courseId) throw new Error(`Manifest ${manifestPath} is missing courseId.`);

  const db = options.db || getDb();
  initDb(db);
  const repo = options.repo || createHistoryRepo(db);
  const current = await findCurrentCourse(courseId);

  const result = db.transaction(() => {
    const course = repo.upsertCourse({
      id: courseId,
      currentTitle: manifest.currentTitle || current?.title || manifest.title || courseId,
      department: manifest.department || courseId.split('.')[0],
      area: manifest.area || areaForCourseId(courseId),
      currentUnits: manifest.currentUnits || current?.total_units || null,
      currentDesc: manifest.currentDesc || current?.description || null,
    });

    const aliases = (manifest.aliases || []).map((alias) => {
      const aliasRecord = typeof alias === 'string'
        ? { aliasId: alias, courseId, source: 'manifest' }
        : { ...alias, courseId: alias.courseId || courseId, source: alias.source || 'manifest' };
      return repo.upsertAlias(aliasRecord);
    }).filter(Boolean);

    const offerings = (manifest.offerings || []).map((offering) => repo.upsertOffering({
      courseId,
      term: normalizeTerm(offering.term),
      titleSnapshot: offering.titleSnapshot || offering.title || manifest.currentTitle || current?.title || courseId,
      unitsSnapshot: offering.unitsSnapshot || offering.units || current?.total_units || null,
      instructorText: offering.instructorText || offering.instructors || null,
      homepageUrl: offering.homepageUrl || null,
      syllabusUrl: offering.syllabusUrl || null,
      ocwUrl: offering.ocwUrl || null,
      hasHomepage: Boolean(offering.homepageUrl),
      notes: offering.notes || null,
    }));

    return { course, aliases, offerings };
  })();

  return {
    dbPath: DB_PATH,
    manifestPath,
    courseId,
    ...result,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importOfferingManifest(process.argv[2])
    .then((result) => {
      console.log(`Imported history manifest for ${result.courseId}`);
      console.log(JSON.stringify({
        dbPath: result.dbPath,
        manifestPath: result.manifestPath,
        aliases: result.aliases.length,
        offerings: result.offerings.length,
      }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
