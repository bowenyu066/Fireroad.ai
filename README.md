# Fireroad.ai

Fireroad.ai is an AI-assisted MIT course planning prototype. It helps a student choose an active term, build that term's schedule, search the current MIT catalog, check requirements, reason about workload, and ask a planning agent for grounded recommendations.

The app is intentionally lightweight: a static, no-build React frontend is served by a small Node/Express backend. The backend owns OpenRouter calls, current catalog normalization, requirement checks, onboarding prompt execution, and the read-only course history database.

## Features

- Active-semester schedule planning with normalized current MIT course data.
- AI chat assistant for course search, recommendations, workload summaries, requirement checks, and validated active-semester changes.
- Current course detail views backed by a local Fireroad catalog snapshot.
- Historical course detail views backed by a local SQLite history database.
- Requirement checking against local requirement data.
- First-entry onboarding with profile input, searchable transcript/resume PDF parsing, course ratings, and planning preferences.
- Optional Firebase client auth and persistence, with localStorage mock auth fallback.

## Product Model

The current product surface is active-semester planning. The editable schedule is always:

```js
fourYearPlan[activeSem]
```

Recommendations, workload summaries, requirement progress, and chat-driven add/remove proposals are all grounded in that active term. `fourYearPlan` and `activeSem` remain the canonical persisted shape so future term-aware work has somewhere to live, but the main planner does not expose cross-semester drag/drop editing.

The active term selector is generated from the current date in `data.js`; do not hardcode stale defaults such as `S25`. A legacy read-only `FourYearPlan` component exists for future display work and is not mounted in the primary planner.

Mock data in `shared/mock-data.js` is seed/demo data. It includes legacy match scores, which must not be presented as real current or personalized scores. Current catalog load failures only fall back to mock data when `DEMO_MODE=true`.

## Quick Start

Requirements:

- Node.js 18 or newer
- npm
- Optional: an OpenRouter API key for AI chat and onboarding prompt routes

