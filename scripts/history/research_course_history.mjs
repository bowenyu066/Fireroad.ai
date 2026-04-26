import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { closeDb } = require('../../server/history/db.js');
const { researchCourseHistory } = require('../../server/history/research.js');

function printResult(result) {
  console.log(`Researched history for ${result.courseId}`);
  console.log(JSON.stringify({
    dbPath: result.dbPath,
    seed: result.seed,
    discoveredSources: result.discoveredSources.map((source) => ({
      docType: source.docType,
      url: source.url,
      source: source.source,
      selectedBy: source.selectedBy,
      reason: source.reason,
    })),
    insertedDocuments: result.insertedDocuments.length,
    skippedDocuments: result.skippedDocuments.length,
    failedSources: result.failedSources,
    extractionRuns: result.extractionRuns,
    researchTraceEvents: result.researchTrace.length,
    policies: result.policies.length,
    summary: result.history.summary,
    offerings: result.history.offerings.map((offering) => ({
      id: offering.id,
      term: offering.term,
      instructorText: offering.instructorText,
      sourceTypes: offering.sourceTypes,
      sourceCount: offering.sourceCount,
      hasAttendancePolicy: offering.hasAttendancePolicy,
      hasGradingPolicy: offering.hasGradingPolicy,
      offeringSummaryText: offering.offeringSummaryText,
    })),
  }, null, 2));
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || process.env.HISTORY_RESEARCH_VERBOSE === '1';
const reset = args.includes('--reset') || process.env.HISTORY_RESEARCH_RESET === '1';
const courseId = args.find((arg) => !arg.startsWith('--'));
if (!courseId) {
  console.error('Usage: npm run history:research -- <courseId> [--verbose] [--reset]');
  process.exit(1);
}

researchCourseHistory(courseId, {
  verbose,
  reset,
  logger: (line) => console.error(line),
})
  .then((result) => {
    printResult(result);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
