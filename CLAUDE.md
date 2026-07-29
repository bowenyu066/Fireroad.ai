# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

There is no frontend build step. The app is served by a small Node/Express backend that also exposes the OpenRouter-backed chat API and the local history database routes.

```bash
npm install
export OPENROUTER_API_KEY="your_openrouter_key"
# Optional:
export OPENROUTER_MODEL="openai/gpt-4.1-mini"
export OPENROUTER_TIMEOUT_MS=120000
# Optional local demo fallback when data/courses.json cannot load:
export DEMO_MODE=true
npm run dev
```

Open http://localhost:3000. `npm run dev` initializes/seeds the local history database before starting the server.

The frontend still uses React 18, ReactDOM, and Babel standalone from CDN via `<script>` tags in `index.html`; JSX is transpiled at runtime by Babel.

## Product Priority

The current product focus is active-semester planning. Treat `fourYearPlan[activeSem]` as the single editable schedule and the primary surface for recommendations, workload checks, requirement summaries, and chat-driven add/remove proposals.

Keep `fourYearPlan` and `activeSem` as the canonical frontend/persistence state because they preserve term-aware data. Do not add cross-semester drag/drop flows unless explicitly requested. `FourYearPlan` is kept only as a legacy read-only component export for future display work and should not be mounted from the main planner.

The active term selector is generated in `data.js` from the current date, using a Hydrant-like rolling default while still allowing manual term selection. Do not hardcode `S25` or other stale semester defaults in UI state.

## Architecture

**No bundler. No frontend build.** All browser JavaScript files are loaded as ordered `<script>` tags in `index.html`:

1. `data.js` — mock data layer, exposed as `window.FRDATA`
2. `components/shared.jsx` — design system primitives (`Icon`, `Logo`, `MatchBar`, `AreaDot`, `ThemeToggle`, `TopBar`) and the `AppCtx` React context; all exported to `window`
3. `components/onboarding.jsx` — 3-step onboarding flow
4. `components/schedule.jsx` — `SchedulePanel`, `CalendarView`; also exports a legacy read-only `FourYearPlan` interface that is not mounted in the main app
5. `components/agent.jsx` — `AgentPanel` (chat), `Recommendations` panel
6. `components/course-detail.jsx` — `CourseDetailShell`, `CurrentCourseView`, `HistoricalCourseView`
7. `components/profile.jsx` — editable profile page (`ProfilePage`); reads/writes `profile` from `AppCtx`
8. `app.jsx` — root `App` component and `Planner` layout; renders into `#root`

**Load order matters.** Each file uses `/* global ... */` comments to declare its dependencies from earlier scripts, and exports its own components to `window` at the bottom (e.g., `window.AgentPanel = AgentPanel`). Never reorder the script tags.

## State and Routing

- **Global state** lives in `App` via `useState`: `theme`, `route`, `profile`, `fourYearPlan`, `activeSem`, `messages`
- **Schedule** is the active semester array at `fourYearPlan[activeSem]`; agent mutations target only that active array.
- **Routing** is a plain object `{ name: 'onboarding' | 'planner' | 'course', id? }` stored in `route` state — no router library
- **Context** (`AppCtx`) provides `theme`, `setTheme`, `route`, `setRoute`, `profile`, `setProfile`, `fourYearPlan`, `setFourYearPlan`, `activeSem`, `setActiveSem`, and `planningTermLabel` to components via `useApp()`
- Theme is persisted to `localStorage` under the key `fr-theme`

## Data Layer (`FRDATA`)

`window.FRDATA` (defined in `data.js`) is now a browser adapter and seed layer. Current course data should come from `/api/current`, which reads and normalizes the local snapshot at `data/courses.json`:

- `FRDATA.catalog` — array of course objects with `id`, `name`, `units`, `schedule`, `days`, `time`, `satisfies`, `prereqs`, `hydrant`, `rating`, `topics`, `area`
- `FRDATA.profile` — mock student profile (taken courses, preferences, calibration, remaining requirements)
- `FRDATA.matchScores` — legacy mock/demo match score breakdowns. Do not expose these through current catalog or agent tool summaries as real current/personalized scores.
- `FRDATA.fourYearPlan`, `FRDATA.semesterLabels`, `FRDATA.semesterOrder`, `FRDATA.defaultActiveSem` — term-aware seed plan data; the editable schedule is `fourYearPlan[activeSem]`
- `FRDATA.termOptions` — rolling term picker options generated from the current date
- `FRDATA.fetchCurrentCourse(id)` / `FRDATA.fetchCurrentSearch(query, maxResults, filters)` / `FRDATA.fetchCurrentCatalog()` — server-backed current catalog helpers. Search filters support `semester`, `includeUnavailable`, `departments`, `requirements`, `areas`, and `maxWorkload`. Do not silently fall back to mock data when these APIs fail.
- `FRDATA.getCourse(id)` / `FRDATA.getMatch(id)` — legacy fallback lookup helpers for demo UI only

