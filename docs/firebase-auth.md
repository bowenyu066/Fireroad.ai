# Firebase Auth Persistence

This branch adds an auth/data layer for first-entry onboarding.

## Local Development

Run the app normally:

```bash
npm start
```

If Firebase environment variables are not set, the app uses localStorage-backed mock auth. Mock auth still requires an `@mit.edu` email by default, so use addresses like `test@mit.edu`.

## Firebase Configuration

This repo currently commits the shared Firebase Web config in `.env` so the team can test the same auth project without extra setup. If `.env` is missing in a fresh environment, copy `.env.example` to `.env`, then set these environment variables before starting the server:

```bash
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
npm start
```

Optional switches:

```bash
FIREBASE_REQUIRE_MIT_EMAIL=true
FIREBASE_REQUIRE_EMAIL_VERIFICATION=false
FIREBASE_ALLOW_NON_MIT_EMAILS=false
```

Do not add Firebase Admin SDK private keys, service-account JSON, OpenRouter keys, or other backend secrets to `.env`; use a private deployment secret store for those.

## Firestore Shape

The app writes one document per user:

```text
users/{uid}
```

Fields include:

- `email`
- `onboardingCompleted`
- `profile`
- `fourYearPlan`
- `activeSem`
- `onboarding`
- `personalCourseMarkdown`
- `schemaVersion`

Transcript and resume parsers can later write their results into the same user document or split them into subcollections without changing the current login flow.
