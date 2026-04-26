# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

There is no frontend build step. The app is served by a small Node/Express backend that also exposes the OpenRouter-backed chat API and the local history database routes.

```bash
npm install
export OPENROUTER_API_KEY="your_openrouter_key"
# Optional:
export OPENROUTER_MODEL="openai/gpt-4.1-mini"
export OPENROUTER_TIMEOUT_MS=20000
npm run dev
```

Open http://localhost:3000. `npm run dev` initializes/seeds the local history database before starting the server.

The frontend still uses React 18, ReactDOM, and Babel standalone from CDN via `<script>` tags in `index.html`; JSX is transpiled at runtime by Babel.

## Product Priority

The current product focus is active-semester planning. Treat `fourYearPlan[activeSem]` as the single editable schedule and the primary surface for recommendations, workload checks, requirement summaries, and chat-driven add/remove actions.

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

`window.FRDATA` (defined in `data.js`) is now a browser adapter and fallback/seed layer. Current course data should come from `/api/current`, which reads and normalizes the local snapshot at `data/courses.json`:

- `FRDATA.catalog` — array of course objects with `id`, `name`, `units`, `schedule`, `days`, `time`, `satisfies`, `prereqs`, `hydrant`, `rating`, `topics`, `area`
- `FRDATA.profile` — mock student profile (taken courses, preferences, calibration, remaining requirements)
- `FRDATA.matchScores` — match score breakdown per course (`total`, `interest`, `workload`, `reqValue`)
- `FRDATA.fourYearPlan`, `FRDATA.semesterLabels`, `FRDATA.semesterOrder`, `FRDATA.defaultActiveSem` — term-aware seed plan data; the editable schedule is `fourYearPlan[activeSem]`
- `FRDATA.termOptions` — rolling term picker options generated from the current date
- `FRDATA.fetchCurrentCourse(id)` / `FRDATA.fetchCurrentSearch(q)` / `FRDATA.fetchCurrentCatalog()` — server-backed current catalog helpers with mock fallback
- `FRDATA.getCourse(id)` / `FRDATA.getMatch(id)` — fallback lookup helpers

The planner's manual course search path must call `FRDATA.fetchCurrentSearch(...)` and treat `/api/current/search` as the primary source. Cache current search results for schedule/detail display, but do not reintroduce mock catalog filtering as the main user path.

Course `area` is computed from course ID prefix: `6.` → `cs`, `18.` → `math`, `8.` → `physics`, `7.` → `bio`, HASS-prefix numbers → `hass`.

### Reference Data Files

- `data/reqs.json` — index of all MIT programs (majors, minors, MEng, NEET tracks, GIRs) keyed by Fireroad requirement ID (e.g. `major6-3`, `minor6`, `girs`). Used as the source list for requirement fetching.
- `data/requirements/` — individual `.reql` requirement files fetched from `https://fireroad.mit.edu/catalogs/requirements/{key}.reql` for every key in `reqs.json`. Generated by `fireroad_fetch.py` (root-level exploration script, separate from `scripts/fetch_courses.py`).
- `data/most_taken.json` — parsed EECSIS "Who's Taken What" data: top-5 most-taken courses per EECS major (`6-1` through `6-14`) per year (`Y1`–`Y4`), each entry as `[courseId, count]`. Source HTML is `data/EECSIS Who's Taken What.html`.

### Current Catalog Generation

`data/courses.json` is generated by `scripts/fetch_courses.py` from `https://fireroad.mit.edu/courses/all?full=true`. The script writes a filtered current catalog snapshot: it excludes `is_historical` courses and keeps only subjects with `offered_fall` or `offered_spring`.

Run it with:

```bash
python3 scripts/fetch_courses.py
```

Do not treat `data/courses.json` as a full per-semester history. It is not hand-authored, and its provenance must stay documented if the source URL, filter, output path, or schema changes.

## Design System

All design tokens are CSS custom properties in `styles.css`. Accent color is MIT red (`#A31F34`). Dark mode is default; light mode swaps values under `[data-theme="light"]`.

Key utility classes: `.mono` (JetBrains Mono), `.display` (Space Grotesk), `.eyebrow` (mono uppercase label), `.btn`, `.btn-primary`, `.btn-ghost`, `.match-bar`, `.fade-in`, `.slide-up`.

Course area colors follow the pattern `var(--course-cs)`, `var(--course-math)`, etc.

## Backend Integration Points

The app has a small real backend, while transcript parsing and some student-data persistence remain prototype-level:

- `AgentPanel` (`components/agent.jsx`): calls `POST /api/chat`, including `studentName`, which runs the OpenRouter-backed tool-calling agent from `server/chat/*`.
- `AgentPanel` prefers `POST /api/chat/stream` for Server-Sent Events. The stream sends status and text deltas, then a final validated payload with suggestions and `uiActions`.
- Chat routes emit request-scoped server logs as `[agent <id>] ...`. Preserve this logging when touching agent/tool behavior; it is the primary way to debug model rounds, tool call args/results, final JSON parsing, and validated UI actions.
- Agent message text is rendered as a limited Markdown subset in `components/agent.jsx`; keep model-facing prompts aligned so responses use real Markdown lists and no raw HTML.
- `server/current/*`: normalizes the local `data/courses.json` catalog snapshot for frontend current views, recommendations, and agent tools. Override with `CURRENT_CATALOG_PATH` when needed.
- `server/history/*`: SQLite-backed read-only historical offerings/documents/policies.
- `server/chat/prompt.js`: keep the agent focused on the active semester and reject cross-semester roadmap mutations unless explicitly requested.
- `server/chat/tools.js`: search, course detail, recommendations, schedule summaries, suggestion sanitization, and UI action validation should resolve courses through `server/current/fireroad.js` first. Mock data is only a fallback when the current snapshot cannot load.
- Match scores in `FRDATA.matchScores` should come from `POST /api/score-courses`
- First-entry onboarding calls `/api/onboarding/*` for PDF text extraction, prompt execution, course import, and course-preference updates. The browser persists returned `personalCourseMarkdown` through Firebase client auth.
- The workload estimate in `CourseDetail` uses `profile.calibration` (0–1 float) — calibration should eventually be computed server-side

## Key Constraints

- Minimum viewport is 1100px wide (`body { min-width: 1100px }`); mobile layout is not supported
- The `?v=2` cache-busting query params on all local script/stylesheet URLs must be bumped manually when making changes that might be cached

## Documentation Maintenance

Multiple agents may work in this repository concurrently. When changing setup, scripts, generated data, API contracts, schema assumptions, product scope, prompt assets, or agent behavior, update the relevant documentation in the same change. At minimum, keep `README.md`, this file, prompt files, and nearby domain docs consistent with the code. Do not leave generated-data provenance or agent contracts for a later agent to rediscover.
