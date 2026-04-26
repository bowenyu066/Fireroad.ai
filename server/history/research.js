const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DB_PATH, getDb, initDb } = require('./db');
const { createHistoryRepo } = require('./repo');
const { normalizeCourseId, normalizeDocType, normalizeTerm } = require('./normalize');
const { buildCourseHistorySummary, buildOfferingSummary, isDatedPastTerm } = require('./summary');
const { DEFAULT_MODEL, chatJson } = require('./openrouter');

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (error) {
  pdfParse = null;
}

const ROOT = path.join(__dirname, '..', '..');
const COURSES_PATH = path.join(ROOT, 'data', 'courses.json');
const PROMPT_VERSION = 'history-research-v1';
const DEFAULT_OPTIONS = {
  maxSearchQueries: 7,
  maxSearchResultsPerQuery: 8,
  maxCandidateUrlsForModel: 80,
  maxSources: 12,
  maxSourceBytes: 5 * 1024 * 1024,
  maxTextForModel: 22000,
  requestTimeoutMs: 15000,
  verbose: false,
  logger: null,
};

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readCourses() {
  try {
    const parsed = JSON.parse(fs.readFileSync(COURSES_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : Object.values(parsed);
  } catch (error) {
    return [];
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function createTrace(options = {}) {
  const events = [];
  const logger = options.logger || ((line) => console.error(line));
  const verbose = Boolean(options.verbose);

  return {
    events,
    emit(stage, payload = {}) {
      const event = {
        at: new Date().toISOString(),
        stage,
        ...payload,
      };
      events.push(event);
      if (verbose) logger(`[history:research] ${stage} ${JSON.stringify(payload)}`);
      return event;
    },
  };
}

function emitTrace(options, stage, payload = {}) {
  if (options.trace) options.trace.emit(stage, payload);
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function areaForCourseId(courseId) {
  const id = normalizeCourseId(courseId);
  if (id.startsWith('6.')) return 'cs';
  if (id.startsWith('18.')) return 'math';
  if (id.startsWith('8.')) return 'physics';
  if (id.startsWith('7.')) return 'bio';
  if (id.startsWith('21') || id.startsWith('24') || id.startsWith('17') || id.startsWith('14') || id.startsWith('15')) return 'hass';
  return 'other';
}

function buildCourseSeed(courseId) {
  const id = normalizeCourseId(courseId);
  const current = readCourses().find((course) => normalizeCourseId(course.subject_id || course.id) === id) || null;
  const aliasCandidates = [
    ...list(current?.old_id),
    ...list(current?.old_ids),
    ...list(current?.old_subject_id),
    ...list(current?.legacy_subject_id),
    ...list(current?.aliases),
  ];
  const aliases = unique(aliasCandidates.map(normalizeCourseId).filter((alias) => alias && alias !== id));

  return {
    id,
    title: current?.title || id,
    department: current?.department || id.split('.')[0],
    area: current?.area || areaForCourseId(id),
    units: current?.total_units || null,
    description: current?.description || null,
    instructors: list(current?.instructors).flat().map(compact).filter(Boolean),
    url: current?.url || null,
    aliases,
    current,
  };
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCharCode(Number(decimal)));
}

function htmlToText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function courseIdVariants(courseId) {
  const id = normalizeCourseId(courseId);
  return unique([
    id,
    id.replace(/\./g, ''),
    id.replace(/\./g, '-'),
    id.replace(/\./g, '_'),
    id.replace(/\./g, ' '),
  ]).map((item) => item.toLowerCase());
}

function titleTokens(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .slice(0, 5);
}

function courseIdsFromUrl(url) {
  const raw = String(url || '').toLowerCase();
  const ids = [];
  const patterns = [
    /(?:^|[^a-z0-9])(\d{1,2})[._-](\d{2,4}[a-z]?)(?=$|[^a-z0-9])/g,
    /mitx\+(\d{1,2})\.(\d{2,4}[a-z]?)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw))) ids.push(`${match[1]}.${match[2]}`);
  }
  return unique(ids);
}

function allowedCourseIds(seed) {
  return unique([seed.id, ...seed.aliases].map((id) => String(id || '').toLowerCase()));
}

function sourceMatchesSeed(url, seed) {
  const ids = courseIdsFromUrl(url);
  if (!ids.length) return true;
  const allowed = allowedCourseIds(seed);
  return allowed.includes(ids[0]);
}

function canonicalSourceUrl(url) {
  try {
    const parsed = new URL(url);
    const keepCatalogHash = parsed.hostname.includes('student.mit.edu') && parsed.pathname.includes('/catalog/');
    if (!keepCatalogHash) parsed.hash = '';
    parsed.searchParams.delete('activate_block_id');
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');

    if (parsed.hostname.includes('openlearninglibrary.mit.edu')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const courseIndex = parts.indexOf('courses');
      if (courseIndex >= 0 && parts[courseIndex + 1]) {
        parsed.pathname = `/courses/${parts[courseIndex + 1]}/about`;
        parsed.search = '';
      }
    }

    if (parsed.hostname.includes('ocw.mit.edu')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const courseIndex = parts.indexOf('courses');
      const slug = parts.slice(courseIndex + 1).find((part) => /^\d{1,2}-\d{2,4}/.test(part));
      if (courseIndex >= 0 && slug) {
        parsed.pathname = `/courses/${slug}/`;
        parsed.search = '';
      }
    }

    return parsed.toString();
  } catch (error) {
    return String(url || '').trim();
  }
}

function sourceGroupKey(url) {
  const canonical = canonicalSourceUrl(url);
  try {
    const parsed = new URL(canonical);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch (error) {
    return canonical;
  }
}

function classifyDocType(url, text = '') {
  const rawUrl = String(url || '').toLowerCase();
  const rawText = String(text || '').toLowerCase().slice(0, 4000);
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (error) {
    host = '';
  }

  if (host.includes('ocw.mit.edu') || rawUrl.includes('/ocw/')) return 'ocw';
  if (host.includes('web.archive.org') || rawUrl.includes('/catalog/archive/')) return 'archive';
  if (rawUrl.includes('syllabus') || rawText.includes('syllabus')) return 'syllabus';
  if (host.includes('student.mit.edu') || host.includes('catalog.mit.edu') || host.includes('fireroad.mit.edu')) return 'catalog';
  if (rawUrl.endsWith('.pdf')) return 'pdf';
  if (rawText.includes('homework') || rawText.includes('lecture') || rawText.includes('instructor')) return 'homepage';
  return 'homepage';
}

function sourcePriority(source) {
  const typeScore = {
    syllabus: 0,
    homepage: 1,
    ocw: 2,
    archive: 3,
    catalog: 4,
    pdf: 5,
    text: 6,
    html: 7,
    unknown: 8,
  };
  const url = String(source.url || '').toLowerCase();
  const archivePenalty = url.includes('webcache') ? 5 : 0;
  return (typeScore[source.docType] ?? 9) + archivePenalty;
}

function cleanUrl(url, baseUrl = 'https://duckduckgo.com') {
  try {
    const decoded = decodeHtml(url);
    const absolute = decoded.startsWith('//')
      ? `https:${decoded}`
      : decoded.startsWith('/')
        ? new URL(decoded, baseUrl).toString()
        : decoded;
    const parsed = new URL(absolute);
    if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname.startsWith('/l/')) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
    if (parsed.hostname.includes('bing.com') && parsed.pathname.startsWith('/ck/')) {
      const encoded = parsed.searchParams.get('u');
      if (encoded?.startsWith('a1')) {
        const base64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(base64, 'base64').toString('utf8');
      }
    }
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function isLikelyCourseUrl(url, seed) {
  const raw = String(url || '').toLowerCase();
  if (!raw.startsWith('http')) return false;
  if (/\.(png|jpg|jpeg|gif|svg|ico|css|js|zip|pptx?|docx?|xlsx?)(\?|$)/i.test(raw)) return false;

  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (error) {
    return false;
  }

  const trustedHost = host.endsWith('mit.edu') || host.includes('web.archive.org') || host.endsWith('github.io');
  if (!trustedHost || !sourceMatchesSeed(url, seed)) return false;
  if (host.includes('ocw.mit.edu') && !courseIdsFromUrl(url).length) return false;
  const ids = [seed.id, ...seed.aliases].flatMap(courseIdVariants);
  const hasCourseId = ids.some((variant) => raw.includes(variant));
  const titleMatches = titleTokens(seed.title).filter((token) => raw.includes(token)).length;
  return hasCourseId || titleMatches >= 2;
}

function buildSearchQueries(seed, options) {
  const ids = unique([seed.id, ...seed.aliases]);
  const base = ids.flatMap((id) => [
    `"${id}" MIT "${seed.title}" syllabus`,
    `"${id}" MIT "${seed.title}" course homepage`,
    `"${id}" MIT OCW`,
    `"${id}" MIT past offering`,
    `"${id}" site:student.mit.edu/catalog/archive`,
  ]);
  return unique(base).slice(0, options.maxSearchQueries);
}

function seedUrls(seed) {
  return unique([
    seed.url,
    `https://fireroad.mit.edu/courses/lookup/${encodeURIComponent(seed.id)}`,
  ]).map((url) => ({ url, source: 'seed' }));
}

function parseSearchResultUrls(html, baseUrl) {
  const urls = [];
  const hrefPattern = /href="([^"]+)"/gi;
  let match;
  while ((match = hrefPattern.exec(html))) {
    const url = cleanUrl(match[1], baseUrl);
    if (url) urls.push(url);
  }
  return unique(urls);
}

function searchUrlsForQuery(query) {
  const encoded = encodeURIComponent(query);
  return [
    `https://search.mit.edu/search?q=${encoded}`,
    `https://duckduckgo.com/html/?q=${encoded}`,
    `https://www.bing.com/search?q=${encoded}`,
  ];
}

function seedSearchUrls(seed) {
  const ids = unique([seed.id, ...seed.aliases]);
  return ids.flatMap((id) => [
    `https://catalog.mit.edu/search/?P=${encodeURIComponent(id)}`,
    `https://ocw.mit.edu/search/?q=${encodeURIComponent(id)}`,
  ]);
}

function shouldExpandCandidate(candidate) {
  try {
    const parsed = new URL(candidate.url);
    return parsed.hostname.endsWith('mit.edu')
      && !parsed.hostname.includes('student.mit.edu')
      && !parsed.hostname.includes('fireroad.mit.edu')
      && !candidate.url.toLowerCase().endsWith('.pdf');
  } catch (error) {
    return false;
  }
}

async function expandCandidateUrls(seed, candidates, options) {
  const additions = [];
  const expandable = candidates.filter(shouldExpandCandidate).slice(0, 8);

  for (const candidate of expandable) {
    try {
      emitTrace(options, 'search.expand.start', { url: candidate.url });
      const response = await fetchWithTimeout(candidate.url, { timeoutMs: options.requestTimeoutMs });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (!/html/i.test(contentType)) continue;
      const html = await response.text();
      const urls = parseSearchResultUrls(html, candidate.url)
        .filter((url) => isLikelyCourseUrl(url, seed))
        .filter((url) => url !== candidate.url)
        .slice(0, options.maxSearchResultsPerQuery);
      for (const url of urls) {
        additions.push({
          url,
          docType: classifyDocType(url),
          source: 'expanded_source',
          query: candidate.url,
        });
      }
      emitTrace(options, 'search.expand.done', { url: candidate.url, resultCount: urls.length, urls });
    } catch (error) {
      emitTrace(options, 'search.expand.failed', { url: candidate.url, reason: error.message });
    }
  }

  return additions;
}

function normalizeModelQueries(value, fallback, options) {
  const fromModel = Array.isArray(value)
    ? value
    : Array.isArray(value?.queries)
      ? value.queries
      : [];
  return unique([
    ...fromModel.map(compact),
    ...fallback,
  ]).slice(0, options.maxSearchQueries);
}

function normalizeModelCandidateUrls(value) {
  const rawCandidates = Array.isArray(value?.candidate_urls)
    ? value.candidate_urls
    : Array.isArray(value?.candidateUrls)
      ? value.candidateUrls
      : Array.isArray(value?.urls)
        ? value.urls
        : [];
  return rawCandidates.map((candidate) => {
    if (typeof candidate === 'string') return { url: candidate, source: 'model_plan' };
    return {
      url: candidate?.url,
      docType: candidate?.doc_type || candidate?.docType,
      reason: candidate?.reason || null,
      source: 'model_plan',
    };
  }).filter((candidate) => candidate.url);
}

async function buildModelSearchPlan(seed, options) {
  const fallbackQueries = buildSearchQueries(seed, options);
  if (!process.env.OPENROUTER_API_KEY) {
    emitTrace(options, 'model.search_plan.skipped', {
      reason: 'OPENROUTER_API_KEY missing',
      fallbackQueries,
    });
    return { queries: fallbackQueries, candidateUrls: [], status: 'heuristic_no_key' };
  }

  try {
    emitTrace(options, 'model.search_plan.start', {
      model: options.model || DEFAULT_MODEL,
      courseId: seed.id,
      aliases: seed.aliases,
    });
    const result = await chatJson({
      model: options.model || DEFAULT_MODEL,
      temperature: 0,
      maxTokens: 900,
      system: [
        'You are planning online research for MIT course history.',
        'Return only JSON.',
        'Generate web search queries and any high-confidence official URLs to check.',
        'Prefer MIT department pages, OCW, archived MIT pages, syllabi, and catalog archives.',
        'Do not claim that a URL exists unless it is a plausible URL candidate to fetch.',
      ].join(' '),
      user: [
        'Course seed:',
        JSON.stringify({
          id: seed.id,
          title: seed.title,
          aliases: seed.aliases,
          currentCatalogUrl: seed.url,
          currentInstructors: seed.instructors,
        }, null, 2),
        'Return JSON in this shape:',
        JSON.stringify({
          queries: [
            '"6.7201" MIT course syllabus',
            '"6.7201" MIT OCW',
          ],
          candidate_urls: [
            {
              url: 'https://example.mit.edu/course-homepage',
              doc_type: 'homepage',
              reason: 'why this URL is worth fetching',
            },
          ],
        }, null, 2),
      ].join('\n\n'),
    });
    const plan = {
      queries: normalizeModelQueries(result.parsed, fallbackQueries, options),
      candidateUrls: normalizeModelCandidateUrls(result.parsed),
      status: 'model_planned',
    };
    emitTrace(options, 'model.search_plan.done', {
      queries: plan.queries,
      candidateUrls: plan.candidateUrls.map((candidate) => ({
        url: candidate.url,
        docType: candidate.docType,
        reason: candidate.reason,
      })),
    });
    return plan;
  } catch (error) {
    emitTrace(options, 'model.search_plan.failed', {
      reason: error.message,
      fallbackQueries,
    });
    return { queries: fallbackQueries, candidateUrls: [], status: 'model_plan_failed', error };
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_OPTIONS.requestTimeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Fireroad.ai history researcher/0.1',
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWeb(seed, options) {
  const plan = await buildModelSearchPlan(seed, options);
  const candidates = [
    ...seedUrls(seed),
    ...plan.candidateUrls,
  ];
  const queries = plan.queries;

  for (const searchUrl of seedSearchUrls(seed)) {
    try {
      emitTrace(options, 'search.source_page.start', { url: searchUrl });
      const response = await fetchWithTimeout(searchUrl, { timeoutMs: options.requestTimeoutMs });
      if (!response.ok) continue;
      const html = await response.text();
      const urls = parseSearchResultUrls(html, searchUrl)
        .filter((url) => isLikelyCourseUrl(url, seed))
        .slice(0, options.maxSearchResultsPerQuery);
      for (const url of urls) candidates.push({ url, query: searchUrl, source: 'source_search' });
      emitTrace(options, 'search.source_page.done', {
        url: searchUrl,
        resultCount: urls.length,
        urls,
      });
    } catch (error) {
      emitTrace(options, 'search.source_page.failed', { url: searchUrl, reason: error.message });
      // Source-specific search pages are best-effort.
    }
  }

  for (const query of queries) {
    for (const searchUrl of searchUrlsForQuery(query)) {
      try {
        emitTrace(options, 'search.query.start', { query, url: searchUrl });
        const response = await fetchWithTimeout(searchUrl, { timeoutMs: options.requestTimeoutMs });
        if (!response.ok) continue;
        const html = await response.text();
        const urls = parseSearchResultUrls(html, searchUrl)
          .filter((url) => isLikelyCourseUrl(url, seed))
          .slice(0, options.maxSearchResultsPerQuery);
        for (const url of urls) candidates.push({ url, query, source: 'search' });
        emitTrace(options, 'search.query.done', {
          query,
          url: searchUrl,
          resultCount: urls.length,
          urls,
        });
      } catch (error) {
        emitTrace(options, 'search.query.failed', { query, url: searchUrl, reason: error.message });
        // Search is best-effort; seed URLs still give the job something useful to inspect.
      }
    }
  }

  const expanded = await expandCandidateUrls(seed, candidates, options);
  candidates.push(...expanded);

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const url = cleanUrl(candidate.url);
    if (!url || !sourceMatchesSeed(url, seed)) continue;
    const docType = normalizeDocType(candidate.docType || classifyDocType(url));
    const key = sourceGroupKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...candidate, url: canonicalSourceUrl(url), docType });
  }
  emitTrace(options, 'search.candidates.ready', {
    candidateCount: deduped.length,
    candidates: deduped.slice(0, options.maxCandidateUrlsForModel).map((candidate) => ({
      url: candidate.url,
      docType: candidate.docType,
      source: candidate.source,
      query: candidate.query,
    })),
  });

  return selectSourcesWithModel(seed, deduped, options, plan);
}

