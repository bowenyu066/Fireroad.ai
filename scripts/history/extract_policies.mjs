import 'dotenv/config';
import { createRequire } from 'node:module';
import { loadManifest, importOfferingManifest } from './import_offering_manifest.mjs';

const require = createRequire(import.meta.url);
const { getDb, initDb } = require('../../server/history/db.js');
const { createHistoryRepo } = require('../../server/history/repo.js');
const { normalizeTerm } = require('../../server/history/normalize.js');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_MODEL || process.env.HISTORY_EXTRACT_MODEL || 'openai/gpt-4.1-mini';
const PROMPT_VERSION = 'history-policy-v1';

function parseJson(text) {
  const raw = String(text || '').trim();
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim(),
  ];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // Try the next candidate.
    }
  }
  throw new Error('model output was not valid JSON');
}

async function callExtractor(document) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for history extraction.');
  }

  const text = String(document.rawText || '').slice(0, 18000);
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Fireroad.ai history extraction',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: [
            'Extract course attendance and grading policy from the provided source text.',
            'Return only JSON.',
            'Use string values "yes", "no", or "unknown" for unknown/no fields; do not collapse unknown into no.',
            'Evidence text must be a short exact or near-exact snippet from the source when possible.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Document type: ${document.docType}\nURL: ${document.url || ''}\n\nSource text:\n${text}`,
        },
      ],
      temperature: 0,
      max_tokens: 900,
    }),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 500)}`);
  const payload = JSON.parse(body);
  const content = payload.choices?.[0]?.message?.content || '';
  try {
    return { rawModelOutput: content, parsed: parseJson(content) };
  } catch (error) {
    error.rawModelOutput = content;
    throw error;
  }
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanTriState(value) {
  const raw = String(value || 'unknown').toLowerCase();
  if (['yes', 'required', 'true'].includes(raw)) return 'yes';
  if (['no', 'not_required', 'false'].includes(raw)) return 'no';
  return raw === 'unknown' ? 'unknown' : value;
}

function writePolicies(repo, offering, document, parsed) {
  const attendance = parsed.attendance || {};
  const grading = parsed.grading || {};

  const attendancePolicy = repo.createAttendancePolicy({
    offeringId: offering.id,
    attendanceRequired: cleanTriState(attendance.attendance_required),
    attendanceCountsTowardGrade: cleanTriState(attendance.attendance_counts_toward_grade),
    attendanceNotes: attendance.attendance_notes || null,
    evidenceDocumentId: document.id,
    evidenceText: attendance.evidence_text || parsed.evidence_text || null,
    confidence: num(attendance.confidence ?? parsed.confidence),
    reviewStatus: 'auto',
  });

  const gradingPolicy = repo.createGradingPolicy({
    offeringId: offering.id,
    letterGrade: cleanTriState(grading.letter_grade),
    hasParticipationComponent: cleanTriState(grading.has_participation_component),
    participationWeight: num(grading.participation_weight),
    homeworkWeight: num(grading.homework_weight),
    projectWeight: num(grading.project_weight),
    labWeight: num(grading.lab_weight),
    quizWeight: num(grading.quiz_weight),
    midtermWeight: num(grading.midterm_weight),
    finalWeight: num(grading.final_weight),
    dropLowestRuleText: grading.drop_lowest_rule_text || null,
    latePolicyText: grading.late_policy_text || null,
    collaborationPolicyText: grading.collaboration_policy_text || null,
    gradingNotes: grading.grading_notes || null,
    evidenceDocumentId: document.id,
    evidenceText: grading.evidence_text || parsed.evidence_text || null,
    confidence: num(grading.confidence ?? parsed.confidence),
    reviewStatus: 'auto',
  });

  return { attendancePolicy, gradingPolicy };
}

export async function extractPoliciesForManifest(courseOrPath, options = {}) {
  const db = options.db || getDb();
  initDb(db);
  const repo = options.repo || createHistoryRepo(db);
  const { manifest } = await loadManifest(courseOrPath);
  const imported = await importOfferingManifest(courseOrPath, { db, repo });
  const extracted = [];
  const failed = [];
  const skipped = [];

  for (const manifestOffering of manifest.offerings || []) {
    const offering = repo.getOfferingByCourseTerm(imported.courseId, normalizeTerm(manifestOffering.term));
    if (!offering) continue;

    for (const document of repo.listOfferingDocuments(offering.id)) {
      if (!document.rawText) {
        const run = repo.createExtractionRun({
          documentId: document.id,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          status: 'skipped_no_text',
        });
        skipped.push({ documentId: document.id, runId: run.id, reason: 'no raw_text' });
        continue;
      }

      try {
        const result = await callExtractor(document);
        const run = repo.createExtractionRun({
          documentId: document.id,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          rawModelOutput: result.rawModelOutput,
          parsedJson: JSON.stringify(result.parsed),
          status: 'succeeded',
        });
        const policies = writePolicies(repo, offering, document, result.parsed);
        extracted.push({ documentId: document.id, runId: run.id, ...policies });
      } catch (error) {
        const run = repo.createExtractionRun({
          documentId: document.id,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          rawModelOutput: error.rawModelOutput || null,
          status: 'failed',
        });
        failed.push({ documentId: document.id, runId: run.id, reason: error.message });
      }
    }
  }

  return {
    courseId: imported.courseId,
    extracted,
    skipped,
    failed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  extractPoliciesForManifest(process.argv[2])
    .then((result) => {
      console.log(`Extracted history policies for ${result.courseId}`);
      console.log(JSON.stringify({
        extracted: result.extracted.length,
        skipped: result.skipped,
        failed: result.failed,
      }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