```bash
npm install
cp .env.example .env
# Fill OPENROUTER_API_KEY in .env if you want the chat agent and onboarding prompts.
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is already in use and `PORT` is not set, the server automatically tries the next ports.

`npm run dev` initializes and seeds the local history database before starting the app. The planner can still load without an OpenRouter key, but model-backed chat and onboarding prompt generation will fall back or return a server-side key warning.

## Environment

`.env` is ignored by Git. Start from `.env.example` and set only the values you need.

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Enables the server-side chat agent and onboarding prompt routes. Never expose it to the browser. |
| `OPENROUTER_MODEL` | Optional model override for OpenRouter chat completions. Use a tool-capable model. |
| `OPENROUTER_TIMEOUT_MS` | Optional OpenRouter request timeout. Defaults to 120000 ms. |
| `OPENROUTER_SITE_URL` | Optional `HTTP-Referer` value for OpenRouter requests. |
| `PORT` | Optional server port. Defaults to 3000. |
| `CURRENT_CATALOG_PATH` | Optional path to a replacement current catalog snapshot. Defaults to `data/courses.json`. |
| `CURRENT_CATALOG_TTL_MS` | Optional in-memory current catalog cache TTL. |
| `DEMO_MODE` | Set to `true` only when local mock catalog fallback is intentional. |
| `HISTORY_DB_PATH` | Optional path to a replacement history SQLite database. |
| `FIREBASE_*` | Firebase Web config served to the browser by `/firebase-config.js`. |
| `FIREBASE_REQUIRE_MIT_EMAIL` | Defaults to `true`; requires `@mit.edu` addresses unless relaxed. |
| `FIREBASE_REQUIRE_EMAIL_VERIFICATION` | Defaults to `false`; can require Firebase email verification. |
| `FIREBASE_ALLOW_NON_MIT_EMAILS` | Defaults to `false`; development escape hatch for non-MIT addresses. |

If Firebase config is missing, the frontend uses mock auth backed by localStorage. Mock auth still follows the configured email-domain rules.

Do not commit backend secrets, service account JSON, OpenRouter keys, or private API keys.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Runs `history:setup`, then starts `server.js`. |
| `npm start` | Same startup path as `npm run dev`. |
| `npm run history:setup` | Initializes the SQLite schema and seeds demo history courses. |
| `npm run history:init` | Creates or migrates `data/course_history.db`. |
| `npm run history:seed` | Seeds canonical demo course rows. |
| `npm run history:import-manifest -- <courseId>` | Imports offering metadata from `data/history_manifests/`. |
| `npm run history:fetch-docs -- <courseId>` | Fetches source documents for imported offerings. |
| `npm run history:extract-policies -- <courseId>` | Uses OpenRouter to extract attendance and grading policy data. |
| `npm run history:ablate-markdown -- <courseId>` | Compares offering-summary prompt variants without writing to the DB. |
| `npm run history:rewrite-markdown -- <courseId>` | Regenerates display Markdown for cached offerings. |
| `npm run history:collect -- <courseId>` | Runs the manual history collection pipeline. |

There is currently no frontend build or test script.

## Architecture

### Frontend

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

Important frontend files:

| Path | Role |
| --- | --- |
| `index.html` | Script and stylesheet entry point. |
| `styles.css` | Design tokens, layout, dark/light theme styles. |
| `data.js` | Browser data adapter exposed as `window.FRDATA`. |
| `shared/mock-data.js` | Demo seed data and legacy fallback records. |
| `shared/personal-course.js` | Helpers for parsing/summarizing `personal_course.md`. |
| `components/auth-service.js` | Firebase or localStorage auth/persistence adapter. |
| `components/auth.jsx` | Sign-in and onboarding gate UI. |
| `components/onboarding.jsx` | First-entry onboarding flow. |
| `components/schedule.jsx` | Active-semester schedule and calendar UI. |
| `components/agent.jsx` | Chat agent, SSE stream handling, recommendations panel. |
| `components/course-detail.jsx` | Current and historical course detail views. |
| `components/profile.jsx` | Editable student profile page. |
| `app.jsx` | Root state, routing, and planner composition. |

Global state lives in `App` and is exposed through `AppCtx`: `theme`, `route`, `profile`, `fourYearPlan`, `activeSem`, and `messages`. Routing is a plain object such as `{ name: 'planner' }` or `{ name: 'course', id }`; there is no router library.

Local script and stylesheet URLs use manual cache-busting query params. Bump the relevant `?v=` value after frontend changes that may be cached.

### Backend

`server.js` loads environment variables, creates the Express app, and starts the server. `server/app.js` serves static files from the repo root and mounts API routes under `/api/*`.

Important backend areas:

| Path | Role |
| --- | --- |
| `server/chat/*` | OpenRouter calls, prompts, tools, streaming, and validated UI proposals. |
| `server/current/*` | Current catalog loading, normalization, search, and recommendations. |
| `server/history/*` | SQLite access, history summaries, offering documents, and policy data. |
| `server/onboarding/*` | PDF text extraction and prompt-file execution for onboarding. |
| `server/requirements/*` | Requirement parser/checker and `/api/requirements/check`. |
| `server/routes/*` | Thin route entry points for health, chat, current, history, and requirements. |

## Data

Important local data files:

- `data/courses.json`: generated current catalog snapshot.
- `data/reqs.json`: index of MIT requirement programs.
- `data/requirements/`: generated requirement files and parsed JSON.
- `data/course_history.db`: local SQLite history database.
- `data/history_manifests/`: manual historical offering manifests.
- `data/most_taken.json`: parsed EECSIS "Who's Taken What" data.

`window.FRDATA` in `data.js` is the browser data adapter and seed layer. Current catalog UI paths should use server-backed helpers such as `FRDATA.fetchCurrentSearch(...)`, `FRDATA.fetchCurrentCourse(...)`, and `FRDATA.fetchCurrentCatalog()`.

### Current Catalog

Current catalog data lives in `data/courses.json` by default. It is generated data, not hand-authored source.

Refresh it with:

```bash
python3 scripts/fetch_courses.py
```

The script fetches:

```text
https://fireroad.mit.edu/courses/all?full=true
```

Then it keeps only courses that are not historical and are offered in fall or spring:

```python
not course.get("is_historical", False) and (course.get("offered_fall") or course.get("offered_spring"))
```

This makes `data/courses.json` a filtered current catalog snapshot, not the full Fireroad catalog and not a per-semester offering history. When refreshing it, review the diff and update this README if the source URL, filter rule, output path, or schema changes.

Requirement source data lives in `data/reqs.json` and `data/requirements/*.json`. The root-level `fireroad_fetch.py` and `reqs_fetch.py` scripts are exploration/fetch helpers for Fireroad requirement data.

### History Data

History data lives in `data/course_history.db` by default. The app reads it through `server/history/*`; planner and chat flows do not write history records.

Initialize or refresh the local DB:

```bash
npm run history:setup
```

Manual offering collection is manifest-driven:

```bash
npm run history:import-manifest -- 6.3900
npm run history:fetch-docs -- 6.3900
OPENROUTER_API_KEY="your_openrouter_key" npm run history:extract-policies -- 6.3900
OPENROUTER_API_KEY="your_openrouter_key" npm run history:ablate-markdown -- 6.3900 --limit 4 --jobs 4
OPENROUTER_API_KEY="your_openrouter_key" npm run history:rewrite-markdown -- 6.3900 --jobs 4

# Or run the full manual pipeline:
npm run history:collect -- 6.3900
```

`history:ablate-markdown` is read-only. It samples cached history documents, runs prompt variants, and prints comparison output without writing to `data/course_history.db`. `history:rewrite-markdown` reuses cached source documents and rewrites offering display Markdown.

## API Overview

All OpenRouter access stays server-side. The browser never reads `OPENROUTER_API_KEY`; only backend OpenRouter modules use it.

Health:

- `GET /api/health`

Chat:

- `POST /api/chat`
- `POST /api/chat/stream`

Chat requests include `messages`, `profile`, `schedule`, `activeSem`, and `studentName`. `schedule` should be the active-semester array, not the full four-year plan.

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

PDF uploads are limited to 10 MB. The server does not store raw uploaded files. OCR for scanned PDFs is not implemented, so transcript and resume PDFs must contain searchable text.

## Chat Agent Contract

The chat agent is active-semester-first. It may recommend courses, summarize workload, check current catalog facts, check requirement progress, and propose validated add/remove actions for the active schedule.

`POST /api/chat/stream` emits Server-Sent Events including:

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

`delta` remains a backward-compatible alias for final text deltas. Tool progress should stay temporary in the UI; final answers should render ordinary Markdown and should not require JSON parsing from prose. For explicit validated active-semester mutations, the UI applies the proposal optimistically and shows an Applied changes card with Cancel/Undo.

Server logs are request-scoped as `[agent <id>] ...` and are the main debugging path for model rounds, tool calls, current-catalog lookups, proposal generation, and UI action validation.

## Firebase Persistence

The server renders `/firebase-config.js` from environment variables. If a complete Firebase Web config is available, the frontend uses Firebase Auth and Firestore. If not, it uses localStorage mock auth.

User data is stored under:

```text
users/{uid}
```

Current persisted fields include `email`, `onboardingCompleted`, `profile`, `fourYearPlan`, `activeSem`, `onboarding`, `personalCourseMarkdown`, and `schemaVersion`. Older local test data may still contain `semesterPlan`; the app migrates it into `fourYearPlan[activeSem]` when loading.

See `docs/firebase-auth.md` for setup and persistence details.

## Deployment

`vercel.json` routes all requests to `server.js` through `@vercel/node` and includes the static/data files required at runtime. If a new runtime dependency is loaded from disk in production, update `includeFiles` so Vercel ships it.

## Development Notes

- Minimum viewport is 1100px wide; mobile layout is not supported.
- Dark mode and light mode tokens live in `styles.css`; MIT red is the primary accent.
- Keep `FourYearPlan` as a legacy read-only export unless future portfolio planning is explicitly requested.
- Keep current course search and agent tools grounded in `server/current/*`.
- Do not expose `FRDATA.matchScores` as real personalized current-course scoring.

## Maintenance Rules

- Keep `README.md`, `CLAUDE.md`, prompt files, and nearby domain docs in sync when setup, scripts, generated data, API contracts, schemas, product scope, prompt assets, agent behavior, or data provenance changes.
- Keep the active-semester model clear: agent mutations and requirement/workload summaries target `fourYearPlan[activeSem]`.
- Do not expose `OPENROUTER_API_KEY` to browser code.
- Do not silently use mock catalog data outside explicit `DEMO_MODE=true` sessions.
- Do not present `shared/mock-data.js` legacy match scores as real current or personalized scores.
- Preserve generated-data provenance, especially the `data/courses.json` source URL and filter rule.
