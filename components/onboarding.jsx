/* global React, FRDATA, PersonalCourse, Icon, ThemeToggle, Logo, useApp */
const { useState, useEffect, useMemo, useRef } = React;

const MIT_GRADES_URL = 'https://registrar.mit.edu/classes-grades-evaluations/grades';
const MIT_WEBSIS_URL = 'https://student.mit.edu/';
const ONBOARDING_DRAFT_KEY = 'fr-onboarding-draft-v2';
const ONBOARDING_FILE_DB = 'fr-onboarding-files-v1';
const ONBOARDING_FILE_STORE = 'files';
const BUILD_PHASES = [
  'Syncing profile',
  'Parsing uploaded PDFs',
  'Calibrating preferences',
  'Building next semester plan',
];

const MAJORS = [
  ['6-2', 'Course 6-2: Electrical Engineering and Computer Science'],
  ['6-3', 'Course 6-3: Computer Science and Engineering'],
  ['6-4', 'Course 6-4: Artificial Intelligence and Decision Making'],
  ['6-7', 'Course 6-7: Computer Science and Molecular Biology'],
  ['6-9', 'Course 6-9: Computation and Cognition'],
  ['18', 'Course 18: Mathematics'],
  ['8', 'Course 8: Physics'],
  ['15', 'Course 15: Management'],
  ['undecided', 'Undecided / exploring'],
  ['other', 'Other'],
];

const STANDINGS = [
  ['prefrosh', 'Pre-freshman'],
  ['freshman', 'Freshman'],
  ['sophomore', 'Sophomore'],
  ['junior', 'Junior'],
  ['senior', 'Senior'],
  ['meng', 'MEng'],
];

const SKILL_LEVELS = [
  {
    id: 'pre-cracked',
    title: 'Pre-cracked',
    body: 'Olympiad / serious competition background; hard technical classes usually feel approachable.',
  },
  {
    id: 'competition-lite',
    title: 'Some competition experience',
    body: 'You have done contests or advanced projects, but you still want ramp-aware recommendations.',
  },
  {
    id: 'high-school',
    title: 'High-school course level',
    body: 'Mostly AP, IB, A-level, or regular high-school coursework; start from a steadier ramp.',
  },
];

