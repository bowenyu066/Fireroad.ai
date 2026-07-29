# Fireroad.ai

Fireroad.ai is a prototype MIT course planner focused on active-semester planning. It combines a no-build React frontend with a small Node/Express backend for current course search, requirement checks, historical course context, onboarding document parsing, and an OpenRouter-backed planning agent.

The planner treats `fourYearPlan[activeSem]` as the single editable schedule. Recommendations, workload summaries, requirement progress, and chat-driven add/remove proposals are all grounded in the active term.

## Features

- Active-semester schedule planning with current MIT course data
- AI chat assistant for course search, recommendations, schedule summaries, and validated active-semester changes
- Current course detail views backed by a normalized local Fireroad catalog snapshot
- Historical course detail views backed by a local SQLite history database
- Requirement checking against local `.reql` requirement data
- First-entry onboarding with transcript/resume parsing and course preference capture
- Optional Firebase client auth and persistence, with localStorage mock auth fallback

## Quick Start

Requirements:

- Node.js 18 or newer
- npm
- Optional: an OpenRouter API key for AI chat and onboarding prompt routes

```bash
npm install
cp .env.example .env
```

Set at least the OpenRouter key if you want the chat agent and onboarding prompt pipeline:

```bash
export OPENROUTER_API_KEY="your_openrouter_key"
```

Then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is already in use and `PORT` is not set, the server tries the next ports automatically.

`npm run dev` initializes and seeds the local history database before starting the app.

## Environment

Common variables:

```bash
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=openai/gpt-4.1-mini
OPENROUTER_TIMEOUT_MS=120000
OPENROUTER_SITE_URL=http://localhost:3000
DEMO_MODE=false
CURRENT_CATALOG_PATH=data/courses.json
HISTORY_DB_PATH=data/course_history.db
PORT=3000
```

Firebase variables are optional. If they are omitted, the app uses localStorage-backed mock auth:

```bash
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
FIREBASE_MEASUREMENT_ID=

FIREBASE_REQUIRE_MIT_EMAIL=true
FIREBASE_REQUIRE_EMAIL_VERIFICATION=false
FIREBASE_ALLOW_NON_MIT_EMAILS=false
```

Do not commit backend secrets, service account JSON, or private API keys. The browser never reads `OPENROUTER_API_KEY`; only the backend OpenRouter modules use it.

## Scripts

```bash
npm run dev                       # initialize history DB, then start the server
npm start                         # same as dev
npm test                          # requirement/equivalence and catalog normalization tests
npm run history:setup             # initialize and seed history DB
npm run history:init              # create/update SQLite schema
npm run history:seed              # seed demo course rows
npm run history:import-manifest -- 6.3900
npm run history:fetch-docs -- 6.3900
npm run history:extract-policies -- 6.3900
npm run history:collect -- 6.3900
npm run history:ablate-markdown -- 6.3900 --limit 4 --jobs 4
npm run history:rewrite-markdown -- 6.3900 --jobs 4
```

Current catalog refresh:

```bash
python3 scripts/fetch_courses.py
```

That script fetches `https://fireroad.mit.edu/courses/all?full=true`, excludes historical subjects, keeps subjects offered in fall or spring, and writes `data/courses.json`.

Special subjects (numbers with an `S` after the dot, e.g. `6.S062`) use a separate EECS-only overlay because their topic names change every term and the Fireroad API only returns a generic placeholder title. Rebuild it once per semester:

```bash
python3 scripts/fetch_special_subjects.py --term "Fall 2026"
```

The script infers the offering season from `--term` (or accepts `--season` explicitly), so a Fall-labeled artifact cannot accidentally include Spring-only subjects. Curate the specific topic names in `data/special_subject_names.json` (the EECS subject-updates page is JS-rendered, so names cannot be scraped reliably from the live URL — hand-edit, or pass `--page` a saved copy of the rendered page). The overlay is merged into the catalog at load time by `server/current/fireroad.js`.

## Architecture

There is no frontend bundler or build step. The browser loads React, ReactDOM, Babel standalone, and project files directly from ordered `<script>` tags in `index.html`. JSX is transpiled at runtime.

Load order matters:

1. `shared/mock-data.js`
2. `shared/personal-course.js`
3. `data.js`
4. `/firebase-config.js`
5. `components/auth-service.js`
6. `components/shared.jsx`
7. `components/auth.jsx`
8. `components/onboarding.jsx`
9. `components/schedule.jsx`
10. `components/agent.jsx`
11. `components/course-detail.jsx`
12. `components/profile.jsx`
13. `app.jsx`

The backend starts from `server.js`, creates the Express app in `server/app.js`, serves static files from the repo root, and mounts API routes under `/api/*`.

## Frontend State

Global state lives in `App` and is exposed through `AppCtx`:

- `theme`
- `route`
- `profile`
- `fourYearPlan`
- `activeSem`
- `messages`

Routing is a plain object such as `{ name: 'planner' }` or `{ name: 'course', id }`; there is no router library. The editable schedule is always `fourYearPlan[activeSem]`.

The active term selector is generated in `data.js` from the current date. Do not hardcode stale term defaults such as `S25`.

## Data

Important local data files:

