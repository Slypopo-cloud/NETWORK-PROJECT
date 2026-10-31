# HomeGuard Wi-Fi Management Platform

HomeGuard is a multi-tenant Wi-Fi management platform. This repository contains the Phase 1 project foundation: a portal and dashboard frontend, an API workspace, a worker workspace, shared TypeScript types, and a place for Supabase migrations. Product features are not included yet.

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer

## Install

From the repository root, install the workspace dependencies:

```sh
npm install
```

Copy `.env.example` to `.env` and fill in the values when you have a Supabase project. The API defaults to port `3000`. Never put the Supabase service role key in frontend code or expose it with a `VITE_` variable.

## Run

Start the API, portal, and dashboard together:

```sh
npm run dev
```

The portal runs at `http://localhost:5173`, the dashboard at `http://localhost:5174`, and the API at `http://localhost:3000`. The API health check is `http://localhost:3000/v1/health`.

Run `npm run check:env` to verify required variable presence without displaying values. Keep `ALLOW_DEV_AUTH_PROVISIONING=false` except while running the local provisioning scripts.

## Sign In

Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in the root `.env`. Apply the database migrations and sample seed first. The SQL seed creates profile rows, not Supabase Auth credentials.

Link your Supabase project and apply the numbered migrations:

```sh
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase db seed
```

Review the SAMPLE rows in `supabase/seed.sql` before seeding a remote project. To provision matching Auth users locally, set `ALLOW_DEV_AUTH_PROVISIONING=true` in `.env`, then run `npm run create:dev-users`. It creates a random password per seeded account and writes credentials only to the git-ignored `dev-credentials.local.txt` file. Set the flag back to `false` after provisioning.

Run `npm run enroll:dev-mfa` to enroll TOTP for the platform owner and Support test accounts. Their authenticator secrets are written only to that same local file. Sign in at `http://localhost:5174` with a seeded `@example.test` email and its generated password; enter the saved TOTP code when prompted. The scripts refuse to run when `NODE_ENV=production`. Never use these sample accounts or the service-role key in production.

## Verify

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` runs Vitest tests from every workspace. The API health endpoint has a Supertest integration test.

## Workspaces

- `apps/portal`: Vite, React, TypeScript, and Tailwind CSS starter.
- `apps/dashboard`: Vite, React, TypeScript, and Tailwind CSS starter.
- `apps/api`: Express API with a health endpoint.
- `apps/worker`: TypeScript worker workspace scaffold.
- `packages/shared`: shared TypeScript API types.
- `supabase/migrations`: reserved for database migrations; no schema has been added in this phase.
- `docs`: project documentation and the supplied design board.# NETWORK-PROJECT
# NETWORK-PROJECT
# NETWORK-PROJECT