function fallbackSourceSelection(candidates, options) {
  const seen = new Set();
  return candidates
    .sort((a, b) => sourcePriority(a) - sourcePriority(b))
    .filter((source) => {
      const key = sourceGroupKey(source.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.maxSources)
    .map((source) => ({ ...source, selectedBy: source.selectedBy || 'heuristic' }));
}

function normalizeSelectedSources(parsed) {
  const raw = Array.isArray(parsed?.sources)
    ? parsed.sources
    : Array.isArray(parsed?.selected_sources)
      ? parsed.selected_sources
      : Array.isArray(parsed?.selectedSources)
        ? parsed.selectedSources
        : Array.isArray(parsed?.urls)
          ? parsed.urls
          : [];
  return raw.map((source) => {
    if (typeof source === 'string') return { url: source };
    return {
      index: Number.isFinite(Number(source?.index)) ? Number(source.index) : null,
      url: source?.url,
      docType: source?.doc_type || source?.docType || null,
      reason: source?.reason || null,
    };
  });
}

function mergeTermSpecificSources(seed, candidates, selected, options) {
  const merged = [];
  const seen = new Set();
  const add = (source, selectedBy = source.selectedBy || 'heuristic') => {
    if (!source || !sourceMatchesSeed(source.url, seed)) return;
    const docType = normalizeDocType(source.docType || classifyDocType(source.url));
    const key = sourceGroupKey(source.url);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      ...source,
      url: canonicalSourceUrl(source.url),
      docType,
      selectedBy,
    });
  };

  const termSpecific = candidates
    .filter((source) => isDatedPastTerm(inferTermFromText('', source.url)))
    .sort((a, b) => termRankForUrl(b.url).localeCompare(termRankForUrl(a.url)));

  termSpecific.forEach((source) => add(source, source.selectedBy || 'term_url'));
  selected.forEach((source) => add(source, source.selectedBy));
  return merged.slice(0, options.maxSources);
}

