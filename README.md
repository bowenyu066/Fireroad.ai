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

## API

- `GET /api/health` checks server status and whether an OpenRouter key is configured.
- `POST /api/chat` accepts `{ messages, profile, schedule }` and returns an agent message plus validated `uiActions`.

The browser never reads `OPENROUTER_API_KEY`; only `server.js` uses it.
