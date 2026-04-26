import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { closeDb, getDb } = require('../../server/history/db.js');
const { buildCourseSeed } = require('../../server/history/research.js');
const { DEFAULT_MODEL, chatJson } = require('../../server/history/openrouter.js');

const VARIANTS = [
  {
    id: 'compact-sections',
    guidance: [
      'Write exactly three compact markdown paragraphs.',
      'Course Format is structural only: lectures, recitations/tutorials, labs, homework/psets, projects, quizzes, exams, seminar/studio, or meeting cadence.',
      'Never put topic coverage or instructor names in Course Format.',
      'Attendance and Grading should be one short sentence each.',
    ],
  },
  {
    id: 'fragments',
    guidance: [
      'Use terse semicolon-separated fragments instead of prose.',
      'Course Format should look like "lectures + recitations; weekly psets; exams" when supported.',
      'Do not mention instructors, rooms, or broad course topics unless the format depends on them.',
      'Say "Not specified in the available source." when attendance or grading is absent.',
    ],
  },
  {
    id: 'strict-fragments',
    guidance: [
      'Use terse semicolon-separated fragments.',
      'Only include components directly supported by explicit words in the source text.',
      'Use only structural nouns in Course Format: lectures, recitations/tutorials, labs, homework/psets, projects, quizzes, exams, seminar/studio, meetings, assignments.',
      'Do not mention rooms, instructor names, broad topics, learning goals, units, or course descriptions.',
      'Do not state absence such as "no final exam" or "no labs" unless the source explicitly says that absence.',
      'Prefer "Not specified in the available source." over inference.',
    ],
  },
  {
    id: 'format-schema',
    guidance: [
      'Write Course Format as up to three fragments in this order when supported: meeting structure; coursework; assessments.',
      'Example style: "lectures + recitations; weekly psets; midterm + final exam".',
      'Skip any fragment that is not explicitly supported.',
      'If some Course Format fragments are supported, do not append "Not specified"; use "Not specified in the available source." only when no format structure is available at all.',
      'Invalid Course Format example: "lectures; programming assignments; Not specified in the available source." Correct it to "lectures; programming assignments."',
      'Attendance requirements and grade-credit rules never belong in Course Format; put them only under Attendance or Grading.',
      'Do not include topic coverage, instructor names, rooms, URLs, broad descriptions, or evidence quotes.',
      'Attendance and Grading each get one short source-grounded sentence.',
    ],
  },
  {
    id: 'evidence-strict',
    guidance: [
      'Only include details directly stated in the source text.',
      'If a source is only a catalog/OCW description, do not convert topic descriptions into format.',
      'Course Format may say "Format not specified; OCW materials include assignments/exams" only when those components are visible in the source.',
      'Grading should include weights/rules only when explicit.',
    ],
  },
];