function termRankForUrl(url) {
  const term = inferTermFromText('', url);
  const raw = String(term || '').toUpperCase();
  const match = raw.match(/^(\d{4})(FA|SP|SU|IAP)$/);
  if (!match) return '000000';
  const order = { IAP: 1, SP: 2, SU: 3, FA: 4 };
  return `${match[1]}${String(order[match[2]] || 0).padStart(2, '0')}`;
}

async function selectSourcesWithModel(seed, candidates, options, plan) {
  const fallback = fallbackSourceSelection(candidates, options);
  if (!process.env.OPENROUTER_API_KEY || candidates.length <= 1) {
    const selected = mergeTermSpecificSources(seed, candidates, fallback, options);
    emitTrace(options, 'model.source_select.skipped', {
      reason: !process.env.OPENROUTER_API_KEY ? 'OPENROUTER_API_KEY missing' : 'not enough candidates',
      selectedCount: selected.length,
      selected: selected.map((source) => ({ url: source.url, docType: source.docType })),
    });
    return selected;
  }

  const compactCandidates = candidates.slice(0, options.maxCandidateUrlsForModel).map((candidate, index) => ({
    index,
    url: candidate.url,
    docType: candidate.docType,
    source: candidate.source,
    query: candidate.query,
    reason: candidate.reason,
  }));

  try {
    emitTrace(options, 'model.source_select.start', {
      model: options.model || DEFAULT_MODEL,
      candidateCount: compactCandidates.length,
    });
    const result = await chatJson({
      model: options.model || DEFAULT_MODEL,
      temperature: 0,
      maxTokens: 1200,
      system: [
        'You are selecting online sources for MIT course history research.',
        'Return only JSON.',
        'Select exact URLs from the candidate list that are worth fetching.',
        'Prefer offering-specific syllabi, course homepages, OCW pages, MIT catalog archive pages, and web.archive.org snapshots.',
        'Reject search pages, generic navigation pages, assets, unrelated pages, and pages that do not plausibly describe this course.',
        'The first-level history object will be term/offering, so choose sources likely to identify a semester or historical offering.',
      ].join(' '),
      user: [
        'Course seed:',
        JSON.stringify({
          id: seed.id,
          title: seed.title,
          aliases: seed.aliases,
        }, null, 2),
        `Search plan status: ${plan.status}`,
        'Candidate URLs:',
        JSON.stringify(compactCandidates, null, 2),
        'Return JSON in this shape:',
        JSON.stringify({
          sources: [
            {
              index: 0,
              url: 'exact candidate URL',
              doc_type: 'syllabus|homepage|archive|ocw|catalog|pdf|unknown',
              reason: 'why this should be fetched',
            },
          ],
        }, null, 2),
      ].join('\n\n'),
    });

    const selected = [];
    const seen = new Set();
    for (const item of normalizeSelectedSources(result.parsed)) {
      const byIndex = item.index !== null ? compactCandidates[item.index] : null;
      const byUrl = item.url ? candidates.find((candidate) => cleanUrl(candidate.url) === cleanUrl(item.url)) : null;
      const original = byIndex ? candidates[byIndex.index] : byUrl;
      if (!original || !sourceMatchesSeed(original.url, seed)) continue;
      const docType = normalizeDocType(item.docType || original.docType);
      const key = sourceGroupKey(original.url);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({
        ...original,
        url: canonicalSourceUrl(original.url),
        docType,
        reason: item.reason || original.reason || null,
        selectedBy: 'model',
      });
      if (selected.length >= options.maxSources) break;
    }

    const finalSelection = mergeTermSpecificSources(seed, candidates, selected.length ? selected : fallback, options);
    emitTrace(options, 'model.source_select.done', {
      selectedCount: finalSelection.length,
      selected: finalSelection.map((source) => ({
        url: source.url,
        docType: source.docType,
        reason: source.reason,
        selectedBy: source.selectedBy,
      })),
    });
    return finalSelection;
  } catch (error) {
    emitTrace(options, 'model.source_select.failed', {
      reason: error.message,
      fallbackCount: fallback.length,
    });
    return fallback;
  }
}

