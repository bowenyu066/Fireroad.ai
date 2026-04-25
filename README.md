# Fireroad.ai Prototype

Static React prototype served by a tiny Node/Express backend. The backend keeps the OpenRouter key server-side and exposes a tool-calling course-planning chat route.

## Setup

```bash
npm install
export OPENROUTER_API_KEY="your_openrouter_key"
# Optional:
export OPENROUTER_MODEL="openai/gpt-4.1-mini"
npm run dev
```

Open http://localhost:3000.

`npm run dev` initializes and seeds the local history database before starting the server.

## API

- `GET /api/health` checks server status and whether an OpenRouter key is configured.
- `POST /api/chat` accepts `{ messages, profile, schedule }` and returns an agent message plus validated `uiActions`.
- `GET /api/history/stats` reports history database counts.
- `GET /api/history/course/:courseId` returns seeded history course metadata.
- `GET /api/history/course/:courseId/offerings` returns known historical offerings for a course.
- `GET /api/history/offering/:offeringId` returns an offering with documents and extracted policies when available.

The browser never reads `OPENROUTER_API_KEY`; only `server.js` uses it.

## History Database

History data lives in `data/course_history.db` by default. Override with `HISTORY_DB_PATH` if needed.

```bash
npm run history:setup
```

The seed script currently imports the demo `6.*` courses from `shared/mock-data.js` as canonical course rows only. Offerings, documents, attendance policies, grading policies, and extraction runs are schema-ready for future import/fetch/extract jobs.