The planner's manual course search path must call `FRDATA.fetchCurrentSearch(...)` and treat `/api/current/search` as the primary source. It should pass the selected `activeSem` (or four-year-plan picker term), default to courses offered in that term, and require an explicit `includeUnavailable` toggle to show other terms. Cache current search results for schedule/detail display, but do not reintroduce mock catalog filtering as the main user path. Real current rows must never inherit mock course facts.

Course `area` is computed from course ID prefix: `6.` → `cs`, `18.` → `math`, `8.` → `physics`, `7.` → `bio`, HASS-prefix numbers → `hass`.

### Reference Data Files

- `data/reqs.json` — index of all MIT programs (majors, minors, MEng, NEET tracks, GIRs) keyed by Fireroad requirement ID (e.g. `major6-3`, `minor6`, `girs`). Used as the source list for requirement fetching.
- `data/requirements/` — individual `.reql` requirement files fetched from `https://fireroad.mit.edu/catalogs/requirements/{key}.reql` for every key in `reqs.json`. Generated by `fireroad_fetch.py` (root-level exploration script, separate from `scripts/fetch_courses.py`).
- `data/most_taken.json` — parsed EECSIS "Who's Taken What" data: top-5 most-taken courses per EECS major (`6-1` through `6-14`) per year (`Y1`–`Y4`), each entry as `[courseId, count]`. Source HTML is `data/EECSIS Who's Taken What.html`.
- `data/special_subjects.json` — EECS special-subjects overlay (course numbers with an `S` after the dot, e.g. `6.S062`). Full Fireroad course records for special subjects offered this term, with real per-term topic names merged in. Generated by `scripts/fetch_special_subjects.py`; merged into the live catalog by `server/current/fireroad.js` (overlay records win by id). Override path with `SPECIAL_SUBJECTS_PATH`.
- `data/special_subject_names.json` — small hand-maintained map of `{ "6.S062": "Topic title" }`. The Fireroad API only returns a generic placeholder title for special subjects, so the specific per-term topic is curated here (updated once per semester, then the script is re-run). Can be grown from a saved copy of the EECS subject-updates page via `--page`.
- `data/substitutions.json` — curated advisory examples for course-substitution petitions. Judgment-call petitions are NOT official same-course equivalences and never auto-credit requirements; MIT EECS decides every petition case by case. Official catalog `equivalent_subjects` / `old_id` values are credited automatically. Curated examples seed the agent's `evaluate_substitution` tool.

### Current Catalog Generation

`data/courses.json` is generated by `scripts/fetch_courses.py` from `https://fireroad.mit.edu/courses/all?full=true`. The script writes a filtered current catalog snapshot: it excludes `is_historical` courses and keeps only subjects with `offered_fall` or `offered_spring`.

Run it with:

```bash
python3 scripts/fetch_courses.py
```

Do not treat `data/courses.json` as a full per-semester history. It is not hand-authored, and its provenance must stay documented if the source URL, filter, output path, or schema changes.

#### Special subjects overlay

Special subjects (numbers with an `S` after the dot, e.g. `6.S062`, `18.S097`) may also appear with generic titles in the committed `data/courses.json` snapshot. A small EECS-only overlay keeps the once-per-semester topic-name churn self-contained; overlay records win by course id. Rebuild it each term:

```bash
python3 scripts/fetch_special_subjects.py --term "Fall 2026"
# optionally mine names from a saved copy of the JS-rendered EECS page:
python3 scripts/fetch_special_subjects.py --page saved_eecs_page.html
```

The EECS subject-updates page (`https://www.eecs.mit.edu/academics/subject-updates/...`) is JS-rendered, so the real topic names cannot be scraped reliably from the live URL — curate them in `data/special_subject_names.json` (or pass `--page` a saved render). Subjects without a curated name keep the API's generic title and are flagged `has_real_title: false`; the catalog exposes this as `hasRealTitle` so the UI/agent can say the topic is not yet listed. This is a build-time data artifact only — there is no frontend code for it.

`--term` infers the season filter (Fall, Spring, IAP/January, or Summer); an explicit conflicting `--season` is rejected. Without either option the script retains its broad fall-or-spring compatibility mode.

## Design System

All design tokens are CSS custom properties in `styles.css`. Accent color is MIT red (`#A31F34`). Dark mode is default; light mode swaps values under `[data-theme="light"]`.

Key utility classes: `.mono` (JetBrains Mono), `.display` (Space Grotesk), `.eyebrow` (mono uppercase label), `.btn`, `.btn-primary`, `.btn-ghost`, `.match-bar`, `.fade-in`, `.slide-up`.

Course area colors follow the pattern `var(--course-cs)`, `var(--course-math)`, etc.

## Backend Integration Points

The app has a small real backend, while transcript parsing and some student-data persistence remain prototype-level:

- `AgentPanel` (`components/agent.jsx`): calls `POST /api/chat`, including `studentName`, which runs the OpenRouter-backed tool-calling agent from `server/chat/*`.
- `AgentPanel` prefers `POST /api/chat/stream` for Server-Sent Events. The current stream contract separates ephemeral progress from final chat text: `progress_text`, `progress_text_delta`, `tool_activity_start`, `tool_activity_result`, `tool_activity_error`, `final_text_delta`, `trace_summary`, `proposal`, `final`, `error`, and `done`. `delta` is only a backward-compatible alias for final text.
- Final assistant text is ordinary Markdown, not JSON. Do not ask the model to return `{ text, suggestions, uiActions }`, and do not parse tool calls or plan mutations out of final prose.
- Tool progress is temporary UI. While streaming, show only the latest interim assistant text and current tool activity. After final, hide the progress block and optionally show the collapsed `Checked: ...` trace with safe tool input/result summaries. Do not send or render full raw tool outputs by default.
- For explicit validated active-semester mutations, the UI optimistically applies the change and shows an Applied changes card with Cancel/Undo. Recommendation-only answers do not mutate the plan.
- Chat routes emit request-scoped server logs as `[agent <id>] ...`. Preserve this logging when touching agent/tool behavior; it is the primary way to debug model rounds, tool call args/results, trace/proposal generation, and validated UI actions.
- Agent message text is rendered as a limited Markdown subset in `components/agent.jsx`; keep model-facing prompts aligned so responses use real Markdown lists and no raw HTML.
- `server/current/*`: normalizes the local `data/courses.json` catalog snapshot for frontend current views, recommendations, and agent tools. Override with `CURRENT_CATALOG_PATH` when needed. If catalog loading fails, current routes fail by default; mock fallback is allowed only with `DEMO_MODE=true`.
- `server/history/*`: SQLite-backed read-only historical offerings/documents/policies. History research should have the model write the complete display-ready `offering_markdown`; frontend code should render that Markdown directly instead of extracting Course Format/Attendance/Grading fields from prose. Use `npm run history:ablate-markdown -- <courseId> --limit 4 --jobs 4` with `OPENROUTER_API_KEY` to compare prompt variants without writing to the DB, then `npm run history:rewrite-markdown -- <courseId> --jobs 4` to regenerate offering display copy from cached documents without changing source coverage.
- `server/chat/prompt.js`: keep the agent focused on the active semester, final Markdown answers, tool-grounded course facts, and optimistic active-semester mutation proposals with Cancel/Undo. Reject cross-semester roadmap mutations unless a future portfolio proposal flow is explicitly implemented.
- `server/chat/tools.js`: search, course detail, recommendations, schedule summaries, suggestion sanitization, and UI action validation should resolve courses through `server/current/fireroad.js` first. Mock data must not mask current snapshot load failures unless `DEMO_MODE=true`.
- `server/requirements/*`: `checker.js` evaluates the Fireroad requirement JSON tree; `evaluate.js` is the single async entry point (`evaluateMajorRequirements`) used by BOTH `/api/requirements/check` and the chat agent. It expands official catalog equivalences and GIR/HASS attribute codes before checking, then resolves abstract codes back to real course ids. GIR/HASS counts come only from actual unique catalog courses, never synthetic equivalence targets. Do not reintroduce a separate sync agent path — that previously caused GIRs to always read as unsatisfied for the agent. `equivalence.js` credits official same-course equivalences (catalog `equivalent_subjects` / `old_id`, bidirectional); curated petitions in `data/substitutions.json` remain advisory only.
- The agent's `evaluate_substitution` tool is advisory: it returns both courses' context plus any curated example and a content comparison. It never predicts approval, credits a requirement, or emits a uiAction; students should consult their advisor and submit early through the department audit.
- Real recommendation scores should come from the server's personalized recommendation path, not `FRDATA.matchScores`; agent-facing current course summaries must not include legacy mock match scores.
- First-entry onboarding calls `/api/onboarding/*` for PDF text extraction, prompt execution, course import, and course-preference updates. The browser persists returned `personalCourseMarkdown` through Firebase client auth.
- The workload estimate in `CourseDetail` uses `profile.calibration` (0–1 float) — calibration should eventually be computed server-side

## Key Constraints

- Minimum viewport is 1100px wide (`body { min-width: 1100px }`); mobile layout is not supported
- The `?v=2` cache-busting query params on all local script/stylesheet URLs must be bumped manually when making changes that might be cached

## Documentation Maintenance

Multiple agents may work in this repository concurrently. When changing setup, scripts, generated data, API contracts, schema assumptions, product scope, prompt assets, or agent behavior, update the relevant documentation in the same change. At minimum, keep `README.md`, this file, prompt files, and nearby domain docs consistent with the code. Do not leave generated-data provenance or agent contracts for a later agent to rediscover.
