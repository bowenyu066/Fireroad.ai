// Browser adapter around shared/mock-data.js.
window.FRDATA = (function (source) {
  if (!source) {
    throw new Error('shared/mock-data.js must be loaded before data.js');
  }

  const currentCache = new Map();
  let catalogCache = null;

  const getCourse = (id) => {
    const normalized = String(id || '').trim().toLowerCase();
    const cached = currentCache.get(normalized.toUpperCase());
    if (cached) return cached;
    return source.catalog.find((c) => c.id.toLowerCase() === normalized);
  };

  const getMatch = (id) => {
    const normalized = String(id || '').trim().toUpperCase();
    const cached = currentCache.get(normalized);
    if (cached?.personalMatch) return cached.personalMatch;
    return source.matchScores[normalized] || { total: 0, interest: 0, workload: 0, reqValue: 0 };
  };

  const termDefinitions = [
    ['F', 'Fall'],
    ['SU', 'Summer'],
    ['S', 'Spring'],
    ['IAP', 'January Term'],
  ];

  const termId = (code, year) => `${code}${String(year).slice(-2)}`;

  const termLabel = (code, year) => {
    const found = termDefinitions.find(([value]) => value === code);
    return `${found ? found[1] : code} ${year}`;
  };

  const currentPlanningTerm = (date = new Date()) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    if (month === 1) return { code: 'IAP', year };
    if (month >= 2 && month <= 3) return { code: 'S', year };
    if (month >= 4 && month <= 8) return { code: 'F', year };
    if (month >= 9 && month <= 11) return { code: 'S', year: year + 1 };
    return { code: 'IAP', year: year + 1 };
  };

  const buildTermOptions = (date = new Date()) => {
    const current = currentPlanningTerm(date);
    const currentId = termId(current.code, current.year);
    const all = [];
    for (let year = current.year; year >= current.year - 5; year -= 1) {
      termDefinitions.forEach(([code]) => {
        all.push({ id: termId(code, year), label: termLabel(code, year) });
      });
    }

    const startIndex = Math.max(0, all.findIndex((term) => term.id === currentId));
    return all.slice(startIndex, startIndex + 18);
  };

  const termOptions = buildTermOptions();
  const semesterLabels = { ...(source.semesterLabels || {}) };
  termOptions.forEach((term) => {
    semesterLabels[term.id] = term.label;
  });
  const semesterOrder = [
    ...termOptions.map((term) => term.id),
    ...(source.semesterOrder || []).filter((id) => !termOptions.some((term) => term.id === id)),
  ];
  const fourYearPlan = { ...(source.fourYearPlan || {}) };
  semesterOrder.forEach((id) => {
    fourYearPlan[id] = Array.isArray(fourYearPlan[id]) ? [...fourYearPlan[id]] : [];
  });
  const defaultActiveSem = termOptions[0]?.id || 'S25';

  const areaForCourseId = (id) => {
    const value = String(id || '');
    if (value.startsWith('6.')) return 'cs';
    if (value.startsWith('18.')) return 'math';
    if (value.startsWith('8.')) return 'physics';
    if (value.startsWith('7.')) return 'bio';
    if (value.startsWith('21') || value.startsWith('24') || value.startsWith('17') || value.startsWith('14') || value.startsWith('15')) return 'hass';
    return 'other';
  };

  const toPlannerCourse = (current) => {
    if (!current) return null;
    const fallback = getCourse(current.id);
    const ratingValue = current.rating && typeof current.rating.value === 'number'
      ? (current.rating.scale === 7 ? (current.rating.value / 7) * 5 : current.rating.value)
      : null;
    return {
      ...(fallback || {}),
      id: current.id,
      name: current.name || fallback?.name || current.id,
      units: Number(current.units) || fallback?.units || 0,
      schedule: current.scheduleDisplay || fallback?.schedule || 'Schedule TBD',
      days: (current.days && current.days.length > 0) ? current.days : (fallback?.days || []),
      time: (current.time && current.time.start !== 0) ? current.time : (fallback?.time || { start: 0, end: 0 }),
      instructor: current.instructorText || fallback?.instructor || '',
      satisfies: current.requirements || fallback?.satisfies || [],
      prereqs: current.prerequisitesRaw ? [current.prerequisitesRaw] : (fallback?.prereqs || []),
      hydrant: Number(current.totalHours) || fallback?.hydrant || 0,
      rating: fallback?.rating || {
        overall: ratingValue || 0,
        lectures: ratingValue || 0,
        difficulty: 0,
        n: current.enrollmentNumber || 0,
      },
      desc: current.desc || fallback?.desc || '',
      topics: fallback?.topics || [],
      quote: fallback?.quote || '',
      area: current.area || fallback?.area || areaForCourseId(current.id),
      personalMatch: current.personalMatch || current.personal_match || null,
      recommendationReasons: current.reasons || current.recommendationReasons || [],
      rankScore: current.rankScore || current.rank_score || current.personalMatch?.total || current.personal_match?.total || 0,
      scheduleRaw: current.scheduleRaw || '',
      offered: current.offered || null,
      current,
    };
  };

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  };

  const cacheCourses = (courses) => {
    courses.filter(Boolean).forEach((course) => {
      currentCache.set(String(course.id || '').trim().toUpperCase(), course);
      if (course.current?.oldId) currentCache.set(String(course.current.oldId).trim().toUpperCase(), course);
    });
    return courses;
  };

  const fetchCurrentCourse = async (id) => {
    const normalized = String(id || '').trim().toUpperCase();
    if (!normalized) return null;
    if (currentCache.has(normalized)) return currentCache.get(normalized);
    try {
      const payload = await fetchJson(`/api/current/course/${encodeURIComponent(normalized)}`);
      const course = toPlannerCourse(payload.course);
      if (course) {
        cacheCourses([course]);
        currentCache.set(normalized, course);
      }
      return course;
    } catch (error) {
      console.warn('[current course] API unavailable; not using mock fallback outside DEMO_MODE', error);
      return null;
    }
  };

  const fetchCurrentSearch = async (query = '', maxResults = 20) => {
    const payload = await fetchJson(`/api/current/search?q=${encodeURIComponent(query)}&max_results=${encodeURIComponent(maxResults)}`);
    return cacheCourses((payload.results || []).map(toPlannerCourse).filter(Boolean));
  };

  const fetchCurrentCatalog = async () => {
    if (catalogCache) return catalogCache;
    const payload = await fetchJson('/api/current/catalog?max_results=500');
    catalogCache = (payload.courses || []).map(toPlannerCourse).filter(Boolean);
    cacheCourses(catalogCache);
    return catalogCache;
  };

  const fetchCurrentRecommendations = async ({ schedule = [], profile = {}, personalCourseMarkdown = '', maxResults = 40 } = {}) => {
    const payload = await fetchJson('/api/current/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule, profile, personalCourseMarkdown, maxResults }),
    });
    return cacheCourses((payload.results || []).map(toPlannerCourse).filter(Boolean));
  };

  return {
    ...source,
    fourYearPlan,
    semesterLabels,
    semesterOrder,
    termOptions,
    defaultActiveSem,
    planningTermLabel: semesterLabels[defaultActiveSem] || 'Next Semester',
    fetchCurrentCatalog,
    fetchCurrentCourse,
    fetchCurrentRecommendations,
    fetchCurrentSearch,
    getCourse,
    getMatch,
    toPlannerCourse,
  };
})(window.FRMOCKDATA);
