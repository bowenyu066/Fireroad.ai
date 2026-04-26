import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { closeDb } = require('../../server/history/db.js');
const { normalizeCourseId } = require('../../server/history/normalize.js');
const { researchCourseHistory } = require('../../server/history/research.js');

const DEFAULT_COURSES = ['6.1910', '6.1200', '6.4100', '6.3900'];
const DEFAULT_CONCURRENCY = 2;

function usage() {
  return [
    'Usage: npm run history:research-selected -- [courseId ...] [--reset] [--verbose] [--out <file>] [--concurrency <n>] [--fail-fast]',
    '',
    `Default courses: ${DEFAULT_COURSES.join(', ')}`,
    `Default concurrency: ${DEFAULT_CONCURRENCY}`,
    '',
    'Examples:',
    '  npm run history:research-selected',
    '  npm run history:research-selected -- --concurrency 4 --out data/history-selected.json',
    '  npm run history:research-selected -- 6.1910 6.1200 --reset --concurrency 1',
  ].join('\n');
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function parseArgs(argv) {
  const courses = [];
  const options = {
    verbose: process.env.HISTORY_RESEARCH_VERBOSE === '1',
    reset: process.env.HISTORY_RESEARCH_RESET === '1',
    failFast: false,
    out: null,
    concurrency: process.env.HISTORY_RESEARCH_CONCURRENCY
      ? parsePositiveInteger(process.env.HISTORY_RESEARCH_CONCURRENCY, 'HISTORY_RESEARCH_CONCURRENCY')
      : DEFAULT_CONCURRENCY,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }
    if (arg === '--reset') {
      options.reset = true;
      continue;
    }
    if (arg === '--fail-fast') {
      options.failFast = true;
      continue;
    }
    if (arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--out requires a file path.');
      options.out = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
      continue;
    }
    if (arg === '--concurrency' || arg === '--jobs' || arg === '-j') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a positive integer.`);
      options.concurrency = parsePositiveInteger(value, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      options.concurrency = parsePositiveInteger(arg.slice('--concurrency='.length), '--concurrency');
      continue;
    }
    if (arg.startsWith('--jobs=')) {
      options.concurrency = parsePositiveInteger(arg.slice('--jobs='.length), '--jobs');
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    courses.push(normalizeCourseId(arg));
  }

  return {
    courses: [...new Set((courses.length ? courses : DEFAULT_COURSES).map(normalizeCourseId).filter(Boolean))],
    options: {
      ...options,
      concurrency: Math.min(options.concurrency, Math.max(courses.length, DEFAULT_COURSES.length)),
    },
  };
}

function compactSource(source) {
  return {
    docType: source.docType,
    url: source.url,
    source: source.source,
    selectedBy: source.selectedBy,
    reason: source.reason,
  };
}

function compactOffering(offering) {
  return {
    term: offering.term,
    titleSnapshot: offering.titleSnapshot,
    instructorText: offering.instructorText,
    sourceTypes: offering.sourceTypes,
    sourceCount: offering.sourceCount,
    documentCount: offering.documentCount,
    sourceLinks: offering.sourceLinks,
    hasAttendancePolicy: offering.hasAttendancePolicy,
    hasGradingPolicy: offering.hasGradingPolicy,
    attendancePolicySummary: offering.attendancePolicySummary,
    gradingPolicySummary: offering.gradingPolicySummary,
    offeringSummaryText: offering.offeringSummaryText,
    offeringMarkdownText: offering.offeringMarkdownText,
  };
}

function summarizeResult(result) {
  return {
    courseId: result.courseId,
    status: 'ok',
    dbPath: result.dbPath,
    seed: result.seed,
    discoveredSourceCount: result.discoveredSources.length,
    discoveredSources: result.discoveredSources.map(compactSource),
    insertedDocumentCount: result.insertedDocuments.length,
    skippedDocumentCount: result.skippedDocuments.length,
    failedSourceCount: result.failedSources.length,
    failedSources: result.failedSources,
    extractionRuns: result.extractionRuns,
    policyCount: result.policies.length,
    history: {
      course: result.history.course,
      aliases: result.history.aliases,
      summary: result.history.summary,
      offerings: result.history.offerings.map(compactOffering),
    },
  };
}

async function main() {
  const { courses, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('[history:batch] OPENROUTER_API_KEY is not set; model-guided source selection/extraction will fall back to heuristics.');
  }

  const startedAt = new Date().toISOString();
  const results = Array(courses.length);
  let nextIndex = 0;
  let stopScheduling = false;

  console.error(`[history:batch] researching ${courses.length} course(s) with concurrency ${options.concurrency}`);

  async function runCourse(index) {
    const courseId = courses[index];
    console.error(`[history:batch] ${index + 1}/${courses.length} start ${courseId}`);
    try {
      const result = await researchCourseHistory(courseId, {
        verbose: options.verbose,
        reset: options.reset,
        logger: (line) => console.error(line),
      });
      results[index] = summarizeResult(result);
      console.error(`[history:batch] ${index + 1}/${courses.length} done ${courseId}`);
    } catch (error) {
      results[index] = {
        courseId,
        status: 'failed',
        error: error?.stack || error?.message || String(error),
      };
      console.error(`[history:batch] ${courseId} failed: ${error?.message || error}`);
      if (options.failFast) stopScheduling = true;
    }
  }

  async function worker() {
    while (!stopScheduling) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= courses.length) return;
      await runCourse(index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, courses.length) }, () => worker()),
  );

  const completedResults = results.filter(Boolean);
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    reset: options.reset,
    courseCount: courses.length,
    requestedConcurrency: options.concurrency,
    completedCount: completedResults.length,
    successCount: completedResults.filter((result) => result.status === 'ok').length,
    failureCount: completedResults.filter((result) => result.status === 'failed').length,
    results: completedResults,
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const outPath = path.resolve(options.out);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, json, 'utf8');
    console.error(`[history:batch] wrote report to ${outPath}`);
  }
  process.stdout.write(json);

  if (report.failureCount > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