- `data/courses.json`: generated current catalog snapshot
- `data/special_subjects.json`: generated EECS special-subjects overlay (merged into the catalog)
- `data/special_subject_names.json`: hand-maintained per-term topic names for special subjects
- `data/substitutions.json`: curated advisory examples for course-substitution petitions
- `data/reqs.json`: index of MIT requirement programs
- `data/requirements/`: generated requirement files and parsed JSON
- `data/course_history.db`: local SQLite history database
- `data/history_manifests/`: manual historical offering manifests
- `data/most_taken.json`: parsed EECSIS "Who's Taken What" data

`window.FRDATA` in `data.js` is the browser data adapter and seed layer. Current catalog UI paths should use server-backed helpers such as `FRDATA.fetchCurrentSearch(...)`, `FRDATA.fetchCurrentCourse(...)`, and `FRDATA.fetchCurrentCatalog()`.

Mock data and legacy match scores are for demos only. Current catalog or agent-facing paths should not silently fall back to mock data unless `DEMO_MODE=true`.

Requirement evaluation credits official catalog equivalences for named course slots. Curated petition examples remain advisory because the department decides every petition case by case; they never auto-credit the audit. GIR/HASS counts use only the student's actual unique courses, so aliases cannot inflate subject totals.

## API Overview

Health:

- `GET /api/health`

Chat:

- `POST /api/chat`
- `POST /api/chat/stream`

Chat requests include `messages`, `profile`, `schedule`, `activeSem`, and `studentName`. `schedule` should be the active-semester array, not the full four-year plan.

The streaming route uses Server-Sent Events. Final assistant text is Markdown, while progress and tool activity are separate temporary events.

Current catalog:

- `GET /api/current/course/:courseId`
- `GET /api/current/search?q=...`
- `GET /api/current/catalog`
- `POST /api/current/recommendations`

Requirements:

- `POST /api/requirements/check`

Example body:

```json
{
  "major": "Course 6-3",
  "courses": ["6.100A", "6.1010", "18.06"]
}
```

History:

- `GET /api/history/stats`
- `GET /api/history/course/:courseId`
- `GET /api/history/course/:courseId/offerings`
- `GET /api/history/offering/:offeringId`

Onboarding:

- `POST /api/onboarding/profile`
- `POST /api/onboarding/transcript`
- `POST /api/onboarding/resume`
- `POST /api/onboarding/coursework`
- `POST /api/onboarding/preferences`
- `POST /api/onboarding/personalization-prefill`
- `POST /api/onboarding/more-preferences`
- `POST /api/onboarding/personalization-questions`
- `POST /api/onboarding/personalization-followups`

The server does not store raw uploaded files. PDF parsing requires searchable PDFs; OCR for scanned PDFs is not implemented.

## Chat Agent Contract

The chat agent is active-semester-first. It may recommend courses, summarize workload, check current catalog facts, and propose validated add/remove actions for the active schedule.

`POST /api/chat/stream` emits progress and final events including:

- `progress_text`
- `progress_text_delta`
- `tool_activity_start`
- `tool_activity_result`
- `tool_activity_error`
- `final_text_delta`
- `trace_summary`
- `proposal`
- `final`
- `error`
- `done`

`delta` remains as a backward-compatible alias for final text. Tool progress should stay temporary in the UI; final answers should render ordinary Markdown and not require JSON parsing from prose.

Server logs are request-scoped as `[agent <id>] ...` and are the main debugging path for model rounds, tool calls, current-catalog lookups, proposal generation, and UI action validation.

## Historical Course Workflow

History collection is offering-first and mostly manual. Add or update manifests in `data/history_manifests/`, then run the relevant history scripts.

Typical flow:

```bash
npm run history:import-manifest -- 6.3900
npm run history:fetch-docs -- 6.3900
OPENROUTER_API_KEY="your_openrouter_key" npm run history:extract-policies -- 6.3900
OPENROUTER_API_KEY="your_openrouter_key" npm run history:ablate-markdown -- 6.3900 --limit 4 --jobs 4
OPENROUTER_API_KEY="your_openrouter_key" npm run history:rewrite-markdown -- 6.3900 --jobs 4
```

`history:ablate-markdown` is read-only. `history:rewrite-markdown` rewrites display-ready offering Markdown from cached documents without changing source coverage.

## Firebase Persistence

When Firebase config is present, the frontend stores user data in:

```text
users/{uid}
```

Fields include `email`, `onboardingCompleted`, `profile`, `fourYearPlan`, `activeSem`, `onboarding`, `personalCourseMarkdown`, and `schemaVersion`.

See `docs/firebase-auth.md` for setup and persistence details.

## Development Notes

- Minimum viewport is 1100px wide; mobile layout is not supported.
- Local script and stylesheet URLs in `index.html` use manual cache-busting query params. Bump the relevant `?v=` value after frontend changes that may be cached.
- Dark mode and light mode tokens live in `styles.css`; MIT red is the primary accent.
- Keep `FourYearPlan` as a legacy read-only export unless future portfolio planning is explicitly requested.
- Keep current course search and agent tools grounded in `server/current/*`.
- Do not expose `FRDATA.matchScores` as real personalized current-course scoring.

## Documentation Maintenance

When changing setup, scripts, generated data, API contracts, schemas, product scope, prompt assets, agent behavior, or data provenance, update the relevant documentation in the same change. At minimum, keep `README.md`, `AGENTS.md`, prompt files, and nearby domain docs consistent with the code.
