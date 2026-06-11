# Project Overview

This repository is the JTBC News Camera Hub internal portal. It uses Next.js 15 App Router, React 19, Supabase Auth/PostgREST/Storage/RLS, and Vercel. The main product areas are login, home news/notice surfaces, work schedules, vacation requests and lottery management, best-report review, equipment, team-lead tools, admin, election, weather, and my-page workflows.

Claude Code should also read the shared project playbook: `@docs/ai-instructions.md`. The content below is self-contained so Claude Code does not need to assume that `AGENTS.md` is automatically loaded.

# How Claude Code Should Work

- Read the relevant files before editing.
- Keep changes small and aligned with existing patterns.
- Check blast radius before changing schedules, vacation, Assembly integration, election, permissions, Supabase queries, or RLS.
- Do not break existing behavior to simplify a task.
- Do not hide failed tests or validation failures.
- Do not perform large refactors unless the user explicitly asks for them.
- Do not read, print, or document `.env.local` values, tokens, service role keys, SMTP passwords, or other secrets.
- Do not run destructive git commands, force push, or apply live DB changes without explicit human approval.
- If a Codex-only agent cannot be called from Claude Code, reproduce that agent's role as a checklist/self-review using this file, `docs/AGENT_MAP.md`, and `.codex/agents/*.toml`.

# Important Files

- `AGENTS.md`: Codex routing map and project boundaries.
- `docs/ai-instructions.md`: shared AI playbook for Codex and Claude Code.
- `docs/README.md`: documentation index.
- `docs/architecture/boundaries.md`: app/components/lib/API/Supabase boundaries.
- `docs/architecture/dependency-rules.md`: allowed and forbidden dependency directions.
- `docs/SUPABASE.md`: Supabase/RLS principles.
- `docs/SECURITY.md`: secret and server-only rules.
- `docs/FRONTEND.md`: frontend shell and mobile rules.
- `docs/agent-harness/review-loop.md`: validation loop.
- `docs/generated/*.md`: generated route/env/supabase/package/dependency maps. Regenerate with harness scripts; do not edit directly.
- `app/(public)/login/page.tsx`: public login page.
- `app/(portal)/layout.tsx`: protected portal layout.
- `app/api/**/route.ts`: server API routes.
- `components/auth/auth-gate.tsx`: session, approval, and access gating.
- `components/portal-shell.tsx`: portal shell, menu, user display, theme, logout.
- `middleware.ts`: lightweight protected-route cookie check.
- `components/schedule/schedule-app.tsx`: main DESK schedule UI.
- `components/schedule/published-schedules-panel.tsx`: published schedule display.
- `components/team-lead/schedule-assignment-page.tsx`: team-lead schedule assignment UI.
- `lib/schedule/engine.ts`: core schedule generation and transformation logic.
- `lib/schedule/storage.ts`: schedule state storage.
- `lib/schedule/published.ts`: published schedule storage.
- `lib/schedule/assembly-sync.ts` and `lib/schedule/assembly-sync-core.ts`: Assembly sync.
- `lib/schedule/assembly-leave-push.ts` and `lib/schedule/assembly-leave-push-core.ts`: Assembly compensatory leave push.
- `lib/vacation/storage.ts`: vacation request, lottery, and schedule-apply logic.
- `app/(portal)/vacation/page.tsx`: user vacation request page.
- `app/(portal)/schedule/vacations/page.tsx`: DESK vacation management and lottery page.
- `components/election/` and `lib/election/`: election UI and domain logic.
- `components/team-lead/` and `lib/team-lead/`: team-lead workflows.
- `components/equipment/` and `lib/equipment/`: equipment pages and storage.
- `components/weather/`, `lib/weather/`, and `app/api/weather/**`: weather and rain dispatch recommendation.
- `components/home/` and `lib/home-news/`: home news briefing and notices.
- `lib/supabase/client.ts`, `server.ts`, `portal.ts`, `admin.ts`: Supabase helpers by runtime boundary.
- `supabase/schema.sql` and `supabase/incremental_*.sql`: schema, RLS, and incremental SQL.
- `tests/*.spec.ts`: Playwright e2e tests.
- `scripts/harness/*.mjs`: validation and generated-doc scripts.
- `.codex/agents/*.toml`: Codex agent role definitions for reference/self-review.