async function readResponseBuffer(response, options) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > options.maxSourceBytes) {
    throw new Error(`source is too large (${contentLength} bytes)`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > options.maxSourceBytes) {
    throw new Error(`source is too large (${buffer.length} bytes)`);
  }
  return buffer;
}

async function fetchSource(source, options) {
  const response = await fetchWithTimeout(source.url, { timeoutMs: options.requestTimeoutMs });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || 'unknown';
  const buffer = await readResponseBuffer(response, options);
  const text = buffer.toString('utf8');
  const isPdf = /pdf/i.test(contentType) || /\.pdf($|\?)/i.test(source.url);
  const isHtml = /html/i.test(contentType) || /<html[\s>]/i.test(text);
  const isText = /^text\//i.test(contentType) || /json|xml|javascript/i.test(contentType);

  let rawText = null;
  let rawHtml = null;
  if (isPdf && pdfParse) {
    const parsed = await pdfParse(buffer);
    rawText = compact(parsed.text);
  } else if (isHtml) {
    rawHtml = text;
    rawText = htmlToText(text);
  } else if (isText) {
    rawText = compact(text);
  }

  return {
    contentType,
    checksum: checksum(buffer),
    rawHtml,
    rawText,
    docType: classifyDocType(source.url, rawText || text),
    finalUrl: response.url || source.url,
  };
}

