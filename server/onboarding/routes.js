const express = require('express');
const multer = require('multer');
const path = require('path');

const { publicErrorMessage } = require('../chat/openrouter');
const { parseCourseRows } = require('./markdown');
const { extractPdfText } = require('./pdf');
const { runPromptFile } = require('./prompts');

const router = express.Router();
const PDF_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_UPLOAD_LIMIT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.mimetype === 'application/pdf' || ext === '.pdf') {
      cb(null, true);
      return;
    }
    const error = new Error('Only PDF uploads are supported in this onboarding version.');
    error.status = 400;
    cb(error);
  },
});

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function markdownResponse(personalCourseMarkdown, warnings = [], extra = {}) {
  return {
    ok: true,
    personalCourseMarkdown,
    courses: parseCourseRows(personalCourseMarkdown),
    warnings,
    ...extra,
  };
}

function buildProfile(reqBody) {
  return parseJsonField(reqBody.profile, reqBody.profile || {});
}

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function combineAcademicText({ transcriptText, courseworkText }) {
  const parts = [];
  if (normalizeText(transcriptText)) {
    parts.push(`Transcript / grade-report extracted text:\n${normalizeText(transcriptText)}`);
  }
  if (normalizeText(courseworkText)) {
    parts.push(`Imported coursework text:\n${normalizeText(courseworkText)}`);
  }
  return parts.join('\n\n');
}

async function generatePersonalCourse({ profile, transcriptText, courseworkText }) {
  return runPromptFile('prompt1_basic.md', {
    USER_PROFILE_JSON: JSON.stringify(profile || {}, null, 2),
    TRANSCRIPT_TEXT_OR_EXTRACTED_CONTENT: combineAcademicText({ transcriptText, courseworkText }) || 'Not Provided',
  });
}

function preferenceToPromptRating(preference) {
  if (preference === 'like' || preference === 'thumb_up') return 'thumb_up';
  if (preference === 'dislike' || preference === 'thumb_down') return 'thumb_down';
  return 'neutral';
}

function toCourseRatings(courses) {
  return (Array.isArray(courses) ? courses : []).map((course) => ({
    term: course.term || 'Unknown',
    subject: course.id || course.subject || 'Unknown',
    title: course.name || course.title || 'Unknown',
    rating: preferenceToPromptRating(course.preference),
  }));
}

async function extractUploadedPdf(req, warnings) {
  if (!req.file) {
    const error = new Error('No PDF file was uploaded.');
    error.status = 400;
    throw error;
  }
  const text = await extractPdfText(req.file.buffer);
  if (!text || text.length < 30) {
    warnings.push('The PDF did not contain enough searchable text. Scanned PDFs need OCR, which is not supported yet.');
  }
  return text;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.post('/transcript', upload.single('file'), asyncRoute(async (req, res) => {
  const warnings = [];
  const transcriptText = await extractUploadedPdf(req, warnings);
  const profile = buildProfile(req.body);
  const courseworkText = normalizeText(req.body.courseworkText);
  const personalCourseMarkdown = await generatePersonalCourse({ profile, transcriptText, courseworkText });

  res.json(markdownResponse(personalCourseMarkdown, warnings, {
    extractedTextPreview: transcriptText.slice(0, 1200),
    transcriptText,
    fileName: req.file.originalname,
  }));
}));

router.post('/profile', asyncRoute(async (req, res) => {
  const profile = req.body.profile || {};
  const transcriptText = normalizeText(req.body.transcriptText);
  const courseworkText = normalizeText(req.body.courseworkText);
  const personalCourseMarkdown = await generatePersonalCourse({ profile, transcriptText, courseworkText });

  res.json(markdownResponse(personalCourseMarkdown, [], {
    summary: 'Base personal_course.md generated.',
  }));
}));

router.post('/resume', upload.single('file'), asyncRoute(async (req, res) => {
  const warnings = [];
  const resumeText = await extractUploadedPdf(req, warnings);
  const personalCourseMarkdown = normalizeText(req.body.personalCourseMarkdown);
  if (!personalCourseMarkdown) throw new Error('personalCourseMarkdown is required before resume parsing.');

  const profile = buildProfile(req.body);
  const userBackgroundText = normalizeText(req.body.userBackgroundText || req.body.preferencesNote);
  const transcriptText = normalizeText(req.body.transcriptText);
  const courseworkText = normalizeText(req.body.courseworkText);
  const skillLevels = parseJsonField(req.body.skillLevels, {});

  const updatedMarkdown = await runPromptFile('prompt3_skill_level.md', {
    PERSONAL_COURSE_MD: personalCourseMarkdown,
    USER_PROFILE_JSON: JSON.stringify(profile || {}, null, 2),
    USER_BACKGROUND_TEXT: userBackgroundText || 'Not Provided',
    RESUME_TEXT: resumeText || 'Not Provided',
    TRANSCRIPT_OR_COURSEWORK_EVIDENCE: combineAcademicText({ transcriptText, courseworkText }) || 'Not Provided',
    SKILL_LEVELS_JSON: JSON.stringify(skillLevels || {}, null, 2),
  });

  res.json(markdownResponse(updatedMarkdown, warnings, {
    extractedTextPreview: resumeText.slice(0, 1200),
    resumeText,
    fileName: req.file.originalname,
    summary: 'Resume parsed and student background / skill levels updated.',
  }));
}));

router.post('/coursework', asyncRoute(async (req, res) => {
  const profile = req.body.profile || {};
  const transcriptText = normalizeText(req.body.transcriptText);
  const courseworkText = normalizeText(req.body.courseworkText);
  if (!courseworkText) throw new Error('courseworkText is required.');

  const personalCourseMarkdown = await generatePersonalCourse({ profile, transcriptText, courseworkText });
  res.json(markdownResponse(personalCourseMarkdown, [], {
    summary: 'Coursework imported into personal_course.md.',
  }));
}));

router.post('/preferences', asyncRoute(async (req, res) => {
  const personalCourseMarkdown = normalizeText(req.body.personalCourseMarkdown);
  if (!personalCourseMarkdown) throw new Error('personalCourseMarkdown is required before saving preferences.');

  const updatedMarkdown = await runPromptFile('prompt2_course_preference.md', {
    PERSONAL_COURSE_MD: personalCourseMarkdown,
    COURSE_RATINGS_JSON: JSON.stringify(toCourseRatings(req.body.courses), null, 2),
  });

  res.json(markdownResponse(updatedMarkdown, [], {
    summary: 'Course preferences updated.',
  }));
}));

router.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message = error.code === 'LIMIT_FILE_SIZE'
    ? 'PDF uploads must be 10MB or smaller.'
    : status < 500
      ? error.message
    : publicErrorMessage(error);
  res.status(status).json({
    ok: false,
    error: message,
    warnings: [],
  });
});

module.exports = router;
