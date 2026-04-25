# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

There is no build step and no package manager. Open `index.html` directly in a browser, or serve it with any static file server to avoid CORS issues when loading local scripts:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

The app runs fully in-browser: React 18, ReactDOM, and Babel standalone are loaded from CDN via `<script>` tags in `index.html`. JSX is transpiled at runtime by Babel.

## Architecture

**No bundler. No npm. No build.** All JavaScript files are loaded as ordered `<script>` tags in `index.html`:

1. `data.js` — mock data layer, exposed as `window.FRDATA`
2. `components/shared.jsx` — design system primitives (`Icon`, `Logo`, `MatchBar`, `AreaDot`, `ThemeToggle`, `TopBar`) and the `AppCtx` React context; all exported to `window`
3. `components/onboarding.jsx` — 3-step onboarding flow
4. `components/schedule.jsx` — `SchedulePanel`, `CalendarView`, `FourYearPlan`
5. `components/agent.jsx` — `AgentPanel` (chat), `Recommendations` panel
6. `components/course-detail.jsx` — full course detail view
7. `app.jsx` — root `App` component and `Planner` layout; renders into `#root`

**Load order matters.** Each file uses `/* global ... */` comments to declare its dependencies from earlier scripts, and exports its own components to `window` at the bottom (e.g., `window.AgentPanel = AgentPanel`). Never reorder the script tags.

## State and Routing

- **Global state** lives in `App` via `useState`: `theme`, `route`, `profile`, `schedule`, `messages`
- **Routing** is a plain object `{ name: 'onboarding' | 'planner' | 'course', id? }` stored in `route` state — no router library
- **Context** (`AppCtx`) provides `theme`, `setTheme`, `route`, `setRoute`, `profile`, `setProfile` to all components via `useApp()`
- Theme is persisted to `localStorage` under the key `fr-theme`

## Data Layer (`FRDATA`)

`window.FRDATA` (defined in `data.js`) is the single source of truth for all mock data:

- `FRDATA.catalog` — array of course objects with `id`, `name`, `units`, `schedule`, `days`, `time`, `satisfies`, `prereqs`, `hydrant`, `rating`, `topics`, `area`
- `FRDATA.profile` — mock student profile (taken courses, preferences, calibration, remaining requirements)
- `FRDATA.matchScores` — match score breakdown per course (`total`, `interest`, `workload`, `reqValue`)
- `FRDATA.fourYearPlan` — semester-keyed object mapping semesters (`'F23'`…`'S27'`) to course ID arrays
- `FRDATA.getCourse(id)` / `FRDATA.getMatch(id)` — lookup helpers

Course `area` is computed from course ID prefix: `6.` → `cs`, `18.` → `math`, `8.` → `physics`, `7.` → `bio`, HASS-prefix numbers → `hass`.

## Design System

All design tokens are CSS custom properties in `styles.css`. Accent color is MIT red (`#A31F34`). Dark mode is default; light mode swaps values under `[data-theme="light"]`.

Key utility classes: `.mono` (JetBrains Mono), `.display` (Space Grotesk), `.eyebrow` (mono uppercase label), `.btn`, `.btn-primary`, `.btn-ghost`, `.match-bar`, `.fade-in`, `.slide-up`.

Course area colors follow the pattern `var(--course-cs)`, `var(--course-math)`, etc.

## Backend Integration Points

The app is currently fully mocked. Stubbed integration points to wire up later:

- `AgentPanel` (`components/agent.jsx`): `mockAgentReply()` replaces `window.fireroadSocket?.emit('chat', ...)` — the commented socket call shows the intended pattern
- Match scores in `FRDATA.matchScores` should come from `POST /api/score-courses`
- Transcript parsing in `Onboarding` Step 2 uses a `setTimeout` to simulate `POST /api/parse-transcript`
- The workload estimate in `CourseDetail` uses `profile.calibration` (0–1 float) — calibration should eventually be computed server-side

## Key Constraints

- Minimum viewport is 1100px wide (`body { min-width: 1100px }`); mobile layout is not supported
- The `?v=2` cache-busting query params on all local script/stylesheet URLs must be bumped manually when making changes that might be cached