# Commands

Root commands from `package.json`:

- `npm run dev`: run Next.js dev server.
- `npm run build`: production build.
- `npm run start`: run built app.
- `npm run lint`: ESLint.
- `npm run test:e2e`: Playwright e2e test suite.
- `npm run debug:rebalance`: schedule rebalance debug script.
- `npm run audit:legacy-home-dataurl`: legacy home data URL audit.
- `npm run migrate:home-community-attachments`: home community attachment migration helper.
- `npm run harness:all`: full harness.
- `npm run harness:generate`: regenerate route/env/supabase/package generated docs.
- `npm run harness:docs`: check doc links and generated freshness.
- `npm run harness:boundaries`: boundary checks.
- `npm run harness:quality`: quality score.
- `npm run harness:routes`: generate route map.
- `npm run harness:env`: generate env map.
- `npm run harness:supabase`: generate Supabase map.
- `npm run harness:supabase-grants`: Supabase grants check.
- `npm run harness:scripts`: generate package script map.

Root `package.json` does not define `typecheck` or `npm test`. Do not invent those commands.

Backend commands from `backend/package.json` must be run from `backend/`:

- `npm run build`
- `npm run start`
- `npm run start:dev`
- `npm run start:debug`
- `npm run lint`
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:deploy`
- `npm run prisma:seed`
- `npm test` currently only prints that automated tests are not configured.

# Validation / Harness

- Documentation-only changes: run `npm run harness:docs`. If generated docs are touched or regenerated, run `npm run harness:all`.
- App Router, API, route group, or import-boundary changes: run `npm run harness:boundaries`, `npm run lint`, and preferably `npm run build`.
- Supabase, schema, RLS, grants, or env changes: run `npm run harness:supabase`, `npm run harness:supabase-grants`, `npm run harness:env`, and `npm run harness:boundaries`. Do not apply SQL to a live DB without human approval.
- Schedule/vacation/Assembly changes: run `npm run lint`, `npm run build`, and relevant e2e tests with `npm run test:e2e -- tests/<file>.spec.ts`.
- Useful schedule tests include `tests/schedule-edit-desktop.spec.ts`, `tests/schedule-edit-mobile.spec.ts`, `tests/schedule-mobile-layout.spec.ts`, `tests/schedule-general-auto-sync.spec.ts`, `tests/schedule-settings-month-change.spec.ts`, `tests/schedule-weekday-holiday-category-drag.spec.ts`, and `tests/work-schedule-change-request.spec.ts`.
- Print changes: run `npm run test:e2e -- tests/print.spec.ts` and do a manual print-preview check when possible.
- Equipment/corporate-card changes: check `tests/corporate-card-memo.spec.ts` when relevant.
- Browser-only visual flows may require an approved login session. If not available, say so.

# Agent Roles

Claude Code may not be able to call Codex internal agents. Use these as role checklists instead.

## project_mapper

Map related routes, components, lib functions, Supabase queries, auth and permission flows before implementation.

## harness-architect

Review docs, harness scripts, generated docs, Windows/CI compatibility, and boundary automation.

## docs-gardener

Keep `AGENTS.md`, `CLAUDE.md`, docs, generated rules, changelog guidance, and tech-debt tracking coherent.

## nextjs-vercel-guardian

Protect Next.js App Router structure, route groups, `middleware.ts`, layouts, route handlers, Vercel build safety, and CI assumptions.

## frontend-boundary-guardian

Check component/client boundaries, server-only env leakage, PortalShell/AuthGate dependency rules, and mobile impact.

## ui_architect

Review responsive UI, tables, schedules, mobile layout, text overflow, highlights, print output, and existing design tone.

## db_rls_guard

Review Supabase tables, columns, indexes, policies, role access, `profiles.role`, `approved`, and service-role safety. Read-only unless separately approved.

## supabase-security-guardian

Review Supabase Auth, PostgREST, Storage, RLS, server-only secrets, and client/server boundaries.

## performance_guard

Review Supabase call count, egress, duplicate fetches, heavy home initial loads, and unnecessary full-month or full-user queries.

## feature_planner

Break new features into safe first implementation, later extensions, required screens, data needs, and permission flow.

## implementer

Apply the smallest safe change after analysis. Do not refactor unrelated code.

## reviewer

Review final diff for regressions, auth/RLS mistakes, mobile UI breakage, type risk, performance risk, and missing tests.

## quality-verifier

Run and interpret harness, lint, build, and e2e validation. Classify failures as new or pre-existing.

# When To Use Each Agent Role

- Start of any non-trivial task: `project_mapper`.
- Documentation or harness work: `docs-gardener` and `harness-architect`.
- Next.js route, layout, API, middleware, build, or Vercel work: `nextjs-vercel-guardian`.
- Supabase query/RLS/schema/service-role/env work: `db_rls_guard` and `supabase-security-guardian`.
- UI, mobile, print, table, schedule display, and highlight work: `ui_architect` and `frontend-boundary-guardian`.
- Home initial load, egress, repeated fetch, or large query work: `performance_guard`.
- New feature planning: `feature_planner`.
- Before final response: `reviewer` and `quality-verifier`.

# Safety Rules / Do Not Change

- Do not unnecessarily alter `app/(public)`, `app/(portal)`, or `app/api` structure.
- Touch `middleware.ts`, `components/auth/auth-gate.tsx`, and `components/portal-shell.tsx` only when necessary.
- Do not arbitrarily change Supabase Auth, RLS, `profiles.role`, or `approved` flow.
- Do not solve bugs by weakening RLS.
- Keep service role/admin clients on server-only paths.
- Do not add heavy Supabase fan-out or full-month schedule fetches to the home initial load.
- Do not casually alter published schedule data, vacation/compensatory leave calculation, Assembly integration, existing migrations, or environment-variable handling.
- Do not edit `docs/generated/**` directly. Regenerate through harness scripts.
- Do not write secret values to docs, logs, commits, or final reports.

# Environment Variables

Use names only; never expose values. See `docs/generated/env-map.md`, `.env.example`, and `backend/.env.example`.

Client-exposed:

- `NEXT_PUBLIC_E2E`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_PORTAL_DEBUG_TRAFFIC`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`

Server-only or backend/runtime:

- `APP_ORIGIN`
- `ASSEMBLY_EXPORT_API_URL`
- `ASSEMBLY_EXPORT_TOKEN`
- `ASSEMBLY_LEAVE_APPLY_URL`
- `CRON_SECRET`
- `DATABASE_URL`
- `DATA_GO_KR_SERVICE_KEY`
- `EMAIL_FROM`
- `HOME_NEWS_EXTERNAL_FEEDS`
- `HUB_ASSEMBLY_SYNC_TOKEN`
- `HUB_TO_ASSEMBLY_TOKEN`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_EXPIRES_IN`
- `JWT_REFRESH_SECRET`
- `KMA_APIHUB_AUTH_KEY`
- `MAIL_LOG_ONLY`
- `NODE_ENV`
- `OPENAI_API_KEY`
- `OPENAI_NEWS_DRAFT_MODEL`
- `PORT`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_LOGIN_ID`
- `SEED_ADMIN_NAME`
- `SEED_ADMIN_PASSWORD`
- `SMTP_HOST`
- `SMTP_PASS`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VERCEL_USAGE_DEBUG`

# Output Style

Report in Korean unless the user asks otherwise. Include:

- Changed files
- Why the change was made
- What changed
- Impact on existing behavior
- Commands run
- Test/validation results
- Failed commands and whether they seem related to the change
- Remaining risk
- Deployment or manual-check notes

Do not create commits unless the user explicitly asks for one.
