// Browser adapter around shared/mock-data.js.
window.FRDATA = (function (source) {
  if (!source) {
    throw new Error('shared/mock-data.js must be loaded before data.js');
  }

  const getCourse = (id) => {
    const normalized = String(id || '').trim().toLowerCase();
    return source.catalog.find((c) => c.id.toLowerCase() === normalized);
  };

  const getMatch = (id) => source.matchScores[id] || { total: 0, interest: 0, workload: 0, reqValue: 0 };
  const currentCache = new Map();
  let catalogCache = null;

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
      days: fallback?.days || [],
      time: fallback?.time || { start: 0, end: 0 },
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
      current,
    };
  };

  const fetchJson = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  };

  const fetchCurrentCourse = async (id) => {
    const normalized = String(id || '').trim().toUpperCase();
    if (!normalized) return null;
    if (currentCache.has(normalized)) return currentCache.get(normalized);
    try {
      const payload = await fetchJson(`/api/current/course/${encodeURIComponent(normalized)}`);
      const course = toPlannerCourse(payload.course);
      if (course) currentCache.set(normalized, course);
      return course;
    } catch (error) {
      return getCourse(normalized);
    }
  };

  const fetchCurrentSearch = async (query = '', maxResults = 20) => {
    try {
      const payload = await fetchJson(`/api/current/search?q=${encodeURIComponent(query)}&max_results=${encodeURIComponent(maxResults)}`);
      return (payload.results || []).map(toPlannerCourse).filter(Boolean);
    } catch (error) {
      return source.catalog.filter((course) => !course._stub);
    }
  };

  const fetchCurrentCatalog = async () => {
    if (catalogCache) return catalogCache;
    try {
      const payload = await fetchJson('/api/current/catalog?max_results=500');
      catalogCache = (payload.courses || []).map(toPlannerCourse).filter(Boolean);
    } catch (error) {
      catalogCache = source.catalog.filter((course) => !course._stub);
    }
    return catalogCache;
  };

  return {
    ...source,
    defaultActiveSem: 'S25',
    planningTermLabel: source.semesterLabels?.S25 || 'Next Semester',
    fetchCurrentCatalog,
    fetchCurrentCourse,
    fetchCurrentSearch,
    getCourse,
    getMatch,
    toPlannerCourse,
  };
})(window.FRMOCKDATA);
