import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadManifest, importOfferingManifest } from './import_offering_manifest.mjs';

const require = createRequire(import.meta.url);
const { getDb, initDb } = require('../../server/history/db.js');
const { createHistoryRepo } = require('../../server/history/repo.js');
const { normalizeDocType, normalizeTerm } = require('../../server/history/normalize.js');

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceCandidates(offering) {
  return [
    offering.homepageUrl && { docType: 'homepage', url: offering.homepageUrl },
    offering.syllabusUrl && { docType: 'syllabus', url: offering.syllabusUrl },
    offering.ocwUrl && { docType: 'ocw', url: offering.ocwUrl },
    offering.archiveUrl && { docType: 'archive', url: offering.archiveUrl, archivedUrl: offering.archiveUrl },
  ].filter(Boolean);
}

async function fetchSource(source) {
  const response = await fetch(source.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Fireroad.ai history collector/0.1' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || 'unknown';
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  const isText = /^text\//i.test(contentType) || /json|xml|javascript/i.test(contentType);
  const isHtml = /html/i.test(contentType) || /<html[\s>]/i.test(text);

  return {
    contentType,
    checksum: checksum(buffer),
    rawHtml: isHtml ? text : null,
    rawText: isHtml ? htmlToText(text) : isText ? text.replace(/\s+/g, ' ').trim() : null,
  };
}

export async function fetchDocumentsForManifest(courseOrPath, options = {}) {
  const db = options.db || getDb();
  initDb(db);
  const repo = options.repo || createHistoryRepo(db);
  const { manifest } = await loadManifest(courseOrPath);
  const imported = await importOfferingManifest(courseOrPath, { db, repo });
  const inserted = [];
  const skipped = [];
  const failed = [];

  for (const manifestOffering of manifest.offerings || []) {
    const offering = repo.getOfferingByCourseTerm(imported.courseId, normalizeTerm(manifestOffering.term));
    if (!offering) {
      failed.push({ term: manifestOffering.term, reason: 'offering not found after import' });
      continue;
    }

    for (const source of sourceCandidates(manifestOffering)) {
      try {
        const fetched = await fetchSource(source);
        if (repo.getOfferingDocumentByChecksum(offering.id, fetched.checksum)) {
          skipped.push({ offeringId: offering.id, docType: source.docType, url: source.url, reason: 'duplicate checksum' });
          continue;
        }

        const document = repo.createDocument({
          offeringId: offering.id,
          docType: normalizeDocType(source.docType),
          url: source.url,
          archivedUrl: source.archivedUrl || null,
          fetchedAt: new Date().toISOString(),
          ...fetched,
        });
        inserted.push(document);
      } catch (error) {
        failed.push({ offeringId: offering.id, docType: source.docType, url: source.url, reason: error.message });
      }
    }
  }

  return {
    courseId: imported.courseId,
    inserted,
    skipped,
    failed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchDocumentsForManifest(process.argv[2])
    .then((result) => {
      console.log(`Fetched history documents for ${result.courseId}`);
      console.log(JSON.stringify({
        inserted: result.inserted.length,
        skipped: result.skipped.length,
        failed: result.failed,
      }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