function inferTermFromText(text, url = '') {
  const haystack = `${url} ${String(text || '').slice(0, 12000)}`;
  const patterns = [
    /\b(20\d{2})\s*(FA|FALL|SP|SPRING|SU|SUMMER|IAP)\b/i,
    /\b(FA|FALL|SP|SPRING|SU|SUMMER|IAP)\s*[-_ ]?\s*(20\d{2})\b/i,
    /\b(20\d{2})[-_/](fall|spring|summer|iap)\b/i,
    /\b(fall|spring|summer|iap)[-_/](20\d{2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (!match) continue;
    const firstIsYear = /^20\d{2}$/.test(match[1]);
    const year = firstIsYear ? match[1] : match[2];
    const season = firstIsYear ? match[2] : match[1];
    return normalizeTerm(`${year}${season}`);
  }
  return 'UNKNOWN';
}

function heuristicSourceSummary(source, fetched) {
  const host = (() => {
    try {
      return new URL(source.url).hostname;
    } catch (error) {
      return 'unknown host';
    }
  })();
  const text = compact(fetched.rawText || '').slice(0, 220);
  if (text) return `${source.docType || fetched.docType || 'source'} from ${host}: ${text}`;
  return `${source.docType || fetched.docType || 'source'} from ${host}; no readable text was available.`;
}

function heuristicParsed(seed, source, fetched) {
  const term = inferTermFromText(fetched.rawText, source.url);
  const sourceSummary = heuristicSourceSummary(source, fetched);
  return {
    source_type: source.docType || fetched.docType || 'unknown',
    source_summary: sourceSummary,
    offerings: [
      {
        term,
        title_snapshot: seed.title,
        instructor_text: seed.instructors.join(', ') || null,
        offering_summary: null,
        attendance: {
          attendance_required: 'unknown',
          attendance_counts_toward_grade: 'unknown',
          attendance_notes: null,
          evidence_text: null,
          confidence: null,
        },
        grading: {
          letter_grade: 'unknown',
          has_participation_component: 'unknown',
          participation_weight: null,
          homework_weight: null,
          project_weight: null,
          lab_weight: null,
          quiz_weight: null,
          midterm_weight: null,
          final_weight: null,
          drop_lowest_rule_text: null,
          late_policy_text: null,
          collaboration_policy_text: null,
          grading_notes: null,
          evidence_text: null,
          confidence: null,
        },
      },
    ],
  };
}

function sourcePrompt(seed, source, fetched, options) {
  const sourceText = relevantSourceText(seed, fetched.rawText, options.maxTextForModel);
  return {
    system: [
      'You research MIT course history sources.',
      'Return only JSON.',
      'The top-level navigation object is an offering/term, not a source.',
      'Use term codes like 2024FA, 2024SP, 2024SU, or 2024IAP. If the source does not identify a term, use "unknown".',
      'Do not invent instructors, attendance, grading, or terms.',
      'If the source primarily describes a different course number than the seed or aliases, return an empty offerings array.',
      'If the source does not identify a dated past offering, return an empty offerings array.',
      'Use "yes", "no", or "unknown"; keep unknown distinct from no.',
      'Only extract attendance or grading when the source explicitly says it, and include a short evidence_text snippet.',
      'For every offering, write offering_markdown yourself as concise student-facing Markdown.',
      'Do not dump evidence snippets into offering_markdown.',
      'Use exactly these bold labels in offering_markdown: **Course Format:**, **Attendance Policy:**, **Grading Policy:**.',
      'If attendance or grading is not specified, say "Not specified in the available source."',
      'When writing percentages, use normal percentages like 10%, not decimal fractions like 0.1%.',
      'offering_summary is a one-sentence fallback; offering_markdown is the primary display copy.',
    ].join(' '),
    user: [
      `Course seed:\n${JSON.stringify({
        id: seed.id,
        title: seed.title,
        aliases: seed.aliases,
        allowedCourseIds: allowedCourseIds(seed),
        currentInstructors: seed.instructors,
      }, null, 2)}`,
      `Source URL: ${source.url}`,
      `Source type guess: ${source.docType || fetched.docType || 'unknown'}`,
      `Content type: ${fetched.contentType}`,
      'Return this JSON shape:',
      JSON.stringify({
        source_type: 'syllabus|homepage|archive|ocw|catalog|pdf|unknown',
        source_summary: 'one short source-level summary',
        offerings: [
          {
            term: '2024FA or unknown',
            title_snapshot: 'course title if present',
            instructor_text: 'comma-separated instructors if present',
            offering_summary: 'one concise student-facing sentence about how this offering was taught',
            offering_markdown: '**Course Format:** concise paragraph.\n\n**Attendance Policy:** concise sentence.\n\n**Grading Policy:** concise sentence.',
            attendance: {
              attendance_required: 'yes|no|unknown',
              attendance_counts_toward_grade: 'yes|no|unknown',
              attendance_notes: 'short note or null',
              evidence_text: 'short exact or near-exact snippet or null',
              confidence: 0.8,
            },
            grading: {
              letter_grade: 'yes|no|unknown',
              has_participation_component: 'yes|no|unknown',
              participation_weight: null,
              homework_weight: null,
              project_weight: null,
              lab_weight: null,
              quiz_weight: null,
              midterm_weight: null,
              final_weight: null,
              drop_lowest_rule_text: null,
              late_policy_text: null,
              collaboration_policy_text: null,
              grading_notes: 'short note or null',
              evidence_text: 'short exact or near-exact snippet or null',
              confidence: 0.8,
            },
          },
        ],
      }, null, 2),
      `Source text:\n${sourceText}`,
    ].join('\n\n'),
  };
}

function relevantSourceText(seed, text, maxLength) {
  const raw = String(text || '');
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const needles = unique([
    seed.id,
    seed.id.replace(/\./g, ''),
    seed.title,
    ...seed.aliases,
  ].map((value) => String(value || '').toLowerCase()).filter(Boolean));
  const positions = needles
    .map((needle) => lower.indexOf(needle))
    .filter((position) => position >= 0);
  if (!positions.length) return raw.slice(0, maxLength);
  const start = Math.max(0, Math.min(...positions) - 2000);
  return raw.slice(start, start + maxLength);
}

async function extractSourceResearch(seed, source, fetched, options) {
  const fallback = heuristicParsed(seed, source, fetched);
  if (!fetched.rawText) {
    emitTrace(options, 'model.source_extract.skipped', {
      url: source.url,
      docType: source.docType,
      reason: 'no readable text',
    });
    return {
      parsed: fallback,
      runStatus: 'skipped_no_text',
      parsedJson: JSON.stringify(fallback),
      rawModelOutput: null,
      model: DEFAULT_MODEL,
      error: null,
    };
  }

  if (!process.env.OPENROUTER_API_KEY) {
    emitTrace(options, 'model.source_extract.skipped', {
      url: source.url,
      docType: source.docType,
      reason: 'OPENROUTER_API_KEY missing',
      heuristicTerms: fallback.offerings.map((offering) => offering.term),
    });
    return {
      parsed: fallback,
      runStatus: 'heuristic_no_key',
      parsedJson: JSON.stringify(fallback),
      rawModelOutput: null,
      model: DEFAULT_MODEL,
      error: null,
    };
  }

  try {
    emitTrace(options, 'model.source_extract.start', {
      model: options.model || DEFAULT_MODEL,
      url: source.url,
      docType: source.docType,
      textChars: String(fetched.rawText || '').length,
    });
    const prompt = sourcePrompt(seed, source, fetched, options);
    const result = await chatJson({
      system: prompt.system,
      user: prompt.user,
      model: options.model || DEFAULT_MODEL,
      maxTokens: 1700,
      temperature: 0,
    });
    const parsed = normalizeParsedResearch(result.parsed, fallback, source, fetched);
    emitTrace(options, 'model.source_extract.done', {
      url: source.url,
      docType: parsed.source_type,
      sourceSummary: parsed.source_summary,
      offerings: parsed.offerings.map((offering) => ({
        term: offering.term,
        instructorText: offering.instructor_text,
        offeringSummary: offering.offering_summary,
        hasAttendanceEvidence: Boolean(offering.attendance?.evidence_text),
        hasGradingEvidence: Boolean(offering.grading?.evidence_text),
      })),
    });
    return {
      parsed,
      runStatus: 'succeeded',
      parsedJson: JSON.stringify(parsed),
      rawModelOutput: result.rawModelOutput,
      model: result.model,
      error: null,
    };
  } catch (error) {
    emitTrace(options, 'model.source_extract.failed', {
      url: source.url,
      docType: source.docType,
      reason: error.message,
    });
    return {
      parsed: fallback,
      runStatus: 'failed',
      parsedJson: null,
      rawModelOutput: error.rawModelOutput || null,
      model: options.model || DEFAULT_MODEL,
      error,
    };
  }
}

function cleanTriState(value) {
  const raw = String(value || 'unknown').trim().toLowerCase();
  if (['yes', 'required', 'true', 'y'].includes(raw)) return 'yes';
  if (['no', 'not_required', 'not required', 'false', 'n'].includes(raw)) return 'no';
  return 'unknown';
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function normalizeParsedResearch(parsed, fallback, source, fetched) {
  const safe = parsed && typeof parsed === 'object' ? parsed : {};
  const sourceType = normalizeDocType(safe.source_type || source.docType || fetched.docType || fallback.source_type || 'unknown');
  const sourceSummary = compact(safe.source_summary || safe.sourceSummary || fallback.source_summary);
  const rawOfferings = Array.isArray(safe.offerings) ? safe.offerings : fallback.offerings;
  return {
    source_type: sourceType,
    source_summary: sourceSummary,
    offerings: rawOfferings.map((offering) => normalizeParsedOffering(
      offering,
      fallback.offerings[0],
      `${sourceSummary} ${source.url}`,
    )),
  };
}

function normalizeParsedOffering(offering, fallback, contextText = '') {
  const safe = offering && typeof offering === 'object' ? offering : {};
  const contextTerm = inferTermFromText([
    contextText,
    safe.offering_summary || safe.offeringSummary,
    safe.title_snapshot || safe.titleSnapshot,
  ].join(' '));
  const safeTerm = String(safe.term || '').toLowerCase() === 'unknown' ? '' : safe.term;
  const fallbackTerm = String(fallback.term || '').toLowerCase() === 'unknown' ? '' : fallback.term;
  const termRaw = safeTerm || (contextTerm === 'UNKNOWN' ? '' : contextTerm) || fallbackTerm || 'unknown';
  const term = String(termRaw).toLowerCase() === 'unknown' ? 'UNKNOWN' : normalizeTerm(String(termRaw).replace(/[-_]/g, ' '));
  return {
    term: term || 'UNKNOWN',
    title_snapshot: compact(safe.title_snapshot || safe.titleSnapshot || fallback.title_snapshot) || null,
    instructor_text: compact(safe.instructor_text || safe.instructorText || list(safe.instructors).join(', ') || fallback.instructor_text) || null,
    offering_summary: compact(safe.offering_summary || safe.offeringSummary || fallback.offering_summary) || null,
    offering_markdown: normalizeOfferingMarkdown(safe.offering_markdown || safe.offeringMarkdown || safe.markdown || null),
    attendance: normalizeAttendance(safe.attendance || fallback.attendance || {}),
    grading: normalizeGrading(safe.grading || fallback.grading || {}),
  };
}

function normalizeOfferingMarkdown(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return null;
  const requiredLabels = ['**Course Format:**', '**Attendance Policy:**', '**Grading Policy:**'];
  if (requiredLabels.every((label) => text.includes(label))) return text;
  return text
    .replace(/^Course Format:/gim, '**Course Format:**')
    .replace(/^Attendance Policy:/gim, '**Attendance Policy:**')
    .replace(/^Grading Policy:/gim, '**Grading Policy:**');
}

function normalizeAttendance(attendance) {
  return {
    attendance_required: cleanTriState(attendance.attendance_required ?? attendance.attendanceRequired),
    attendance_counts_toward_grade: cleanTriState(attendance.attendance_counts_toward_grade ?? attendance.attendanceCountsTowardGrade),
    attendance_notes: compact(attendance.attendance_notes || attendance.attendanceNotes) || null,
    evidence_text: compact(attendance.evidence_text || attendance.evidenceText) || null,
    confidence: num(attendance.confidence),
  };
}

function normalizeGrading(grading) {
  return {
    letter_grade: cleanTriState(grading.letter_grade ?? grading.letterGrade),
    has_participation_component: cleanTriState(grading.has_participation_component ?? grading.hasParticipationComponent),
    participation_weight: num(grading.participation_weight ?? grading.participationWeight),
    homework_weight: num(grading.homework_weight ?? grading.homeworkWeight),
    project_weight: num(grading.project_weight ?? grading.projectWeight),
    lab_weight: num(grading.lab_weight ?? grading.labWeight),
    quiz_weight: num(grading.quiz_weight ?? grading.quizWeight),
    midterm_weight: num(grading.midterm_weight ?? grading.midtermWeight),
    final_weight: num(grading.final_weight ?? grading.finalWeight),
    drop_lowest_rule_text: compact(grading.drop_lowest_rule_text || grading.dropLowestRuleText) || null,
    late_policy_text: compact(grading.late_policy_text || grading.latePolicyText) || null,
    collaboration_policy_text: compact(grading.collaboration_policy_text || grading.collaborationPolicyText) || null,
    grading_notes: compact(grading.grading_notes || grading.gradingNotes) || null,
    evidence_text: compact(grading.evidence_text || grading.evidenceText) || null,
    confidence: num(grading.confidence),
  };
}

function markdownQualityScore(markdown) {
  const text = String(markdown || '').trim();
  if (!text) return 0;
  const lower = text.toLowerCase();
  const labels = ['**course format:**', '**attendance policy:**', '**grading policy:**']
    .filter((label) => lower.includes(label)).length;
  const specifiedPolicies = ['**attendance policy:**', '**grading policy:**']
    .filter((label) => {
      const index = lower.indexOf(label);
      if (index < 0) return false;
      const next = lower.indexOf('**', index + label.length);
      const section = lower.slice(index + label.length, next < 0 ? undefined : next);
      return section && !section.includes('not specified in the available source');
    }).length;
  return labels * 100 + specifiedPolicies * 75 + Math.min(text.length, 900) / 10;
}

function chooseOfferingNotes(existingNotes, candidateMarkdown, candidateSummary) {
  if (candidateMarkdown) {
    return markdownQualityScore(candidateMarkdown) >= markdownQualityScore(existingNotes)
      ? candidateMarkdown
      : existingNotes;
  }
  return existingNotes || candidateSummary || null;
}

function policyHasEvidence(policy) {
  return Boolean(policy && policy.evidence_text);
}

function attendanceHasSignal(attendance) {
  return attendance.attendance_required !== 'unknown'
    || attendance.attendance_counts_toward_grade !== 'unknown'
    || Boolean(attendance.attendance_notes);
}

function gradingHasSignal(grading) {
  return grading.letter_grade !== 'unknown'
    || grading.has_participation_component !== 'unknown'
    || [
      grading.participation_weight,
      grading.homework_weight,
      grading.project_weight,
      grading.lab_weight,
      grading.quiz_weight,
      grading.midterm_weight,
      grading.final_weight,
    ].some((value) => value !== null)
    || Boolean(grading.drop_lowest_rule_text || grading.late_policy_text || grading.collaboration_policy_text || grading.grading_notes);
}

function urlFieldsForSource(source, fetched, parsed) {
  const type = normalizeDocType(parsed.source_type || fetched.docType || source.docType);
  return {
    homepageUrl: type === 'homepage' ? source.url : null,
    syllabusUrl: type === 'syllabus' ? source.url : null,
    ocwUrl: type === 'ocw' ? source.url : null,
    hasHomepage: type === 'homepage',
  };
}

function upsertMergedOffering(repo, seed, parsedOffering, urlFields) {
  const existing = repo.getOfferingByCourseTerm(seed.id, parsedOffering.term);
  const merged = {
    courseId: seed.id,
    term: parsedOffering.term,
    titleSnapshot: parsedOffering.title_snapshot || existing?.titleSnapshot || seed.title,
    unitsSnapshot: existing?.unitsSnapshot || seed.units || null,
    instructorText: parsedOffering.instructor_text || existing?.instructorText || seed.instructors.join(', ') || null,
    homepageUrl: urlFields.homepageUrl || existing?.homepageUrl || null,
    syllabusUrl: urlFields.syllabusUrl || existing?.syllabusUrl || null,
    ocwUrl: urlFields.ocwUrl || existing?.ocwUrl || null,
    hasHomepage: Boolean(urlFields.homepageUrl || existing?.homepageUrl),
    notes: chooseOfferingNotes(existing?.notes, parsedOffering.offering_markdown, parsedOffering.offering_summary),
  };
  return repo.upsertOffering(merged);
}

function createPolicies(repo, offering, document, parsedOffering) {
  const created = {};
  const attendance = parsedOffering.attendance || {};
  if (policyHasEvidence(attendance) && attendanceHasSignal(attendance)) {
    created.attendancePolicy = repo.createAttendancePolicy({
      offeringId: offering.id,
      attendanceRequired: attendance.attendance_required,
      attendanceCountsTowardGrade: attendance.attendance_counts_toward_grade,
      attendanceNotes: attendance.attendance_notes,
      evidenceDocumentId: document.id,
      evidenceText: attendance.evidence_text,
      confidence: attendance.confidence,
      reviewStatus: 'auto',
    });
  }

  const grading = parsedOffering.grading || {};
  if (policyHasEvidence(grading) && gradingHasSignal(grading)) {
    created.gradingPolicy = repo.createGradingPolicy({
      offeringId: offering.id,
      letterGrade: grading.letter_grade,
      hasParticipationComponent: grading.has_participation_component,
      participationWeight: grading.participation_weight,
      homeworkWeight: grading.homework_weight,
      projectWeight: grading.project_weight,
      labWeight: grading.lab_weight,
      quizWeight: grading.quiz_weight,
      midtermWeight: grading.midterm_weight,
      finalWeight: grading.final_weight,
      dropLowestRuleText: grading.drop_lowest_rule_text,
      latePolicyText: grading.late_policy_text,
      collaborationPolicyText: grading.collaboration_policy_text,
      gradingNotes: grading.grading_notes,
      evidenceDocumentId: document.id,
      evidenceText: grading.evidence_text,
      confidence: grading.confidence,
      reviewStatus: 'auto',
    });
  }

  return created;
}

function writeCourseSeed(repo, seed) {
  const course = repo.upsertCourse({
    id: seed.id,
    currentTitle: seed.title,
    department: seed.department,
    area: seed.area,
    currentUnits: seed.units,
    currentDesc: seed.description,
  });
  const aliases = seed.aliases.map((aliasId) => repo.upsertAlias({
    aliasId,
    courseId: seed.id,
    source: 'research_seed',
  })).filter(Boolean);
  return { course, aliases };
}

function buildCourseResult(repo, courseId) {
  const course = repo.getCourseById(courseId);
  const aliases = repo.getCourseAliases(courseId);
  const offerings = repo.listCourseOfferings(courseId).map((offering) => buildOfferingSummary(
    offering,
    repo.listOfferingDocuments(offering.id),
    repo.getLatestAttendancePolicy(offering.id),
    repo.getLatestGradingPolicy(offering.id),
    { aliases },
  )).filter((offering) => offering.includeInPastOfferings !== false);
  return {
    course,
    aliases,
    summary: buildCourseHistorySummary(course, aliases, offerings),
    offerings,
  };
}

async function researchCourseHistory(courseId, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const trace = createTrace(settings);
  settings.trace = trace;
  const db = settings.db || getDb();
  initDb(db);
  const repo = settings.repo || createHistoryRepo(db);
  const seed = buildCourseSeed(courseId);
  if (!seed.id) throw new Error('Usage: history research requires a course id, e.g. 6.7201');

  emitTrace(settings, 'job.start', {
    courseId: seed.id,
    title: seed.title,
    aliases: seed.aliases,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    reset: Boolean(settings.reset),
  });
  if (settings.reset) {
    repo.deleteCourseHistory(seed.id);
    emitTrace(settings, 'db.reset_course', { courseId: seed.id });
  }
  writeCourseSeed(repo, seed);
  const discoveredSources = await searchWeb(seed, settings);
  const insertedDocuments = [];
  const skippedDocuments = [];
  const extractionRuns = [];
  const policies = [];
  const failedSources = [];

  for (const source of discoveredSources) {
    let fetched;
    try {
      emitTrace(settings, 'source.fetch.start', {
        url: source.url,
        docType: source.docType,
        selectedBy: source.selectedBy,
      });
      fetched = await fetchSource(source, settings);
      emitTrace(settings, 'source.fetch.done', {
        url: source.url,
        finalUrl: fetched.finalUrl,
        docType: fetched.docType,
        contentType: fetched.contentType,
        textChars: String(fetched.rawText || '').length,
      });
    } catch (error) {
      failedSources.push({ url: source.url, docType: source.docType, reason: error.message });
      emitTrace(settings, 'source.fetch.failed', {
        url: source.url,
        docType: source.docType,
        reason: error.message,
      });
      continue;
    }

    if (!sourceMatchesSeed(fetched.finalUrl || source.url, seed)) {
      skippedDocuments.push({ url: source.url, reason: 'final URL appears to describe another course' });
      emitTrace(settings, 'source.fetch.skipped', {
        url: source.url,
        finalUrl: fetched.finalUrl,
        reason: 'final URL appears to describe another course',
      });
      continue;
    }

    const sourceWithType = {
      ...source,
      url: canonicalSourceUrl(fetched.finalUrl || source.url),
      docType: normalizeDocType(fetched.docType || source.docType),
    };
    const extraction = await extractSourceResearch(seed, sourceWithType, fetched, settings);
    const parsed = extraction.parsed;
    const urlFields = urlFieldsForSource(sourceWithType, fetched, parsed);

    for (const parsedOffering of parsed.offerings || []) {
      if (!isDatedPastTerm(parsedOffering.term)) {
        skippedDocuments.push({
          url: sourceWithType.url,
          term: parsedOffering.term,
          reason: 'not a dated past offering',
        });
        emitTrace(settings, 'db.write.offering_skipped', {
          url: sourceWithType.url,
          term: parsedOffering.term,
          reason: 'not a dated past offering',
        });
        continue;
      }

      const offering = upsertMergedOffering(repo, seed, parsedOffering, urlFields);
      const existingDocument = repo.getOfferingDocumentByChecksum(offering.id, fetched.checksum);
      const document = existingDocument || repo.createDocument({
        offeringId: offering.id,
        docType: parsed.source_type || sourceWithType.docType,
        url: sourceWithType.url,
        archivedUrl: sourceWithType.url.includes('web.archive.org') ? sourceWithType.url : null,
        fetchedAt: new Date().toISOString(),
        contentType: fetched.contentType,
        checksum: fetched.checksum,
        rawHtml: fetched.rawHtml,
        rawText: fetched.rawText,
      });

      if (existingDocument) {
        skippedDocuments.push({ offeringId: offering.id, documentId: document.id, url: sourceWithType.url, reason: 'duplicate checksum' });
      } else {
        insertedDocuments.push(document);
      }

      const run = repo.createExtractionRun({
        documentId: document.id,
        model: extraction.model,
        promptVersion: PROMPT_VERSION,
        rawModelOutput: extraction.rawModelOutput,
        parsedJson: extraction.parsedJson,
        status: extraction.runStatus,
      });
      extractionRuns.push({
        id: run.id,
        documentId: document.id,
        status: extraction.runStatus,
        error: extraction.error?.message || null,
      });

      if (extraction.runStatus !== 'failed') {
        const createdPolicies = createPolicies(repo, offering, document, parsedOffering);
        if (createdPolicies.attendancePolicy || createdPolicies.gradingPolicy) {
          policies.push({
            offeringId: offering.id,
            documentId: document.id,
            attendancePolicyId: createdPolicies.attendancePolicy?.id || null,
            gradingPolicyId: createdPolicies.gradingPolicy?.id || null,
          });
        }
      }
      emitTrace(settings, 'db.write.source_done', {
        offeringId: offering.id,
        term: offering.term,
        documentId: document.id,
        extractionStatus: extraction.runStatus,
        insertedDocument: !existingDocument,
      });
    }
  }

  const history = buildCourseResult(repo, seed.id);
  emitTrace(settings, 'job.done', {
    courseId: seed.id,
    discoveredSources: discoveredSources.length,
    insertedDocuments: insertedDocuments.length,
    skippedDocuments: skippedDocuments.length,
    failedSources: failedSources.length,
    extractionRuns: extractionRuns.length,
    policies: policies.length,
    offeringCount: history.summary.offeringCount,
  });

  return {
    dbPath: DB_PATH,
    courseId: seed.id,
    seed: {
      id: seed.id,
      title: seed.title,
      aliases: seed.aliases,
      url: seed.url,
    },
    discoveredSources,
    insertedDocuments,
    skippedDocuments,
    failedSources,
    extractionRuns,
    policies,
    researchTrace: trace.events,
    history,
  };
}

module.exports = {
  buildCourseSeed,
  researchCourseHistory,
};
