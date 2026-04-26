const express = require('express');
const multer = require('multer');
const path = require('path');

const { callOpenRouter, publicErrorMessage } = require('../chat/openrouter');
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
  const courses = parseCourseRows(personalCourseMarkdown);
  const trimmed = String(personalCourseMarkdown || '').trim();
  if (trimmed && courses.length === 0) {
    console.warn('[onboarding] parseCourseRows returned 0 courses despite non-empty markdown', {
      length: trimmed.length,
      preview: trimmed.slice(0, 240).replace(/\n/g, '\\n'),
    });
    warnings = [...warnings, 'Generated personal_course.md but parsed 0 courses. The markdown table format may not match expectations.'];
  }
  return {
    ok: true,
    personalCourseMarkdown,
    courses,
    warnings,
    ...extra,
  };
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  const candidate = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    return null;
  }
}

function clampRating(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return Math.max(0, Math.min(10, Math.round(number)));
}

function cleanPersonalizationPrefill(value) {
  const incoming = value && typeof value === 'object' ? value : {};
  const topicRatings = incoming.topicRatings && typeof incoming.topicRatings === 'object' ? incoming.topicRatings : {};
  const formatPreferences = incoming.formatPreferences && typeof incoming.formatPreferences === 'object' ? incoming.formatPreferences : {};
  const desiredCoursesPerDirection = incoming.desiredCoursesPerDirection && typeof incoming.desiredCoursesPerDirection === 'object'
    ? incoming.desiredCoursesPerDirection
    : {};
  const cleanedTopics = {};
  Object.entries(topicRatings).forEach(([topic, ratings]) => {
    if (!ratings || typeof ratings !== 'object') return;
    cleanedTopics[topic] = {
      skill: clampRating(ratings.skill),
      interest: clampRating(ratings.interest),
      evidence: String(ratings.evidence || '').slice(0, 240),
    };
  });
  const cleanedFormats = {};
  Object.entries(formatPreferences).forEach(([key, rating]) => {
    cleanedFormats[key] = clampRating(rating);
  });
  const cleanedDesired = {};
  Object.entries(desiredCoursesPerDirection).forEach(([key, count]) => {
    const number = Number(count);
    cleanedDesired[key] = Number.isFinite(number) ? Math.max(0, Math.min(8, Math.round(number))) : '';
  });

  return {
    version: 1,
    ratingScale: '0-10',
    topicRatings: cleanedTopics,
    formatPreferences: cleanedFormats,
    desiredCoursesPerDirection: cleanedDesired,
    freeformNotes: String(incoming.freeformNotes || '').slice(0, 1200),
    inferredFromPersonalCourse: true,
    inferenceSummary: String(incoming.inferenceSummary || '').slice(0, 500),
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

function answerValue(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function tableRow(cells) {
  return `| ${cells.map((cell) => String(cell ?? '').replace(/\|/g, '/')).join(' | ')} |`;
}

function ratingRow(label, value, scale = '0-10') {
  return tableRow([label, answerValue(value), answerValue(value, 'Unknown') === 'Unknown' ? 'Unknown' : scale, 'None']);
}

function replacePlanningPreferenceSection(markdown, section) {
  const heading = '## Course Planning Preferences and Constraints';
  const start = markdown.indexOf(heading);
  if (start >= 0) {
    const rest = markdown.slice(start + heading.length);
    const next = rest.search(/\n## /);
    if (next === -1) return `${markdown.slice(0, start).trimEnd()}\n\n${section}\n`;
    return `${markdown.slice(0, start).trimEnd()}\n\n${section}\n\n${rest.slice(next + 1).trimStart()}`;
  }

  const anchors = ['## Course Preferences', '## Student Background and Skill Levels', '## Student Profile'];
  for (const anchor of anchors) {
    const anchorStart = markdown.indexOf(anchor);
    if (anchorStart === -1) continue;
    const rest = markdown.slice(anchorStart + anchor.length);
    const next = rest.search(/\n## /);
    if (next === -1) return `${markdown.trimEnd()}\n\n${section}\n`;
    const insertAt = anchorStart + anchor.length + next;
    return `${markdown.slice(0, insertAt).trimEnd()}\n\n${section}\n\n${markdown.slice(insertAt).trimStart()}`;
  }

  return `${markdown.trimEnd()}\n\n${section}\n`;
}

function buildPlanningPreferenceSection(questionnaire = {}, freeformNotes = '') {
  const workload = questionnaire.workload || {};
  const commitments = questionnaire.commitments || {};
  const commitmentDetails = answerValue(commitments.details, 'None');
  const grading = questionnaire.gradingPreferences || {};
  const topics = questionnaire.topicRatings || {};
  const formats = questionnaire.formatPreferences || {};
  const desired = questionnaire.desiredCoursesPerDirection || {};
  const followUps = Array.isArray(questionnaire.agentFollowUps) ? questionnaire.agentFollowUps : [];
  const scale = questionnaire.ratingScale || '0-10';
  const topicLabels = {
    coding: 'Coding',
    proofs: 'Proofs',
    algorithms: 'Algorithms',
    probability: 'Probability',
    linearAlgebra: 'Linear Algebra',
    machineLearning: 'Machine Learning',
    systems: 'Systems',
    softwareEngineering: 'Software Engineering',
    math: 'Math Overall',
  };
  const formatLabels = {
    psets: 'Problem Sets / Written Homework',
    codingLabs: 'Coding Labs / Programming Assignments',
    exams: 'Exams',
    labs: 'Labs',
    finalProjects: 'Final Projects',
    paperReading: 'Paper Reading',
    teamProjects: 'Team Projects',
    presentations: 'Presentations',
  };

  const desiredRows = Object.entries(desired)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([direction, value]) => tableRow([direction, value, 'None']));
  const academicRows = Object.entries(topics)
    .filter(([, value]) => value && value.interest !== undefined && value.interest !== null && value.interest !== '')
    .map(([topic, value]) => tableRow([
      Number(value.interest) <= 2 ? 'Not Interested' : 'Interested',
      topicLabels[topic] || topic,
      value.interest,
      'Derived from explicit interest slider',
    ]));

  return [
    '## Course Planning Preferences and Constraints',
    '',
    '### Planned / Intended Courses',
    '',
    '| Term | Subject | Title | Confidence | Notes |',
    '|---|---|---|---|---|',
    '| None specified | — | — | — | — |',
    '',
    '### Academic Direction Preferences',
    '',
    '| Direction Type | Direction / Area | Preference Strength | Notes |',
    '|---|---|---:|---|',
    ...(academicRows.length ? academicRows : ['| None specified | — | — | — |']),
    '',
    '### Workload and Scheduling Constraints',
    '',
    '| Dimension | Value | Notes |',
    '|---|---|---|',
    tableRow(['Weekly Course Hours Budget', answerValue(workload.weeklyCourseHoursBudget), 'None']),
    tableRow(['Attendance Importance', answerValue(workload.attendanceImportance), 'None']),
    tableRow(['Grading Importance', answerValue(workload.gradingImportance), 'None']),
    tableRow(['Challenge Preference', answerValue(workload.challengePreference), 'None']),
    tableRow(['Recruiting Commitment', answerValue(commitments.recruiting), commitmentDetails]),
    tableRow(['UROP Commitment', answerValue(commitments.urop), commitmentDetails]),
    tableRow(['TA Commitment', answerValue(commitments.ta), commitmentDetails]),
    tableRow(['Club / Extracurricular Commitment', answerValue(commitments.clubs), commitmentDetails]),
    tableRow(['Other Major Commitments', answerValue(commitments.other, 'None specified'), 'None']),
    '',
    '### Desired Course Distribution by Direction',
    '',
    '| Direction / Area | Desired Number of Courses | Notes |',
    '|---|---:|---|',
    ...(desiredRows.length ? desiredRows : ['| None specified | — | — |']),
    '',
    '### Course Format Preferences',
    '',
    '| Course Format | Preference Level | Scale | Notes |',
    '|---|---:|---|---|',
    ...Object.entries(formatLabels).map(([key, label]) => ratingRow(label, formats[key], scale)),
    '',
    '### Collaboration and Work Style Preferences',
    '',
    '| Dimension | Preference | Scale | Notes |',
    '|---|---|---|---|',
    ratingRow('Collaboration Preference', formats.teamProjects, scale),
    ratingRow('Individual Work Preference', '', scale),
    ratingRow('Team-Based Work Preference', formats.teamProjects, scale),
    ratingRow('Coding Preference', topics.coding && topics.coding.interest, scale),
    ratingRow('Proof-Based Thinking Preference', topics.proofs && topics.proofs.interest, scale),
    ratingRow('Algorithmic Thinking Preference', topics.algorithms && topics.algorithms.interest, scale),
    ratingRow('Conceptual Thinking Preference', '', scale),
    ratingRow('Implementation Preference', topics.coding && topics.coding.interest, scale),
    ratingRow('Reading Preference', formats.paperReading, scale),
    '',
    '### Grading and Evaluation Preferences',
    '',
    '| Dimension | Preference | Notes |',
    '|---|---|---|',
    tableRow(['Prefers Lenient Grading', answerValue(grading.preferLenientGrading), 'None']),
    tableRow(['Avoids Harsh Curves', answerValue(grading.avoidHarshCurves), 'None']),
    tableRow(['Prefers Clear Rubrics', answerValue(grading.preferClearRubrics), 'None']),
    tableRow(['Comfortable With Exams', answerValue(formats.exams), `Scale: ${scale}`]),
    tableRow(['Comfortable With Projects', answerValue(formats.finalProjects), `Scale: ${scale}`]),
    tableRow(['Comfortable With Open-Ended Assignments', answerValue(formats.finalProjects), `Scale: ${scale}`]),
    tableRow(['Comfortable With Heavy Weekly Assignments', answerValue(workload.challengePreference), 'None']),
    '',
    '### Topic Skill Self-Ratings',
    '',
    '| Topic / Skill Area | Self-Rating | Scale | Notes |',
    '|---|---:|---|---|',
    ...Object.entries(topicLabels).map(([key, label]) => ratingRow(label, topics[key] && topics[key].skill, scale)),
    '',
    '### Contextual Synthesis for Recommendation Engine',
    '',
    '| Dimension | Synthesis | Evidence Used | Confidence |',
    '|---|---|---|---|',
    tableRow(['Academic Focus', academicRows.length ? 'Use explicit topic interest ratings as ranking signals.' : 'Unknown', 'questionnaire', academicRows.length ? 'Medium' : 'Low']),
    tableRow(['Preferred Course Style', Object.values(formats).some((value) => value !== '' && value !== undefined) ? 'Use explicit course format ratings as ranking signals.' : 'Unknown', 'questionnaire', Object.values(formats).some((value) => value !== '' && value !== undefined) ? 'Medium' : 'Low']),
    tableRow(['Workload Risk', workload.weeklyCourseHoursBudget ? 'Use weekly hours budget and commitments to flag heavy schedules.' : 'Unknown', 'questionnaire', workload.weeklyCourseHoursBudget ? 'Medium' : 'Low']),
    tableRow(['Areas to Prioritize', academicRows.length ? 'Prioritize areas with high explicit interest ratings.' : 'Unknown', 'questionnaire', academicRows.length ? 'Medium' : 'Low']),
    tableRow(['Areas to Avoid or Deprioritize', academicRows.some((row) => row.includes('Not Interested')) ? 'Deprioritize areas with very low explicit interest ratings.' : 'Unknown', 'questionnaire', academicRows.some((row) => row.includes('Not Interested')) ? 'Medium' : 'Low']),
    '',
    '### Additional User Notes',
    '',
    `- ${freeformNotes || questionnaire.freeformNotes || 'None specified'}`,
    '',
    '### Agent Follow-up Answers',
    '',
    '| Question | Answer |',
    '|---|---|',
    ...(followUps.filter((item) => item && (item.question || item.answer)).length
      ? followUps
          .filter((item) => item && (item.question || item.answer))
          .map((item) => tableRow([answerValue(item.question, 'Unknown'), answerValue(item.answer, 'None specified')]))
      : ['| None specified | — |']),
  ].join('\n');
}

function hasPromptExampleLeak(markdown, questionnaire = {}) {
  const source = JSON.stringify(questionnaire);
  const leakedValues = ['6.1220', 'computer vision', 'hardware', 'part-time research project'];
  return leakedValues.some((value) => markdown.includes(value) && !source.includes(value));
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

router.post('/personalization-questions', asyncRoute(async (req, res) => {
  if (!process.env.OPENROUTER_API_KEY) {
    res.json({ ok: true, questions: null, source: 'fallback' });
    return;
  }

  const profile = req.body.profile || {};
  const personalCourseMarkdown = normalizeText(req.body.personalCourseMarkdown).slice(0, 12000);
  const personalization = req.body.personalization || {};
  const prompt = `You write short, friendly question copy for Fireroad.ai's optional MIT course recommendation personalization flow.

Return only JSON with this exact shape:
{
  "questions": {
    "workload": {"title": "...", "body": "..."},
    "evaluation": {"title": "...", "body": "..."},
    "interests": {"title": "...", "body": "..."},
    "skills": {"title": "...", "body": "..."},
    "formats": {"title": "...", "body": "..."},
    "notes": {"title": "...", "body": "..."}
  }
}

Rules:
- Each title must be under 90 characters.
- Each body must be under 160 characters.
- Ask about preferences, not specific course recommendations.
- Personalize wording using the profile and personal_course.md if helpful.
- Do not invent facts about the student.

PROFILE_JSON:
${JSON.stringify(profile, null, 2)}

EXISTING_PERSONALIZATION_JSON:
${JSON.stringify(personalization, null, 2)}

PERSONAL_COURSE_MD:
${personalCourseMarkdown || 'Not provided'}`;

  const completion = await callOpenRouter({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 600,
  });
  const parsed = parseJsonObject(completion?.choices?.[0]?.message?.content);
  res.json({
    ok: true,
    questions: parsed && parsed.questions ? parsed.questions : null,
    source: parsed && parsed.questions ? 'model' : 'fallback',
  });
}));

router.post('/personalization-followups', asyncRoute(async (req, res) => {
  const fallbackQuestions = [
    'Is there a kind of course you liked or disliked in the past that the recommender should understand better?',
    'Are there any constraints this semester that are not captured by workload hours or commitments?',
  ];

  if (!process.env.OPENROUTER_API_KEY) {
    res.json({ ok: true, questions: fallbackQuestions, source: 'fallback' });
    return;
  }

  const profile = req.body.profile || {};
  const personalCourseMarkdown = normalizeText(req.body.personalCourseMarkdown).slice(0, 12000);
  const personalization = req.body.personalization || {};
  const prompt = `You are Fireroad.ai's personalization follow-up interviewer for MIT course recommendations.

Generate 1 to 3 short follow-up questions that would help personalize course recommendations beyond the fixed questionnaire.

Return only JSON:
{"questions":["question 1","question 2"]}

Rules:
- Ask questions the user can answer in 1-3 sentences.
- Use the student's profile, personal_course.md, and current questionnaire answers.
- Do not ask for information already clearly answered.
- Do not recommend specific courses.
- Do not invent facts.
- Avoid sensitive personal information.
- Prefer questions about concrete context, tradeoffs, or examples: what kind of UROP/recruiting/TA work, past course likes/dislikes, preferred intensity, project/team/exam nuance, or goals.

PROFILE_JSON:
${JSON.stringify(profile, null, 2)}

PERSONALIZATION_JSON:
${JSON.stringify(personalization, null, 2)}

PERSONAL_COURSE_MD:
${personalCourseMarkdown || 'Not provided'}`;

  const completion = await callOpenRouter({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 500,
  });
  const parsed = parseJsonObject(completion?.choices?.[0]?.message?.content);
  const questions = Array.isArray(parsed && parsed.questions)
    ? parsed.questions.map((question) => String(question || '').trim()).filter(Boolean).slice(0, 3)
    : [];

  res.json({
    ok: true,
    questions: questions.length ? questions : fallbackQuestions,
    source: questions.length ? 'model' : 'fallback',
  });
}));

router.post('/personalization-prefill', asyncRoute(async (req, res) => {
  const personalCourseMarkdown = normalizeText(req.body.personalCourseMarkdown).slice(0, 16000);
  if (!personalCourseMarkdown) {
    res.json({ ok: true, personalization: null, source: 'empty' });
    return;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    res.json({
      ok: true,
      personalization: null,
      source: 'model_unavailable',
      warning: 'OPENROUTER_API_KEY is not set, so personalization prefill was skipped.',
    });
    return;
  }

  const profile = req.body.profile || {};
  const prompt = `You infer an initial course-recommendation personalization draft for Fireroad.ai from a student's personal_course.md.

Return only JSON with this exact shape:
{
  "personalization": {
    "topicRatings": {
      "coding": {"skill": 0, "interest": 0, "evidence": "..."},
      "proofs": {"skill": 0, "interest": 0, "evidence": "..."},
      "algorithms": {"skill": 0, "interest": 0, "evidence": "..."},
      "probability": {"skill": 0, "interest": 0, "evidence": "..."},
      "linearAlgebra": {"skill": 0, "interest": 0, "evidence": "..."},
      "machineLearning": {"skill": 0, "interest": 0, "evidence": "..."},
      "systems": {"skill": 0, "interest": 0, "evidence": "..."}
    },
    "formatPreferences": {
      "psets": 0,
      "codingLabs": 0,
      "exams": 0,
      "labs": 0,
      "finalProjects": 0,
      "paperReading": 0,
      "teamProjects": 0,
      "presentations": 0
    },
    "desiredCoursesPerDirection": {
      "machineLearning": 0,
      "theory": 0,
      "systems": 0,
      "math": 0,
      "hass": 0
    },
    "freeformNotes": "...",
    "inferenceSummary": "..."
  }
}

Rules:
- Use 0-10 integers only for skill, interest, and format ratings.
- Use low confidence when evidence is weak; do not infer from grades alone.
- Skill may use completed coursework, background, resume, and skill-level sections.
- Interest may use thumbs-up/down course preferences, freeform notes, resume projects, and planning preferences.
- If no evidence exists for a field, use 5 for neutral/unknown.
- Keep evidence phrases short and cite course numbers or sections when possible.
- Do not recommend specific future courses here.
- Do not invent facts not supported by the markdown.

PROFILE_JSON:
${JSON.stringify(profile, null, 2)}

PERSONAL_COURSE_MD:
${personalCourseMarkdown}`;

  const completion = await callOpenRouter({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1600,
  });
  const parsed = parseJsonObject(completion?.choices?.[0]?.message?.content);
  const personalization = cleanPersonalizationPrefill(parsed && parsed.personalization);
  res.json({
    ok: true,
    personalization,
    source: parsed && parsed.personalization ? 'model' : 'parse_fallback',
  });
}));

router.post('/more-preferences', asyncRoute(async (req, res) => {
  const personalCourseMarkdown = normalizeText(req.body.personalCourseMarkdown);
  if (!personalCourseMarkdown) throw new Error('personalCourseMarkdown is required before saving further preferences.');

  const questionnaire = req.body.questionnaire && typeof req.body.questionnaire === 'object'
    ? req.body.questionnaire
    : parseJsonField(req.body.questionnaire, {});
  const normalizedData = req.body.normalizedData && typeof req.body.normalizedData === 'object'
    ? req.body.normalizedData
    : parseJsonField(req.body.normalizedData, {});
  const freeformNotes = normalizeText(req.body.freeformNotes || questionnaire.freeformNotes);

  if (!process.env.OPENROUTER_API_KEY) {
    res.json(markdownResponse(personalCourseMarkdown, ['OPENROUTER_API_KEY is not set, so personal_course.md was not regenerated.'], {
      summary: 'Further personalization saved structurally. Markdown regeneration was skipped because the model is unavailable.',
      skippedMarkdownUpdate: true,
    }));
    return;
  }

  let updatedMarkdown;
  let usedDeterministicFallback = false;
  try {
    updatedMarkdown = await runPromptFile('prompt4_more.md', {
      PERSONAL_COURSE_MD: personalCourseMarkdown,
      QUESTIONNAIRE_JSON: JSON.stringify(questionnaire || {}, null, 2),
      USER_FREEFORM_NOTES: freeformNotes || 'None specified',
      OPTIONAL_NORMALIZED_DATA: JSON.stringify(normalizedData || {}, null, 2),
    });
    if (hasPromptExampleLeak(updatedMarkdown, questionnaire)) {
      usedDeterministicFallback = true;
      updatedMarkdown = replacePlanningPreferenceSection(
        personalCourseMarkdown,
        buildPlanningPreferenceSection(questionnaire, freeformNotes),
      );
    }
  } catch (error) {
    usedDeterministicFallback = true;
    updatedMarkdown = replacePlanningPreferenceSection(
      personalCourseMarkdown,
      buildPlanningPreferenceSection(questionnaire, freeformNotes),
    );
  }

  res.json(markdownResponse(updatedMarkdown, [], {
    summary: usedDeterministicFallback
      ? 'Further course-planning preferences updated with the deterministic fallback.'
      : 'Further course-planning preferences updated.',
    usedDeterministicFallback,
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
