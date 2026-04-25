# agent.md

This file records the parser and inference contracts for the onboarding flow. Prompt details can be added here once the backend parser is ready.

## Onboarding Parse Flow

1. Basic profile is mandatory: name, major or intended major, future-program placeholder, standing, and optional GPA for non-prefrosh users.
2. Transcript upload is optional and skipped for prefrosh users. A parser should extract course id, course name when available, term, grade, units, and dropped/in-progress markers.
3. Resume upload is optional. A parser should preserve the file reference and infer interests, projects, competition background, awards, work experience, and skill-level evidence.
4. Coursework import is optional and skipped for prefrosh users. The prototype currently parses pasted MIT subject numbers from Fireroad text, CSV text, or a manual list.
5. Skill level is requested only when transcript, resume, and coursework signals are all absent. Otherwise the backend should infer it.
6. Course-feel calibration is skipped for prefrosh users. For every parsed completed course, collect `like`, `neutral`, or `dislike`; default is `neutral`.

## Output Contract

All parsers should merge into the same `personalcourse.md` schema:

- `Basic Info`: stable student-level fields.
- `Inputs`: source files or import sources.
- `Courses`: completed, dropped, in-progress, and planned courses.
- `Preferences`: explicit user preferences plus inferred background signals.

