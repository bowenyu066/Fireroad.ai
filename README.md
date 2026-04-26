# Fireroad.ai Prototype

Static React prototype served by a tiny Node/Express backend. The backend keeps the OpenRouter key server-side and exposes a tool-calling course-planning chat route.

## Product Direction

The current product scope is active-semester planning. The editable plan is `fourYearPlan[activeSem]`; recommendations, requirement checks, workload summaries, and agent `uiActions` all target that active semester.

The app keeps the `fourYearPlan` object in state and persistence so term-aware data can survive future work. There is still no user-facing cross-semester drag/drop workflow in the main product path. A legacy read-only `FourYearPlan` component is kept as an internal display interface for future work, but it is not mounted from the planner.

Course detail is split into `Current` and `Historical` views. Current data comes from the server-side normalized local catalog snapshot at `data/courses.json`. Historical data comes from the SQLite-backed history subsystem and is read-only reference.

The active term selector is generated from the current date in `data.js`, similar to Hydrant's rolling term picker. Users can still manually choose another term; do not hardcode stale semester labels or default active terms.

Manual course search in the planner uses `FRDATA.fetchCurrentSearch(...)`, which calls `/api/current/search` and caches normalized current courses for schedule display. The chat agent's course lookup, search, recommendation, schedule summary, and UI action validation tools also use the server-side current catalog first. `shared/mock-data.js` remains only a fallback when current data cannot be loaded.

## Setup

```bash
npm install
export OPENROUTER_API_KEY="your_openrouter_key"
# Optional:
export OPENROUTER_MODEL="openai/gpt-4.1-mini"
export OPENROUTER_TIMEOUT_MS=20000
npm run dev
```

Open http://localhost:3000.

`npm run dev` initializes and seeds the local history database before starting the server.

## API

- `GET /api/health` checks server status and whether an OpenRouter key is configured.
- `POST /api/chat` accepts `{ messages, profile, schedule, activeSem, studentName }` where `schedule` is `fourYearPlan[activeSem]`, and returns an agent message plus validated `uiActions`.
- `POST /api/chat/stream` accepts the same payload and returns Server-Sent Events (`status`, `delta`, `final`, `error`, `done`) so the chat panel can stream the agent's `text` while still applying final validated `uiActions`.
- Chat requests log request-scoped diagnostics in the server terminal as `[agent <id>] ...`, including model rounds, tool call arguments, current-catalog result summaries, final JSON parsing, and UI action validation. The browser console also logs `[agent stream] ...` for stream start/status/final/failure events.
- Agent message text is rendered as a small safe Markdown subset in the chat UI, so model responses should use real newline-separated Markdown bullets instead of one-line pseudo-lists.
- `GET /api/current/course/:courseId` returns normalized current catalog data.
- `GET /api/current/search?q=...` searches current catalog data.
- `GET /api/current/catalog` returns a normalized current catalog snapshot.
- `GET /api/history/stats` reports history database counts.
- `GET /api/history/course/:courseId` returns seeded history course metadata.
- `GET /api/history/course/:courseId/offerings` returns known historical offerings for a course.
- `GET /api/history/offering/:offeringId` returns an offering with documents and extracted policies when available.

The browser never reads `OPENROUTER_API_KEY`; only backend OpenRouter code reads it from the server environment.

### Onboarding Prompt Pipeline

First-entry onboarding uses backend prompt routes under `/api/onboarding`. The browser sends PDFs or JSON inputs to the server, the server extracts searchable PDF text with `pdf-parse`, runs the prompt Markdown files through OpenRouter, and returns updated `personal_course.md` content for the browser to save in the signed-in user's Firestore document.

- `POST /api/onboarding/profile` accepts `{ profile, transcriptText?, courseworkText? }` and generates the base `personal_course.md`.
- `POST /api/onboarding/transcript` accepts multipart field `file` plus `profile` JSON and optional `courseworkText`; PDFs are limited to 10MB.
- `POST /api/onboarding/resume` accepts multipart field `file` plus `personalCourseMarkdown`, `profile`, optional background text, and academic evidence.
- `POST /api/onboarding/coursework` accepts `{ profile, transcriptText?, courseworkText }` and refreshes the base course file from imported coursework.
- `POST /api/onboarding/preferences` accepts `{ personalCourseMarkdown, courses }` and applies thumbs-up / neutral / thumbs-down course ratings.
- `POST /api/onboarding/personalization-prefill` accepts `{ profile, personalCourseMarkdown }` and asks the model to infer an initial further-personalization draft from completed courses, course preferences, background, and skill-level sections.
- `POST /api/onboarding/more-preferences` accepts `{ personalCourseMarkdown, questionnaire, freeformNotes?, normalizedData? }` and updates the optional `Course Planning Preferences and Constraints` section. The planner also stores the structured answer under `profile.preferences.personalization` so recommendation ranking can use it directly. If the model is unavailable, the structured profile save still works and Markdown regeneration is skipped or falls back to a deterministic section writer.
- `POST /api/onboarding/personalization-questions` accepts `{ profile, personalCourseMarkdown?, personalization? }` and returns optional model-generated copy for the guided further-personalization flow. The browser keeps a built-in fallback question set, so this endpoint never blocks answering or saving preferences.
- `POST /api/onboarding/personalization-followups` accepts the same personalization context and returns 1-3 optional agent follow-up questions after the fixed guided flow. Users can skip the follow-up; any answers are saved under structured `agentFollowUps` and written into `personal_course.md`.

The server does not store raw uploaded files. OCR for scanned PDFs is not implemented; users need searchable PDFs for transcript/resume parsing.

## Current Catalog Data

Current catalog data lives in `data/courses.json` by default. Override with `CURRENT_CATALOG_PATH` if needed. The file is generated by `scripts/fetch_courses.py`, not hand-authored:

```bash
python3 scripts/fetch_courses.py
```

The script fetches `https://fireroad.mit.edu/courses/all?full=true`, prints the raw course count, then writes only courses that are not historical and are offered in fall or spring:

```python
not course.get("is_historical", False) and (course.get("offered_fall") or course.get("offered_spring"))
```

This means `data/courses.json` is a filtered current catalog snapshot, not a per-semester offering history and not the full Fireroad catalog. Re-run the script when the upstream Fireroad catalog should be refreshed, review the resulting diff, and update this section if the source URL, filtering rule, output path, or schema changes.

## History Database

History data lives in `data/course_history.db` by default. Override with `HISTORY_DB_PATH` if needed.

```bash
npm run history:setup
```

The seed script currently imports the demo `6.*` courses from `shared/mock-data.js` as canonical course rows only. Offerings, documents, attendance policies, grading policies, and extraction runs are schema-ready for future import/fetch/extract jobs.

## Manual History Collection

Course history is offering-first and updated manually from manifests in `data/history_manifests/`.

```bash
npm run history:import-manifest -- 6.3900
npm run history:fetch-docs -- 6.3900
OPENROUTER_API_KEY="your_openrouter_key" npm run history:extract-policies -- 6.3900

# Or run the full manual pipeline:
npm run history:collect -- 6.3900
```

The `/api/history/*` routes are read-only. Chat and planner flows do not write history data.

## Documentation Maintenance

Multiple agents may work in this repository at the same time. Any change that alters setup, data generation, API contracts, product scope, scripts, schemas, prompt assets, or agent behavior must update the relevant docs in the same change (`README.md`, `CLAUDE.md`, prompt files, or the closest domain doc). Treat generated-data provenance, including the `data/courses.json` generation rule above, as maintained project state.
