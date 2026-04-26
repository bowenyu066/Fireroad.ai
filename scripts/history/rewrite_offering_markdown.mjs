import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { closeDb, getDb } = require('../../server/history/db.js');
const { buildCourseSeed } = require('../../server/history/research.js');
const { DEFAULT_MODEL, chatJson } = require('../../server/history/openrouter.js');

function parseArgs(argv) {
  const options = {
    courseId: '',
    jobs: 4,
    model: process.env.HISTORY_REWRITE_MODEL || DEFAULT_MODEL,
    dryRun: argv.includes('--dry-run'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--jobs') options.jobs = Number(argv[++index] || options.jobs);
    else if (arg === '--model') options.model = argv[++index] || options.model;
    else if (!arg.startsWith('--')) options.courseId = arg;
  }

  return {
    ...options,
    jobs: Math.max(1, Math.min(12, Number(options.jobs) || 4)),
  };
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function loadOfferings(db, courseId) {
  const where = courseId ? 'WHERE o.course_id = ?' : '';
  return db.prepare(`
    SELECT
      o.id,
      o.course_id AS courseId,
      o.term,
      o.title_snapshot AS titleSnapshot,
      o.instructor_text AS instructorText,
      o.notes
    FROM offerings o
    ${where}
    ORDER BY o.course_id, o.term DESC, o.id DESC
  `).all(...(courseId ? [courseId] : []));
}

function loadDocuments(db, offeringId) {
  return db.prepare(`
    SELECT doc_type AS docType, url, archived_url AS archivedUrl, raw_text AS rawText
    FROM documents
    WHERE offering_id = ? AND raw_text IS NOT NULL AND length(raw_text) > 120
    ORDER BY id DESC
  `).all(offeringId);
}

function trimSourceText(text, maxLength = 7000) {
  const value = String(text || '').trim();
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function buildPrompt(offering, documents, seed) {
  const sourceText = documents.map((document, index) => [
    `Source ${index + 1}: ${document.docType || 'source'} ${document.url || document.archivedUrl || ''}`,
    trimSourceText(document.rawText),
  ].join('\n')).join('\n\n---\n\n').slice(0, 14000);

  return {
    system: [
      'You rewrite MIT course history display copy.',
      'Return only JSON.',
      'The app renders offering_markdown directly; no downstream extraction or rewriting will happen.',
      'Use exactly these labels: **Course Format:**, **Attendance:**, **Grading:**.',
      'Course Format means structure only, not topic coverage: lectures, recitations/tutorials, labs, homework/psets, projects, quizzes, exams, seminars/studios, meetings, assignments.',
      'Write Course Format as up to three compact fragments in this order when supported: meeting structure; coursework; assessments.',
      'Skip unsupported Course Format fragments.',
      'If some Course Format fragments are supported, do not append "Not specified"; use "Not specified in the available source." only when no format structure is available at all.',
      'Invalid Course Format example: "lectures; programming assignments; Not specified in the available source." Correct it to "lectures; programming assignments."',
      'Attendance requirements and grade-credit rules never belong in Course Format; put them only under Attendance or Grading.',
      'Do not mention instructor names, source URLs, rooms, broad topics, learning goals, units, or course descriptions.',
      'Do not state absence such as "no final exam" or "no labs" unless the source explicitly says it.',
      'Attendance and Grading should each be one short source-grounded sentence.',
      'Say "Not specified in the available source." when attendance or grading is absent.',
      'Do not say "not extracted".',
    ].join(' '),
    user: [
      `Course seed:\n${JSON.stringify({
        id: seed.id,
        title: seed.title,
        aliases: seed.aliases,
        currentInstructors: seed.instructors,
      }, null, 2)}`,
      `Offering metadata:\n${JSON.stringify({
        term: offering.term,
        titleSnapshot: offering.titleSnapshot,
        instructorText: offering.instructorText,
      }, null, 2)}`,
      'Return this JSON shape:',
      JSON.stringify({
        offering_markdown: '**Course Format:** lectures + recitations; weekly psets; midterm + final exam.\n\n**Attendance:** concise explicit policy, or Not specified in the available source.\n\n**Grading:** concise explicit grade breakdown/rules, or Not specified in the available source.',
      }, null, 2),
      `Source text:\n${sourceText}`,
    ].join('\n\n'),
  };
}

function markdownFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  return cleanOfferingMarkdown(parsed.offering_markdown || parsed.offeringMarkdown);
}

function cleanOfferingMarkdown(markdown) {
  return String(markdown || '')
    .replace(/(\*\*Course Format:\*\*\s*)([^\n]+)/i, (match, label, body) => {
      const fragments = String(body || '')
        .replace(/[.]\s*$/, '')
        .split(/\s*;\s*/)
        .map((fragment) => fragment.trim())
        .filter(Boolean);
      if (fragments.length <= 1) return match;
      const filtered = fragments.filter((fragment) => (
        !/^Not specified in the available source\.?$/i.test(fragment)
        && !/\b(attendance|attend|grade|credit|counts?\s+(?:for|toward))\b/i.test(fragment)
      ));
      if (!filtered.length) return `${label}Not specified in the available source.`;
      return `${label}${filtered.join('; ')}.`;
    })
    .trim();
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.courseId) throw new Error('Usage: npm run history:rewrite-markdown -- <courseId> [--jobs 4] [--dry-run]');
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for history markdown rewriting.');

  const db = getDb();
  const offerings = loadOfferings(db, options.courseId)
    .map((offering) => ({ ...offering, documents: loadDocuments(db, offering.id) }))
    .filter((offering) => offering.documents.length);
  if (!offerings.length) throw new Error(`No offerings with cached source text found for ${options.courseId}.`);

  console.error(`Rewriting ${offerings.length} offering markdown records with concurrency ${options.jobs} using ${options.model}`);
  const update = db.prepare('UPDATE offerings SET notes = ? WHERE id = ?');

  const results = await mapLimit(offerings, options.jobs, async (offering) => {
    const seed = buildCourseSeed(offering.courseId);
    const prompt = buildPrompt(offering, offering.documents, seed);
    const result = await chatJson({
      system: prompt.system,
      user: prompt.user,
      model: options.model,
      maxTokens: 900,
      temperature: 0,
    });
    const markdown = markdownFromParsed(result.parsed);
    if (!markdown) throw new Error(`No offering_markdown returned for ${offering.courseId} ${offering.term}`);
    if (!options.dryRun) update.run(markdown, offering.id);
    return {
      id: offering.id,
      courseId: offering.courseId,
      term: offering.term,
      markdown,
    };
  });

  for (const result of results) {
    console.log(`\n${result.courseId} ${result.term} (#${result.id})`);
    console.log(result.markdown);
  }
}

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