const emptyData = {
  name: '',
  major: '6-3',
  futureProgram: '',
  standing: 'sophomore',
  gpa: '',
  transcriptUploaded: false,
  transcriptFileName: '',
  transcriptParsed: false,
  transcriptParsing: false,
  resumeUploaded: false,
  resumeFileName: '',
  resumeParsed: false,
  resumeParsing: false,
  transcriptText: '',
  resumeText: '',
  personalCourseMarkdown: '',
  parseWarnings: [],
  transcriptError: '',
  resumeError: '',
  courseworkError: '',
  completionError: '',
  courseworkImporting: false,
  finishing: false,
  courseworkImported: false,
  courseworkText: '',
  courseworkSource: 'paste',
  futureCourseworkIds: [],
  courses: [],
  courseFeelReviewed: false,
  skillLevel: 'competition-lite',
  preferencesNote: '',
  buildStatus: '',
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const sanitizeDraftData = (value) => ({
  ...emptyData,
  ...(value || {}),
  transcriptParsing: false,
  resumeParsing: false,
  courseworkImporting: false,
  finishing: false,
  buildStatus: '',
  completionError: '',
});

const readOnboardingDraft = (key) => {
  const stored = safeJsonParse(localStorage.getItem(key));
  if (!stored || typeof stored !== 'object') return null;
  return {
    data: sanitizeDraftData(stored.data || stored),
    active: typeof stored.active === 'string' ? stored.active : 'profile',
  };
};

const idbRequest = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const idbTransaction = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

const openOnboardingFileDb = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is unavailable.'));
    return;
  }
  const request = indexedDB.open(ONBOARDING_FILE_DB, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(ONBOARDING_FILE_STORE, { keyPath: 'key' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const saveOnboardingFile = async (key, file) => {
  const db = await openOnboardingFileDb();
  const tx = db.transaction(ONBOARDING_FILE_STORE, 'readwrite');
  tx.objectStore(ONBOARDING_FILE_STORE).put({
    key,
    file,
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    savedAt: Date.now(),
  });
  await idbTransaction(tx);
  db.close();
};

const loadOnboardingFile = async (key) => {
  const db = await openOnboardingFileDb();
  const tx = db.transaction(ONBOARDING_FILE_STORE, 'readonly');
  const record = await idbRequest(tx.objectStore(ONBOARDING_FILE_STORE).get(key));
  db.close();
  return record?.file || null;
};

const removeOnboardingFile = async (key) => {
  const db = await openOnboardingFileDb();
  const tx = db.transaction(ONBOARDING_FILE_STORE, 'readwrite');
  tx.objectStore(ONBOARDING_FILE_STORE).delete(key);
  await idbTransaction(tx);
  db.close();
};

const courseName = (id) => {
  const course = FRDATA.getCourse(id);
  return course ? course.name : '';
};

const dedupeCourses = (courses) => {
  const seen = new Set();
  return courses.filter((course) => {
    const key = course.id.trim().toUpperCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const courseKey = (course) => [
  course.term || '',
  course.id || '',
  course.name || '',
  course.source || '',
].join('|');

const preserveCoursePreferences = (incoming, existing) => {
  const preferences = new Map((existing || []).map((course) => [courseKey(course), course.preference]));
  return (incoming || []).map((course) => ({
    ...course,
    preference: preferences.get(courseKey(course)) || course.preference || 'neutral',
  }));
};

const isPdfFile = (file) => Boolean(file && (
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
));

const onboardingFetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || response.statusText || 'Onboarding request failed.');
  }
  return payload;
};

const profileForPrompt = (data) => ({
  name: data.name,
  major: data.major,
  majorLabel: MAJORS.find(([id]) => id === data.major)?.[1] || data.major,
  futureProgram: data.futureProgram,
  academicStanding: data.standing,
  gpa: data.standing === 'prefrosh' ? 'N/A' : data.gpa,
});

const postOnboardingJson = (endpoint, body) => onboardingFetchJson(`/api/onboarding/${endpoint}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const postOnboardingFile = (endpoint, file, fields) => {
  const form = new FormData();
  form.append('file', file);
  Object.entries(fields || {}).forEach(([key, value]) => {
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  return onboardingFetchJson(`/api/onboarding/${endpoint}`, {
    method: 'POST',
    body: form,
  });
};

const extractActionCourseIds = (actions) => [...new Set((actions || [])
  .filter((action) => action && (action.type === 'add_course' || action.type === 'replace_course'))
  .map((action) => String(action.courseId || '').trim().toUpperCase())
  .filter(Boolean))];

const extractSuggestedCourseIds = (message) => [...new Set((message?.suggestions || [])
  .map((id) => String(id || '').trim().toUpperCase())
  .filter(Boolean))];

const fetchAgentPlanCourseIds = async ({ profile, personalCourseMarkdown, schedule, activeSem, maxResults = 4 }) => {
  const planningTermLabel = FRDATA.semesterLabels?.[activeSem] || activeSem || 'next semester';
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        text: `Build my ${planningTermLabel} course plan now. Add/include ${maxResults} courses directly, keep workload reasonable, respect my completed courses and preferences, and avoid courses I have already taken.`,
      }],
      profile,
      personalCourseMarkdown,
      schedule,
      activeSem,
      planningTermLabel,
      studentName: profile?.name,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message?.text || 'Agent planning failed.');
  const actionIds = extractActionCourseIds(payload.uiActions);
  if (actionIds.length) return actionIds.slice(0, maxResults);
  return extractSuggestedCourseIds(payload.message).slice(0, maxResults);
};

const parseCourseworkText = (text, source = 'manual') => {
  const matches = text.match(/\b(?:[0-9]{1,2}\.[0-9A-Z]{2,5}|(?:CMS|MAS|STS|WGS|EC|ES|CC|CS|IDS|SP|AS|MS|NS|PE)\.?[0-9A-Z]{2,5})\b/g) || [];
  return dedupeCourses(matches.map((raw) => {
    const id = raw.toUpperCase();
    return {
      id,
      name: courseName(id),
      grade: '',
      term: '',
      status: 'planned',
      source,
      preference: 'neutral',
    };
  }));
};

const plannedCourseIdsFromText = (text, personalCourseMarkdown = '') => {
  const parsed = parseCourseworkText(text, 'future plan');
  const summary = PersonalCourse?.summarize ? PersonalCourse.summarize(personalCourseMarkdown || '') : null;
  const pastIds = new Set([
    ...(summary?.completedCourseIds || []),
    ...(summary?.listenerCourseIds || []),
    ...(summary?.droppedCourseIds || []),
  ].map((id) => String(id).toUpperCase()));
  return parsed.map((course) => course.id).filter((id) => !pastIds.has(id));
};

const completedCoursesForRating = (courses) => (courses || [])
  .filter((course) => course.status === 'completed');

const termChronologyKey = (termLabel) => {
  const termId = PersonalCourse?.termIdFromLabel ? PersonalCourse.termIdFromLabel(termLabel) : '';
  const match = String(termId || '').match(/^(IAP|SU|S|F)(\d{2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const year = Number(match[2]);
  const rank = { IAP: 0, S: 1, SU: 2, F: 3 }[match[1]] ?? 9;
  return year * 10 + rank;
};

const groupedCoursesByTerm = (courses) => {
  const groups = new Map();
  completedCoursesForRating(courses).forEach((course) => {
    const term = course.term || 'Unknown term';
    if (!groups.has(term)) groups.set(term, []);
    groups.get(term).push(course);
  });
  return [...groups.entries()]
    .map(([term, rows]) => ({ term, rows }))
    .sort((a, b) => {
      const aKey = termChronologyKey(a.term);
      const bKey = termChronologyKey(b.term);
      if (aKey !== bKey) return aKey - bKey;
      return a.term.localeCompare(b.term);
    });
};

const toPersonalCourseMarkdown = (data) => {
  const lines = [
    '# personalcourse.md',
    '',
    '## Basic Info',
    `- name: ${data.name || 'TBD'}`,
    `- major: ${data.major}`,
    `- future_program_space: ${data.futureProgram || 'TBD'}`,
    `- standing: ${data.standing}`,
    `- gpa: ${data.standing === 'prefrosh' ? 'N/A' : (data.gpa || 'TBD')}`,
    '',
    '## Inputs',
    `- transcript: ${data.transcriptUploaded ? data.transcriptFileName || 'uploaded' : 'not_provided'}`,
    `- resume: ${data.resumeUploaded ? data.resumeFileName || 'uploaded' : 'not_provided'}`,
    `- coursework_import: ${data.courseworkImported ? data.courseworkSource : 'not_provided'}`,
    '',
    '## Courses',
    '| course | name | term | grade | status | source | preference |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(data.courses.length ? data.courses.map((course) => (
      `| ${course.id} | ${course.name || ''} | ${course.term || ''} | ${course.grade || ''} | ${course.status || 'completed'} | ${course.source || ''} | ${course.preference || 'neutral'} |`
    )) : ['| TBD |  |  |  |  |  |  |']),
    '',
    '## Preferences',
    `- skill_level: ${data.skillLevel}`,
    `- notes: ${data.preferencesNote || 'TBD'}`,
  ];
  return lines.join('\n');
};

const Onboarding = () => {
  const { profile, setRoute, setProfile, completeOnboarding, authState, signOut, activeSem, fourYearPlan } = useApp();
  const draftKey = authState?.user?.uid ? `${ONBOARDING_DRAFT_KEY}:${authState.user.uid}` : ONBOARDING_DRAFT_KEY;
  const draft = readOnboardingDraft(draftKey);
  const [data, setData] = useState(() => draft?.data || emptyData);
  const [active, setActive] = useState(() => draft?.active || 'profile');
  const transcriptFileRef = useRef(null);
  const resumeFileRef = useRef(null);
  const transcriptFileKey = `${draftKey}:transcript`;
  const resumeFileKey = `${draftKey}:resume`;

  const isPrefrosh = data.standing === 'prefrosh';
  const hasRichSignal = data.transcriptUploaded || data.resumeUploaded || data.transcriptParsed || data.resumeParsed || data.courseworkImported;
  const needsSkillStep = !hasRichSignal;
  const rateableCourseCount = completedCoursesForRating(data.courses).length;

  const steps = useMemo(() => {
    const list = [{ key: 'profile', label: 'Profile' }];
    if (!isPrefrosh) list.push({ key: 'transcript', label: 'Transcript' });
    list.push({ key: 'resume', label: 'Resume' });
    if (!isPrefrosh) list.push({ key: 'coursework', label: 'Coursework' });
    if (!isPrefrosh && rateableCourseCount > 0) list.push({ key: 'ratings', label: 'Course feel' });
    if (needsSkillStep) list.push({ key: 'skill', label: 'Skill level' });
    return list;
  }, [isPrefrosh, needsSkillStep, rateableCourseCount]);

  useEffect(() => {
    if (active === 'building') return;
    if (!steps.some((s) => s.key === active)) setActive(steps[steps.length - 1].key);
  }, [steps, active]);

  useEffect(() => {
    localStorage.setItem('fr-personalcourse-draft', data.personalCourseMarkdown || toPersonalCourseMarkdown(data));
    localStorage.setItem(draftKey, JSON.stringify({
      active,
      data: sanitizeDraftData(data),
    }));
  }, [data, active, draftKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      loadOnboardingFile(transcriptFileKey),
      loadOnboardingFile(resumeFileKey),
    ]).then(([transcriptResult, resumeResult]) => {
      if (cancelled) return;
      const transcriptFile = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
      const resumeFile = resumeResult.status === 'fulfilled' ? resumeResult.value : null;
      if (transcriptFile) transcriptFileRef.current = transcriptFile;
      if (resumeFile) resumeFileRef.current = resumeFile;
      if (transcriptFile || resumeFile) {
        setData((prev) => ({
          ...prev,
          transcriptFileName: transcriptFile && !prev.transcriptFileName ? transcriptFile.name : prev.transcriptFileName,
          resumeFileName: resumeFile && !prev.resumeFileName ? resumeFile.name : prev.resumeFileName,
        }));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [transcriptFileKey, resumeFileKey]);

  const upd = (key, value) => setData((prev) => ({ ...prev, [key]: value }));
  const mergeCourses = (incoming) => setData((prev) => ({
    ...prev,
    courses: dedupeCourses([...prev.courses, ...incoming]),
  }));
  const setCoursePreference = (key, preference) => setData((prev) => ({
    ...prev,
    courses: prev.courses.map((course) => courseKey(course) === key ? { ...course, preference } : course),
  }));

  const currentIndex = Math.max(0, steps.findIndex((s) => s.key === active));
  const goBack = () => currentIndex > 0 && setActive(steps[currentIndex - 1].key);
  const goNext = () => {
    if (active === 'profile' && !data.name.trim()) return;
    if (currentIndex >= steps.length - 1) {
      finish();
      return;
    }
    setActive(steps[currentIndex + 1].key);
  };
  const skipToNext = () => {
    if (currentIndex >= steps.length - 1) finish();
    else setActive(steps[currentIndex + 1].key);
  };

  const applyMarkdownPayload = (payload, extra = {}) => {
    setData((prev) => ({
      ...prev,
      ...extra,
      personalCourseMarkdown: payload.personalCourseMarkdown || prev.personalCourseMarkdown,
      courses: preserveCoursePreferences(payload.courses || [], prev.courses),
      parseWarnings: payload.warnings || [],
    }));
  };

  const handleTranscriptUpload = async (file) => {
    if (!isPdfFile(file)) {
      setData((prev) => ({ ...prev, transcriptError: 'Only PDF uploads are supported for transcripts right now.' }));
      return;
    }
    transcriptFileRef.current = file;
    setData((prev) => ({
      ...prev,
      transcriptUploaded: true,
      transcriptFileName: file.name,
      transcriptParsing: false,
      transcriptParsed: false,
      transcriptError: '',
    }));
    try {
      await saveOnboardingFile(transcriptFileKey, file);
    } catch (error) {
      setData((prev) => ({
        ...prev,
        transcriptError: 'Transcript is selected for this session, but could not be saved for refresh recovery.',
      }));
    }
  };

  const ensureBaseMarkdown = async (sourceData = data) => {
    if (sourceData.personalCourseMarkdown) return sourceData.personalCourseMarkdown;
    const payload = await postOnboardingJson('profile', {
      profile: profileForPrompt(sourceData),
      transcriptText: sourceData.transcriptText,
      courseworkText: '',
    });
    applyMarkdownPayload(payload);
    return payload.personalCourseMarkdown;
  };

  const handleResumeUpload = async (file) => {
    if (!isPdfFile(file)) {
      setData((prev) => ({ ...prev, resumeError: 'Only PDF uploads are supported for resumes right now.' }));
      return;
    }
    resumeFileRef.current = file;
    setData((prev) => ({
      ...prev,
      resumeUploaded: true,
      resumeFileName: file.name,
      resumeParsing: false,
      resumeParsed: false,
      resumeError: '',
    }));
    try {
      await saveOnboardingFile(resumeFileKey, file);
    } catch (error) {
      setData((prev) => ({
        ...prev,
        resumeError: 'Resume is selected for this session, but could not be saved for refresh recovery.',
      }));
    }
  };

  const importCoursework = async () => {
    if (!data.courseworkText.trim()) return;
    setData((prev) => ({ ...prev, courseworkImporting: true, courseworkError: '' }));
    try {
      const plannedIds = plannedCourseIdsFromText(data.courseworkText, data.personalCourseMarkdown);
      setData((prev) => ({
        ...prev,
        courseworkImported: true,
        courseworkImporting: false,
        futureCourseworkIds: plannedIds,
      }));
    } catch (error) {
      setData((prev) => ({
        ...prev,
        courseworkImporting: false,
        courseworkError: error.message,
      }));
    }
  };

  const finish = async () => {
    setActive('building');
    setData((prev) => ({ ...prev, finishing: true, completionError: '', buildStatus: BUILD_PHASES[0] }));
    try {
      let personalCourseMarkdown = data.personalCourseMarkdown;
      let courses = data.courses;
      let transcriptText = data.transcriptText;
      let resumeText = data.resumeText;

      if (data.transcriptUploaded && !data.transcriptParsed) {
        setData((prev) => ({ ...prev, buildStatus: BUILD_PHASES[1], transcriptParsing: true }));
        const transcriptFile = transcriptFileRef.current || await loadOnboardingFile(transcriptFileKey);
        if (!transcriptFile) {
          throw new Error('Transcript PDF is no longer available in this browser session. Please go back and upload it again.');
        }
        transcriptFileRef.current = transcriptFile;
        const transcriptPayload = await postOnboardingFile('transcript', transcriptFile, {
          profile: profileForPrompt(data),
        });
        personalCourseMarkdown = transcriptPayload.personalCourseMarkdown || personalCourseMarkdown;
        transcriptText = transcriptPayload.transcriptText || transcriptText;
        courses = preserveCoursePreferences(transcriptPayload.courses || courses, courses);
        setData((prev) => ({
          ...prev,
          transcriptParsed: true,
          transcriptParsing: false,
          transcriptText,
          transcriptFileName: transcriptPayload.fileName || prev.transcriptFileName,
          personalCourseMarkdown,
          courses,
          parseWarnings: transcriptPayload.warnings || prev.parseWarnings,
        }));
      }

      if (!personalCourseMarkdown) {
        setData((prev) => ({ ...prev, buildStatus: BUILD_PHASES[0] }));
        const basePayload = await postOnboardingJson('profile', {
          profile: profileForPrompt(data),
          transcriptText,
          courseworkText: '',
        });
        personalCourseMarkdown = basePayload.personalCourseMarkdown;
        courses = preserveCoursePreferences(basePayload.courses || [], courses);
      }

      if (data.resumeUploaded && !data.resumeParsed) {
        setData((prev) => ({ ...prev, buildStatus: BUILD_PHASES[1], resumeParsing: true }));
        const resumeFile = resumeFileRef.current || await loadOnboardingFile(resumeFileKey);
        if (!resumeFile) {
          throw new Error('Resume PDF is no longer available in this browser session. Please go back and upload it again.');
        }
        resumeFileRef.current = resumeFile;
        const resumePayload = await postOnboardingFile('resume', resumeFile, {
          profile: profileForPrompt(data),
          personalCourseMarkdown,
          userBackgroundText: data.preferencesNote,
          transcriptText,
          courseworkText: '',
          skillLevels: data.skillLevel ? { overall_technical_ramp_level: data.skillLevel } : {},
        });
        personalCourseMarkdown = resumePayload.personalCourseMarkdown || personalCourseMarkdown;
        resumeText = resumePayload.resumeText || resumeText;
        courses = preserveCoursePreferences(resumePayload.courses || courses, courses);
        setData((prev) => ({
          ...prev,
          resumeParsed: true,
          resumeParsing: false,
          resumeText,
          resumeFileName: resumePayload.fileName || prev.resumeFileName,
          personalCourseMarkdown,
          courses,
          preferencesNote: prev.preferencesNote || resumePayload.summary || '',
          parseWarnings: resumePayload.warnings || prev.parseWarnings,
        }));
      }

      const preferenceCourses = completedCoursesForRating(courses);
      if (!data.courseFeelReviewed && active !== 'ratings' && preferenceCourses.length > 0) {
        setData((prev) => ({
          ...prev,
          finishing: false,
          buildStatus: '',
          personalCourseMarkdown,
          courses,
          transcriptText,
          resumeText,
        }));
        setActive('ratings');
        return;
      }

      if (preferenceCourses.length > 0) {
        setData((prev) => ({ ...prev, buildStatus: BUILD_PHASES[2] }));
        const preferencePayload = await postOnboardingJson('preferences', {
          personalCourseMarkdown,
          courses: preferenceCourses,
        });
        personalCourseMarkdown = preferencePayload.personalCourseMarkdown;
        courses = preserveCoursePreferences(preferencePayload.courses || courses, courses);
      }

      const summary = PersonalCourse.summarize(personalCourseMarkdown || '');
      const taken = summary.completedCourseIds || courses.map((course) => course.id);
      const majorLabel = MAJORS.find(([id]) => id === data.major)?.[1] || data.major;
      const nextProfile = {
        ...profile,
        name: data.name || profile.name,
        major: data.major === 'undecided' ? 'Undecided' : data.major.startsWith('Course') ? data.major : `Course ${data.major}`,
        majorLabel,
        year: STANDINGS.find(([id]) => id === data.standing)?.[1] || data.standing,
        taken,
        preferences: {
          ...profile.preferences,
          skillLevel: data.skillLevel,
          notes: data.preferencesNote,
          futureCourseworkIds: data.futureCourseworkIds || [],
        },
      };

      setData((prev) => ({ ...prev, buildStatus: BUILD_PHASES[3] }));
      let recommendedCourseIds = [];
      try {
        const currentSchedule = Array.isArray(fourYearPlan?.[activeSem]) ? fourYearPlan[activeSem] : [];
        const planningSchedule = [...currentSchedule, ...(data.futureCourseworkIds || [])];
        recommendedCourseIds = await fetchAgentPlanCourseIds({
          profile: nextProfile,
          personalCourseMarkdown,
          schedule: planningSchedule,
          activeSem,
          maxResults: 4,
        });
      } catch (error) {
        console.warn('Could not build agent plan recommendations', error);
        try {
          const currentSchedule = Array.isArray(fourYearPlan?.[activeSem]) ? fourYearPlan[activeSem] : [];
          const recommendations = await FRDATA.fetchCurrentRecommendations({
            schedule: [...currentSchedule, ...(data.futureCourseworkIds || [])],
            profile: nextProfile,
            personalCourseMarkdown,
            maxResults: 4,
          });
          recommendedCourseIds = recommendations
            .map((course) => course?.id)
            .filter(Boolean)
            .slice(0, 4);
        } catch (fallbackError) {
          console.warn('Could not build fallback plan recommendations', fallbackError);
        }
      }

      const onboardingForStorage = {
        ...data,
        courses,
        courseFeelReviewed: data.courseFeelReviewed || active === 'ratings',
        personalCourseMarkdown,
        recommendedCourseIds,
        finishing: false,
        transcriptText: data.transcriptText ? '[extracted text omitted from stored onboarding payload]' : '',
        resumeText: data.resumeText ? '[extracted text omitted from stored onboarding payload]' : '',
      };

      setProfile(nextProfile);
      localStorage.removeItem(draftKey);
      removeOnboardingFile(transcriptFileKey).catch(() => {});
      removeOnboardingFile(resumeFileKey).catch(() => {});
      if (completeOnboarding) {
        completeOnboarding({
          profile: nextProfile,
          onboarding: onboardingForStorage,
          personalCourseMarkdown,
          recommendedCourseIds,
        });
      } else {
        setRoute({ name: 'planner' });
      }
    } catch (error) {
      setData((prev) => ({
        ...prev,
        finishing: false,
        transcriptParsing: false,
        resumeParsing: false,
        buildStatus: '',
        completionError: error.message,
      }));
      setActive(steps[steps.length - 1]?.key || 'profile');
    }
  };

  const stepProps = {
    data, upd, goNext, goBack, skipToNext, currentIndex, steps,
    handleTranscriptUpload, handleResumeUpload, importCoursework, mergeCourses, setCoursePreference,
    isPrefrosh,
    isLastStep: currentIndex >= steps.length - 1,
  };

  return (
    <div className="fade-in" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {authState?.user?.email && (
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{authState.user.email}</span>
          )}
          <ThemeToggle />
          {signOut && (
            <button className="btn btn-ghost" onClick={signOut} style={{ padding: '8px 10px' }}>
              <Icon name="logOut" size={14} /> Sign out
            </button>
          )}
        </div>
      </div>

      {active !== 'building' && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 24px 26px' }}>
          <Stepper steps={steps} active={active} setActive={setActive} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0 24px 56px' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          {active === 'building' && <BuildProgress data={data} />}
          {active === 'profile' && <StepProfile {...stepProps} />}
          {active === 'transcript' && <StepTranscript {...stepProps} />}
          {active === 'resume' && <StepResume {...stepProps} />}
          {active === 'coursework' && <StepCoursework {...stepProps} />}
          {active === 'skill' && <StepSkill {...stepProps} />}
          {active === 'ratings' && <StepRatings {...stepProps} />}
        </div>
      </div>
    </div>
  );
};

const Stepper = ({ steps, active, setActive }) => {
  const activeIndex = steps.findIndex((s) => s.key === active);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase' }}>
      {steps.map((step, index) => (
        <React.Fragment key={step.key}>
          <button
            onClick={() => index <= activeIndex && setActive(step.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: index === activeIndex ? 'var(--text)' : index < activeIndex ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              cursor: index <= activeIndex ? 'pointer' : 'default',
            }}
          >
            <span style={{
              width: 23,
              height: 23,
              borderRadius: '50%',
              border: '1px solid ' + (index === activeIndex ? 'var(--accent)' : 'var(--border-strong)'),
              background: index < activeIndex ? 'var(--accent)' : index === activeIndex ? 'var(--accent-soft)' : 'transparent',
              color: index < activeIndex ? '#fff' : index === activeIndex ? 'var(--accent)' : 'var(--text-tertiary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
            }}>
              {index < activeIndex ? <Icon name="check" size={12} /> : index + 1}
            </span>
            {step.label}
          </button>
          {index < steps.length - 1 && <span style={{ width: 22, height: 1, background: 'var(--border)' }} />}
        </React.Fragment>
      ))}
    </div>
  );
};

const StepHeader = ({ eyebrow, title, sub }) => (
  <div style={{ marginBottom: 26 }}>
    <div className="eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>
    <h1 className="display" style={{ margin: 0, fontSize: 32, fontWeight: 600, lineHeight: 1.15, letterSpacing: 0 }}>{title}</h1>
    {sub && <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 15 }}>{sub}</p>}
  </div>
);

const Field = ({ label, children, hint, required = false }) => (
  <div style={{ marginBottom: 19 }}>
    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
      {label}
      {required && <span style={{ color: '#EF4444', marginLeft: 4 }}>*</span>}
    </label>
    {children}
    {hint && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>{hint}</div>}
  </div>
);

const TextInput = (props) => (
  <input
    {...props}
    style={{
      width: '100%',
      padding: '11px 14px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      fontSize: 14,
      ...props.style,
    }}
  />
);

const TextArea = (props) => (
  <textarea
    {...props}
    style={{
      width: '100%',
      minHeight: 112,
      resize: 'vertical',
      padding: '12px 14px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      fontSize: 14,
      lineHeight: 1.45,
      ...props.style,
    }}
  />
);

const Select = ({ value, onChange, options }) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value)}
    style={{
      width: '100%',
      padding: '11px 14px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      fontSize: 14,
      appearance: 'none',
      backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8F9A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 14px center',
    }}
  >
    {options.map(([valueOption, label]) => <option key={valueOption} value={valueOption}>{label}</option>)}
  </select>
);

const Choice = ({ value, current, onClick, title, children }) => (
  <button
    type="button"
    onClick={() => onClick(value)}
    style={{
      width: '100%',
      textAlign: 'left',
      padding: '14px 16px',
      borderRadius: 'var(--r-md)',
      border: '1px solid ' + (current === value ? 'var(--accent)' : 'var(--border)'),
      background: current === value ? 'var(--accent-soft)' : 'var(--surface)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      transition: 'background 140ms, border-color 140ms',
    }}
  >
    <span style={{
      width: 16,
      height: 16,
      borderRadius: '50%',
      flexShrink: 0,
      marginTop: 2,
      border: '1.5px solid ' + (current === value ? 'var(--accent)' : 'var(--border-strong)'),
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {current === value && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
    </span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: 'block', color: 'var(--text)', fontWeight: 500 }}>{title}</span>
      <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 13, marginTop: 3 }}>{children}</span>
    </span>
  </button>
);

const StepNav = ({ onNext, onBack, onSkip, nextLabel = 'Continue', disabled = false, optional = false }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 30, gap: 12 }}>
    {onBack ? (
      <button className="btn btn-ghost" onClick={onBack} style={{ padding: '10px 14px' }}>
        <Icon name="arrowLeft" size={14} /> Back
      </button>
    ) : <span />}
    <div style={{ display: 'flex', gap: 8 }}>
      {optional && (
        <button className="btn btn-ghost" onClick={onSkip} style={{ padding: '10px 14px' }}>
          Skip
        </button>
      )}
      <button className="btn btn-primary" disabled={disabled} onClick={onNext} style={{ padding: '11px 22px', opacity: disabled ? 0.5 : 1 }}>
        {nextLabel} <Icon name="arrowRight" size={14} />
      </button>
    </div>
  </div>
);

const UploadZone = ({ icon = 'upload', title, sub, busy, busyTitle, busySub, onUpload, accept = '.pdf' }) => {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const pickFile = (file) => {
    if (file) onUpload(file);
    if (inputRef.current) inputRef.current.value = '';
  };
  return (
    <div
      onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDrag(false);
        pickFile(event.dataTransfer.files?.[0]);
      }}
      onClick={() => !busy && inputRef.current?.click()}
      style={{
        border: '1.5px dashed ' + (drag ? 'var(--accent)' : 'var(--border-strong)'),
        background: drag ? 'var(--accent-soft)' : 'var(--surface)',
        borderRadius: 'var(--r-lg)',
        padding: '38px 24px',
        textAlign: 'center',
        cursor: busy ? 'default' : 'pointer',
        transition: 'background 160ms, border-color 160ms',
      }}
    >
      {busy ? (
        <div>
          <div style={{ display: 'inline-flex', gap: 4, marginBottom: 14 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: `pulse 1s infinite ${i * 0.15}s`,
              }} />
            ))}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text)' }}>{busyTitle}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{busySub}</div>
        </div>
      ) : (
        <div>
          <Icon name={icon} size={28} />
          <div style={{ marginTop: 12, fontSize: 15, fontWeight: 500 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            hidden
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
        </div>
      )}
    </div>
  );
};

const StatusPill = ({ icon = 'check', tone = 'success', children }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 'var(--r-md)',
    background: tone === 'error' ? 'rgba(239, 68, 68, 0.08)' : tone === 'warning' ? 'rgba(245, 158, 11, 0.1)' : 'var(--accent-soft)',
    border: '1px solid ' + (tone === 'error' ? '#EF4444' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)'),
    marginTop: 14,
  }}>
    <Icon name={icon} size={14} style={{ color: tone === 'error' ? '#EF4444' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)' }} />
    <span style={{ fontSize: 13 }}>{children}</span>
  </div>
);

const CourseList = ({ courses, setCoursePreference, compact = false }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {courses.map((course) => (
      <div
        key={courseKey(course)}
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '86px 1fr 120px' : '92px 1fr 70px 126px',
          gap: 12,
          alignItems: 'center',
          padding: '11px 12px',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <span className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>{course.id}</span>
        <span style={{ minWidth: 0, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {course.name || 'Course title pending parse'}
        </span>
        {!compact && <span className="mono" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{course.grade || '-'}</span>}
        <PreferenceButtons value={course.preference} onChange={(value) => setCoursePreference(courseKey(course), value)} />
      </div>
    ))}
  </div>
);

const GroupedCourseList = ({ courses, setCoursePreference }) => {
  const groups = groupedCoursesByTerm(courses);
  if (!groups.length) {
    return (
      <div style={{ padding: 18, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-tertiary)' }}>
        No completed transcript courses found for rating.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groups.map((group) => (
        <div key={group.term}>
          <div className="mono" style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            {group.term}
          </div>
          <CourseList courses={group.rows} setCoursePreference={setCoursePreference} />
        </div>
      ))}
    </div>
  );
};

const PreferenceButtons = ({ value, onChange }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '36px 36px 36px',
    gap: 4,
    justifyContent: 'end',
  }}>
    {[
      ['like', 'thumbsUp', 'Liked it'],
      ['neutral', 'minus', 'Neutral'],
      ['dislike', 'thumbsDown', 'Disliked it'],
    ].map(([id, icon, title]) => (
      <button
        key={id}
        type="button"
        title={title}
        onClick={() => onChange(id)}
        style={{
          width: 34,
          height: 34,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid ' + (value === id ? 'var(--accent)' : 'var(--border)'),
          background: value === id ? 'var(--accent-soft)' : 'var(--surface-2)',
          color: value === id ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        <Icon name={icon} size={15} />
      </button>
    ))}
  </div>
);

const BuildProgress = ({ data }) => {
  const activeIndex = Math.max(0, BUILD_PHASES.findIndex((phase) => phase === data.buildStatus));
  const progress = Math.min(96, 18 + activeIndex * 24 + (data.finishing ? 12 : 0));
  return (
    <div className="slide-up" style={{
      minHeight: 420,
      display: 'grid',
      placeItems: 'center',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      borderRadius: 'var(--r-lg)',
      padding: 34,
    }}>
      <div style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', gap: 5, marginBottom: 22 }}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i <= activeIndex ? 'var(--accent)' : 'var(--border-strong)',
              animation: `pulse 1s infinite ${i * 0.12}s`,
            }} />
          ))}
        </div>
        <h1 className="display" style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: 0 }}>
          Building your first plan
        </h1>
        <p style={{ margin: '10px auto 24px', maxWidth: 420, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
          {data.buildStatus || 'Preparing your course context'}
        </p>
        <div style={{
          height: 8,
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: 'var(--accent)',
            transition: 'width 280ms ease',
          }} />
        </div>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {BUILD_PHASES.map((phase, index) => (
            <div key={phase} className="mono" style={{
              padding: '8px 6px',
              borderRadius: 8,
              background: index <= activeIndex ? 'var(--accent-soft)' : 'var(--surface-2)',
              color: index <= activeIndex ? 'var(--accent)' : 'var(--text-tertiary)',
              fontSize: 10,
              lineHeight: 1.25,
            }}>
              {phase}
            </div>
          ))}
        </div>
        {data.completionError && <StatusPill icon="x" tone="error">{data.completionError}</StatusPill>}
      </div>
    </div>
  );
};

const StepProfile = ({ data, upd, goNext }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Required"
      title="Basic student info"
    />
    <Field label="Your name" required>
      <TextInput placeholder="Alex Chen" value={data.name} onChange={(event) => upd('name', event.target.value)} />
    </Field>
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
      <Field label="Major / intended major" required>
        <Select value={data.major} onChange={(value) => upd('major', value)} options={MAJORS} />
      </Field>
      <Field label="Year" required>
        <Select value={data.standing} onChange={(value) => upd('standing', value)} options={STANDINGS} />
      </Field>
    </div>
    <Field label="Future double major / minor / concentration">
      <TextInput placeholder="Minor in 18, concentration in linguistics, etc." value={data.futureProgram} onChange={(event) => upd('futureProgram', event.target.value)} />
    </Field>
    {data.standing !== 'prefrosh' && (
      <Field label="GPA or academic standing">
        <TextInput placeholder="4.7 / 5.0, good standing, or leave blank" value={data.gpa} onChange={(event) => upd('gpa', event.target.value)} />
      </Field>
    )}
    {data.standing === 'prefrosh' && (
      <StatusPill icon="sparkle">Pre-freshman mode</StatusPill>
    )}
    <StepNav onNext={goNext} disabled={!data.name.trim()} />
  </div>
);

const StepTranscript = ({ data, goNext, goBack, skipToNext, handleTranscriptUpload, isLastStep }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional"
      title="Upload transcript or grade report"
    />
    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
      <a className="btn" href={MIT_GRADES_URL} target="_blank" rel="noreferrer">
        <Icon name="book" size={14} /> MIT grades
      </a>
      <a className="btn" href={MIT_WEBSIS_URL} target="_blank" rel="noreferrer">
        <Icon name="file" size={14} /> WebSIS
      </a>
    </div>
    <UploadZone
      title="Drop unofficial transcript or grade-report PDF"
      sub="or click to browse"
      busy={data.transcriptParsing}
      busyTitle="Reading transcript..."
      busySub="Extracting PDF text and building personal_course.md"
      onUpload={handleTranscriptUpload}
    />
    {data.transcriptError && <StatusPill icon="x" tone="error">{data.transcriptError}</StatusPill>}
    {data.parseWarnings.map((warning) => <StatusPill key={warning} icon="sparkle" tone="warning">{warning}</StatusPill>)}
    {data.transcriptUploaded && !data.transcriptParsed && <StatusPill>{data.transcriptFileName} is ready. It will be parsed when you build the plan.</StatusPill>}
    {data.transcriptParsed && <StatusPill>Parsed {data.courses.length} transcript course rows.</StatusPill>}
    <StepNav onNext={goNext} onBack={goBack} onSkip={skipToNext} optional nextLabel={isLastStep ? 'Build my plan' : 'Continue'} />
  </div>
);

const StepResume = ({ data, goNext, goBack, skipToNext, handleResumeUpload, isLastStep }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional"
      title="Upload resume"
    />
    <UploadZone
      icon="paperclip"
      title="Drop resume PDF"
      sub="or click to browse"
      accept=".pdf"
      busy={data.resumeParsing}
      busyTitle="Reading resume..."
      busySub="Extracting PDF text and inferring background"
      onUpload={handleResumeUpload}
    />
    {data.resumeError && <StatusPill icon="x" tone="error">{data.resumeError}</StatusPill>}
    {data.parseWarnings.map((warning) => <StatusPill key={warning} icon="sparkle" tone="warning">{warning}</StatusPill>)}
    {data.resumeUploaded && !data.resumeParsed && <StatusPill>{data.resumeFileName} is ready. It will be parsed when you build the plan.</StatusPill>}
    {data.resumeParsed && <StatusPill>Resume parsed as {data.resumeFileName}. Skill/background section was added to personal_course.md.</StatusPill>}
    <StepNav onNext={goNext} onBack={goBack} onSkip={skipToNext} optional nextLabel={isLastStep ? 'Build my plan' : 'Continue'} />
  </div>
);

const StepCoursework = ({ data, upd, goNext, goBack, skipToNext, importCoursework, setCoursePreference, isLastStep }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional"
      title="Import future coursework plan"
    />
    <Field label="Import format">
      <Select value={data.courseworkSource} onChange={(value) => upd('courseworkSource', value)} options={[
        ['paste', 'Paste from Fireroad / notes'],
        ['csv', 'CSV export'],
        ['manual', 'Manual list'],
      ]} />
    </Field>
    <Field label="Planned coursework text" hint="Past transcript records are ignored here; this import is for future plans.">
      <TextArea
        placeholder="Paste courses here..."
        value={data.courseworkText}
        onChange={(event) => upd('courseworkText', event.target.value)}
      />
    </Field>
    <button
      className="btn"
      onClick={importCoursework}
      disabled={!data.courseworkText.trim() || data.courseworkImporting}
      style={{ opacity: data.courseworkText.trim() && !data.courseworkImporting ? 1 : 0.55 }}
    >
      <Icon name="download" size={14} /> {data.courseworkImporting ? 'Importing...' : 'Import planned courses'}
    </button>
    {data.courseworkError && <StatusPill icon="x" tone="error">{data.courseworkError}</StatusPill>}
    {data.courseworkImported && <StatusPill>{data.futureCourseworkIds.length} future planned courses imported.</StatusPill>}
    <StepNav onNext={goNext} onBack={goBack} onSkip={skipToNext} optional disabled={data.courseworkImporting} nextLabel={isLastStep ? 'Build my plan' : 'Continue'} />
  </div>
);

const StepSkill = ({ data, upd, goNext, goBack }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Calibration"
      title="Choose skill level"
    />
    <Field label="Programming / math competition background">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {SKILL_LEVELS.map((level) => (
          <Choice key={level.id} value={level.id} current={data.skillLevel} onClick={(value) => upd('skillLevel', value)} title={level.title}>
            {level.body}
          </Choice>
        ))}
      </div>
    </Field>
    <Field label="Optional note">
      <TextArea
        placeholder="Anything the agent should know about your background?"
        value={data.preferencesNote}
        onChange={(event) => upd('preferencesNote', event.target.value)}
        style={{ minHeight: 84 }}
      />
    </Field>
    {data.completionError && <StatusPill icon="x" tone="error">{data.completionError}</StatusPill>}
    <StepNav onNext={goNext} onBack={goBack} disabled={data.finishing} nextLabel={data.finishing ? 'Building...' : 'Build my plan'} />
  </div>
);

const StepRatings = ({ data, goNext, goBack, setCoursePreference }) => (
  <div className="slide-up">
    <StepHeader
      eyebrow="Optional calibration"
      title="How did these classes feel?"
    />
    <Field label="Completed courses">
      <GroupedCourseList courses={data.courses} setCoursePreference={setCoursePreference} />
    </Field>
    {data.completionError && <StatusPill icon="x" tone="error">{data.completionError}</StatusPill>}
    <StepNav onNext={goNext} onBack={goBack} disabled={data.finishing} nextLabel={data.finishing ? 'Building...' : 'Build my plan'} />
  </div>
);

if (!document.getElementById('pulse-anim')) {
  const style = document.createElement('style');
  style.id = 'pulse-anim';
  style.textContent = '@keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } }';
  document.head.appendChild(style);
}

window.FireroadPersonalCourse = { toMarkdown: toPersonalCourseMarkdown, parseCourseworkText };
window.Onboarding = Onboarding;