function parseArgs(argv) {
  const options = {
    courseId: '',
    limit: 4,
    jobs: 4,
    runs: 1,
    model: process.env.HISTORY_ABLATION_MODEL || DEFAULT_MODEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit') options.limit = Number(argv[++index] || options.limit);
    else if (arg === '--jobs') options.jobs = Number(argv[++index] || options.jobs);
    else if (arg === '--runs') options.runs = Number(argv[++index] || options.runs);
    else if (arg === '--model') options.model = argv[++index] || options.model;
    else if (!arg.startsWith('--')) options.courseId = arg;
  }

  return {
    ...options,
    limit: Math.max(1, Math.min(20, Number(options.limit) || 4)),
    jobs: Math.max(1, Math.min(12, Number(options.jobs) || 4)),
    runs: Math.max(1, Math.min(5, Number(options.runs) || 1)),
  };
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function loadSamples(courseId, limit) {
  const db = getDb();
  const where = courseId
    ? "WHERE o.course_id = ? AND o.term GLOB '[12][0-9][0-9][0-9]*' AND d.raw_text IS NOT NULL AND length(d.raw_text) > 200"
    : "WHERE o.term GLOB '[12][0-9][0-9][0-9]*' AND d.raw_text IS NOT NULL AND length(d.raw_text) > 200";
  const params = courseId ? [courseId, limit] : [limit];
  return db.prepare(`
    SELECT
      o.course_id AS courseId,
      o.term,
      o.title_snapshot AS titleSnapshot,
      o.instructor_text AS instructorText,
      d.doc_type AS docType,
      d.url,
      d.raw_text AS rawText
    FROM documents d
    JOIN offerings o ON o.id = d.offering_id
    ${where}
    ORDER BY o.course_id, o.term DESC, d.id DESC
    LIMIT ?
  `).all(...params);
}

function trimSourceText(text, maxLength = 9000) {
  const value = String(text || '').trim();
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function promptFor(sample, seed, variant) {
  const system = [
    'You convert MIT course history source text into final student-facing offering markdown.',
    'Return only JSON.',
    'The app will render offering_markdown directly. No downstream field extraction or rewriting will happen.',
    'Use exactly these labels: **Course Format:**, **Attendance:**, **Grading:**.',
    ...variant.guidance,
    'Do not say "not extracted".',
    'Do not include raw evidence snippets or source URLs in offering_markdown.',
  ].join(' ');

  const user = [
    `Course seed:\n${JSON.stringify({
      id: seed.id,
      title: seed.title,
      aliases: seed.aliases,
      currentInstructors: seed.instructors,
    }, null, 2)}`,
    `Known offering metadata:\n${JSON.stringify({
      term: sample.term,
      titleSnapshot: sample.titleSnapshot,
      instructorText: sample.instructorText,
      docType: sample.docType,
      url: sample.url,
    }, null, 2)}`,
    'Return this JSON shape:',
    JSON.stringify({
      offering_markdown: '**Course Format:** concise structural format only.\n\n**Attendance:** explicit policy or Not specified in the available source.\n\n**Grading:** explicit grade breakdown/rules or Not specified in the available source.',
    }, null, 2),
    `Source text:\n${trimSourceText(sample.rawText)}`,
  ].join('\n\n');

  return { system, user };
}

function markdownFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  if (parsed.offering_markdown) return String(parsed.offering_markdown);
  if (parsed.offeringMarkdown) return String(parsed.offeringMarkdown);
  if (Array.isArray(parsed.offerings) && parsed.offerings[0]) {
    return String(parsed.offerings[0].offering_markdown || parsed.offerings[0].offeringMarkdown || '');
  }
  return '';
}

function section(markdown, label) {
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\n\\*\\*|$)`, 'i');
  const match = String(markdown || '').match(pattern);
  return compact(match ? match[1] : '');
}

function instructorTokens(instructorText) {
  return compact(instructorText)
    .split(/[,;·]|\band\b/i)
    .flatMap((name) => name.split(/\s+/).slice(-1))
    .map((name) => name.replace(/[^a-z]/gi, '').toLowerCase())
    .filter((name) => name.length >= 5);
}

function scoreMarkdown(markdown, sample) {
  const text = String(markdown || '');
  const lower = text.toLowerCase();
  const format = section(text, 'Course Format');
  let score = 100;
  const notes = [];

  for (const label of ['**Course Format:**', '**Attendance:**', '**Grading:**']) {
    if (!text.includes(label)) {
      score -= 20;
      notes.push(`missing ${label}`);
    }
  }

  if (text.length > 620) {
    score -= 12;
    notes.push('too long');
  }
  if (/not extracted/i.test(text)) {
    score -= 25;
    notes.push('says not extracted');
  }
  if (/\*\*Course Format:\*\*[^\n]*;\s*Not specified in the available source/i.test(text)) {
    score -= 16;
    notes.push('mixed format fallback');
  }
  if (/\btaught by\b|professors?\b|profs?\.|\binstructor/i.test(format)) {
    score -= 18;
    notes.push('format repeats instructor framing');
  }
  if (/\battendance|attend|grade|credit|counts?\s+(?:for|toward)\b/i.test(format)) {
    score -= 18;
    notes.push('format includes attendance/grading rule');
  }
  if (/\bcovering\b|\btopics include\b|\bapplications?\b|\bprinciples?\b|\balgorithms?\b|\bconcepts?\b|\bfocus(?:es|ed)?\b|\busing\b|\bdesign and\b|\bimplementation\b/i.test(format)) {
    score -= 20;
    notes.push('format sounds like topic summary');
  }
  if (/\bunits?\b|\bin-class hours?\b|\bout-of-class hours?\b/i.test(format)) {
    score -= 12;
    notes.push('format includes catalog units/hours');
  }
  if (!/lecture|recitation|tutorial|lab|homework|pset|problem set|project|quiz|exam|seminar|studio|meeting|session|assignment/i.test(format)
    && !/not specified/i.test(format)) {
    score -= 10;
    notes.push('format lacks structure words');
  }

  const repeatedNames = instructorTokens(sample.instructorText).filter((token) => lower.includes(token));
  if (repeatedNames.length) {
    score -= Math.min(18, repeatedNames.length * 4);
    notes.push('repeats instructor names');
  }

  return { score, notes };
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
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for markdown ablation jobs.');
  }

  const samples = loadSamples(options.courseId, options.limit);
  if (!samples.length) throw new Error(`No cached history documents found${options.courseId ? ` for ${options.courseId}` : ''}.`);

  const jobs = [];
  for (const sample of samples) {
    const seed = buildCourseSeed(sample.courseId);
    for (const variant of VARIANTS) {
      for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
        jobs.push({ sample, seed, variant, runIndex });
      }
    }
  }

  console.error(`Running ${jobs.length} ablation jobs with concurrency ${options.jobs} using ${options.model}`);
  const results = await mapLimit(jobs, options.jobs, async (job) => {
    const prompt = promptFor(job.sample, job.seed, job.variant);
    const result = await chatJson({
      system: prompt.system,
      user: prompt.user,
      model: options.model,
      maxTokens: 900,
      temperature: 0,
    });
    const markdown = markdownFromParsed(result.parsed);
    return {
      variant: job.variant.id,
      courseId: job.sample.courseId,
      term: job.sample.term,
      docType: job.sample.docType,
      runIndex: job.runIndex,
      markdown,
      ...scoreMarkdown(markdown, job.sample),
    };
  });

  const byVariant = new Map();
  for (const result of results) {
    const bucket = byVariant.get(result.variant) || [];
    bucket.push(result);
    byVariant.set(result.variant, bucket);
  }

  console.log('Variant scores:');
  for (const [variant, bucket] of byVariant) {
    const average = bucket.reduce((sum, item) => sum + item.score, 0) / bucket.length;
    console.log(`- ${variant}: ${average.toFixed(1)} avg over ${bucket.length} jobs`);
  }

  console.log('\nSample outputs:');
  for (const result of results.sort((a, b) => b.score - a.score).slice(0, 12)) {
    console.log(`\n[${result.score}] ${result.variant} · ${result.courseId} ${result.term} · ${result.docType}`);
    if (result.notes.length) console.log(`notes: ${result.notes.join('; ')}`);
    console.log(result.markdown);
  }

  console.log('\nWorst outputs:');
  for (const result of results.sort((a, b) => a.score - b.score).slice(0, 8)) {
    console.log(`\n[${result.score}] ${result.variant} · ${result.courseId} ${result.term} · ${result.docType}`);
    if (result.notes.length) console.log(`notes: ${result.notes.join('; ')}`);
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
