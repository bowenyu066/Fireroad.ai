# Fireroad.ai

Fireroad.ai is an AI-powered course planner for MIT students. It helps you plan an active semester, search MIT course data, check requirements, compare current and historical course information, and ask an AI planning assistant for course recommendations.

Live app: [https://fireroad-ai-lime.vercel.app](https://fireroad-ai-lime.vercel.app)

Public API base: `https://fireroad-ai-lime.vercel.app/api`

Fireroad.ai is an independent student project and is not an official MIT service.

## For Students

You do not need to install anything. Open the live app and sign in:

[Open Fireroad.ai](https://fireroad-ai-lime.vercel.app)

The app can help you:

- Build and edit a schedule for your active semester.
- Search courses offered in the selected term and filter by department, requirement, and workload.
- View current course details and historical offering context.
- Check requirement progress from selected courses.
- Upload searchable transcript or resume PDFs during onboarding.
- Tell the AI assistant what you want from your semester and get course suggestions.
- Apply assistant-proposed schedule changes with an undo path.

The planner focuses on one active term at a time. Your selected term and schedule are saved as part of your account profile when Firebase persistence is enabled.

## Public API

The deployed Vercel app also exposes the same API used by the frontend.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Check server status and configured model metadata. |
| `GET /api/current/search?q=6.3900&semester=F26` | Search the current catalog, filtered to a semester by default. |
| `GET /api/current/course/:courseId` | Fetch one normalized current course. |
| `GET /api/current/catalog` | Fetch a capped current catalog snapshot. |
| `POST /api/current/recommendations` | Generate course recommendations from a schedule/profile payload. |
| `POST /api/requirements/check` | Check selected courses against a requirement set. |
| `POST /api/chat` | Run the planning assistant and return one final response. |
| `POST /api/chat/stream` | Run the planning assistant over Server-Sent Events. |
| `GET /api/history/course/:courseId` | Fetch historical course summary and offerings. |
| `GET /api/history/offering/:offeringId` | Fetch one historical offering with source/policy context. |

Current search also accepts comma-separated `departments`, `areas`, and `requirements`, plus `max_workload`. Set `include_unavailable=true` only when the client intentionally wants results from other terms.

Example:

```bash
curl "https://fireroad-ai-lime.vercel.app/api/health"
```

Requirement check example:

```bash
curl -X POST "https://fireroad-ai-lime.vercel.app/api/requirements/check" \
  -H "Content-Type: application/json" \
  -d '{"major":"Course 6-3","courses":["6.100A","6.1010","18.06"]}'
```

## For Developers

### Local Setup

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is already in use and `PORT` is not set, the server tries the next available ports automatically.

`npm run dev` initializes and seeds the local history database before starting the server.

### Environment Variables

Start from `.env.example`.

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | Optional provider override: `ppapi`, `openai`, or `openrouter`. If omitted, keys are detected in that order. |
| `AI_MODEL` | Optional model override shared by the configured provider. |
| `AI_TIMEOUT_MS` | Optional shared AI request timeout in milliseconds. |
| `PPAPI_API_KEY` | Enables the AI routes through the OpenAI-compatible PP API. |
| `PPAPI_BASE_URL` | Required PP API base URL. |
| `PPAPI_MODEL` | Optional PP API model override. Defaults to `gpt-5.6-terra`. |
| `OPENAI_API_KEY` | Direct OpenAI fallback when no PP API key is set. |
| `OPENAI_MODEL` | Optional direct OpenAI model override. |
| `OPENROUTER_API_KEY` | OpenRouter fallback when neither PP API nor OpenAI is configured. |
| `OPENROUTER_MODEL` | Optional OpenRouter model override. |
| `OPENROUTER_SITE_URL` | Optional referer URL sent to OpenRouter. |
| `PORT` | Optional local server port. Defaults to 3000. |
| `CURRENT_CATALOG_PATH` | Optional path to a local current catalog JSON file. |
| `SPECIAL_SUBJECTS_PATH` | Optional path to the term-specific special-subject overlay. |
| `DEMO_MODE` | Set to `true` to allow local mock catalog fallback. |
| `HISTORY_DB_PATH` | Optional path to a local SQLite history database. |
| `FIREBASE_*` | Firebase Web config served to the browser by `/firebase-config.js`. |

If Firebase config is missing, local development uses localStorage-backed mock auth. `.env` and `.env` copies are ignored by Git; keep only blank placeholders in `.env.example`. Do not commit API keys, Firebase service accounts, or private secrets.

### Useful Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Initialize history data and start the app locally. |
| `npm start` | Same startup path as `npm run dev`. |
| `npm test` | Run catalog normalization, active-term search, and requirement tests. |
| `npm run history:setup` | Initialize and seed the local history database. |
| `npm run history:import-manifest -- <courseId>` | Import historical offering metadata from `data/history_manifests/`. |
| `npm run history:fetch-docs -- <courseId>` | Fetch source documents for imported offerings. |
| `npm run history:extract-policies -- <courseId>` | Use the configured AI provider to extract attendance/grading policy data. |
| `npm run history:collect -- <courseId>` | Run the full manual history collection pipeline. |

Refresh the current course catalog:

```bash
python3 scripts/fetch_courses.py
```

The script fetches Fireroad course data from `https://fireroad.mit.edu/courses/all?full=true` and writes the filtered current snapshot to `data/courses.json`.

Real current-catalog rows never merge legacy mock requirements, workload, schedule, rating, or match scores. Mock catalog facts are available only when `DEMO_MODE=true`.

Special subjects such as `6.S062` use `data/special_subjects.json`, generated once per semester with:

```bash
python3 scripts/fetch_special_subjects.py --term "Fall 2026"
```

Curate topic names in `data/special_subject_names.json`, then rerun the script. Official catalog equivalences count automatically in requirement checks; examples in `data/substitutions.json` remain advisory and never grant automatic credit.

Requirement snapshots come from Fireroad. Narrow corrections for newer official departmental audit charts live in `data/requirement-overrides.json` so refreshing generated snapshots does not silently remove them.

### Project Shape

There is no frontend build step. The browser loads React, ReactDOM, Babel standalone, and project files directly from ordered script tags in `index.html`.

Key files:

| Path | Purpose |
| --- | --- |
| `server.js` | Express entry point. |
| `server/app.js` | API route mounting and static file serving. |
| `server/chat/` | Configurable AI provider, assistant tools, prompts, and streaming. |
| `server/current/` | Current catalog loading, normalization, search, and recommendations. |
| `server/history/` | SQLite-backed historical course data. |
| `server/onboarding/` | PDF extraction and onboarding prompt routes. |
| `server/requirements/` | Requirement parsing and checking. |
| `components/` | Browser-loaded React components. |
| `data/` | Course, requirement, special-subject, and history snapshots. |

Deployment is handled by Vercel using `vercel.json`.
