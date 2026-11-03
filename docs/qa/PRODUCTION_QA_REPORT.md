# Drafty Engineering — Automated End-to-End QA Report

**Tested baseline commit:** `c55173e2beeafef67dad197cc29544c46c08f8a9` (`main` after PR #1 merge)  
**QA harness branch:** `qa/e2e-live-harness`  
**Report date:** 2026-11-03  
**Batch 10A:** not started  

## Endpoints

| Target | Web | API |
|---|---|---|
| Local | http://127.0.0.1:5173 | http://127.0.0.1:8000 |
| Production | https://drafty-web-umber.vercel.app | https://drafty-api.vercel.app |

## Environment capabilities (observed)

| Capability | Local | Production |
|---|---|---|
| `DRAFTY_AUTH_MODE` | `supabase` (forced for QA; process env had been `disabled`) | `supabase` |
| Supabase API / auth | reachable / configured | reachable / configured |
| Meta configured | true (reachable false in health probe) | true |
| Modal configured / available | false / false | true / true |
| Local CalculiX (`ccx` / `drafty-ccx`) | **unavailable** (Docker Desktop engine error; no `ccx` on PATH) | N/A (expected missing on Vercel; compute=`modal`) |
| `DRAFTY_QA_RUN_LIVE_META` | false | false |
| `DRAFTY_QA_RUN_LIVE_MODAL` | false | false |
| `DRAFTY_QA_RUN_PRODUCTION` | true | true |

## Regression suite (non-live)

| Check | Result |
|---|---|
| Ruff | PASS |
| Pytest non-FEM | PASS (191) |
| Pytest postgres concurrency | NOT RUN locally (disposable Postgres not restarted this session); covered in CI on `main` |
| Pytest FEM / CalculiX | BLOCKED — local solver unavailable |
| Vitest | PASS (23) |
| TypeScript + production build | PASS |
| Existing Playwright (`scenario` / `bracket-fem`) under local `auth=supabase` | BLOCKED — deterministic suite expects unauthenticated local mode (`AI not connected` / open `/scenario/new`). CI behavior preserved (auth disabled). |

## Live QA suite (`apps/web/e2e/qa-live.spec.ts`)

Credentials loaded from repository-root `.env` via `e2e/qa/env.ts`. Passwords / JWTs / service-role secrets are not logged.

### Local (`--project=qa-local`)

| Case | Status | Notes |
|---|---|---|
| Health + homepage (desktop/mobile) | PASS | auth=supabase, solver unavailable, modal=false, meta=true |
| Sign-in, create/rename `DRAFTY_QA_*`, reload, sign-out/in | PASS | Authenticated API GET confirmed ownership |
| Cross-user isolation (API 401/403/404) | PASS | Secondary account cannot GET/rename/DELETE primary scenario |
| Staunton pawn geometry + STEP/STL + cache header | PASS | Second fetch `x-drafty-geometry-cache=hit`; first also `hit` (local shared digest). No FEM started |
| Classroom Euler–Bernoulli + 5 m compare | PASS | 3D FEM disabled; beam-element results shown |
| Aluminum bracket real CalculiX | SKIP | Local CalculiX unavailable |
| Mocked MediaRecorder mic UI | SKIP | Control not visible / not claimed as live ASR |
| Deletion cleanup policy | PASS | `cleanup.geometry_cache=retained`; retry → 404/503 |
| Live Meta (one paid turn) | SKIP | `DRAFTY_QA_RUN_LIVE_META=false` |
| Cleanup teardown | PASS | 5 QA scenarios deleted |

**Local summary:** 6 PASS · 3 SKIP · 0 FAIL  

### Production (`--project=qa-production`)

| Case | Status | Notes |
|---|---|---|
| Health + homepage | PASS | compute=modal, modal=true, solver unavailable (expected), meta=true |
| Auth persistence / rename / reload | PASS | |
| Cross-user isolation | PASS | After signOut hardening |
| Pawn geometry / Modal cache | SKIP | Would require Modal spend; `DRAFTY_QA_RUN_LIVE_MODAL=false` |
| Classroom beam analysis | PASS | |
| Bracket Modal FEM | SKIP | `DRAFTY_QA_RUN_LIVE_MODAL=false` |
| Mocked mic UI | SKIP | |
| Deletion cleanup | PASS | |
| Live Meta | SKIP | flag false |
| Cleanup teardown | PASS | 4 QA resources deleted |

**Production summary:** 5 PASS · 4 SKIP · 0 FAIL  

## Invocation / cost accounting

| Resource | Count | Cost |
|---|---|---|
| Paid Meta requests | 0 | NOT MEASURED / not invoked |
| Paid Modal geometry builds | 0 (prod skipped by flag) | NOT MEASURED |
| Paid Modal CalculiX solves | 0 | NOT MEASURED |
| Paid Modal optimization | 0 | NOT MEASURED |

Live transcription: **NOT TESTED** (mock MediaRecorder only).

## Screenshots

Under `docs/qa/screenshots/` (password fields cleared before capture):

- `local-homepage.png`, `local-homepage-mobile.png`
- `local-projects-after-relogin.png`, `local-pawn-geometry.png`, `local-classroom-beam.png`
- `production-homepage.png`, `production-homepage-mobile.png`
- `production-projects-after-relogin.png`, `production-classroom-beam.png`

## Browser / API errors

- No unexpected 500s on exercised authenticated CRUD paths.
- Production `/api/v1/health` correctly reports local CalculiX missing while Modal is available.
- Local process env initially forced `DRAFTY_AUTH_MODE=disabled` over `.env`; QA restarted with explicit `supabase`.

## Defects

| ID | Sev | Finding |
|---|---|---|
| D1 | P1 | `dev.ps1` aborted startup when Docker engine returned HTTP 500 on `docker image inspect` (`$ErrorActionPreference=Stop`). **Fixed** with try/catch so API/web still start. |
| D2 | P2 | Host/shell `DRAFTY_AUTH_MODE=disabled` overrides `.env` because dotenv loads with `override=False`. Documented; QA forced `supabase` for the live run. |
| D3 | P2 | Deterministic Playwright suite is incompatible with local `auth=supabase` without a login fixture (expected; CI remains auth-disabled). |

## Cleanup

- Only `DRAFTY_QA_*` scenarios created by this run were deleted.
- Shared geometry cache retained per API cleanup policy.
- No unrelated projects or Storage prefixes were wiped.

## Ready for Batch 10A?

**Not yet.** Auth, project CRUD, isolation, classroom beam analysis, local pawn geometry/cache, and production smoke are proven. Remaining before Batch 10A:

1. Restore local CalculiX (Docker Desktop or `ccx` on PATH) and run real FEM benchmarks + bracket E2E.
2. With explicit authorization, set `DRAFTY_QA_RUN_LIVE_MODAL=true` for **one** production geometry + **one** CalculiX solve (no optimization loops).
3. Optionally `DRAFTY_QA_RUN_LIVE_META=true` for **one** Meta turn.
4. Keep CI deterministic suite on auth-disabled runners.

## Implemented vs proven

| Area | Implemented in product | Proven end-to-end in this QA |
|---|---|---|
| Supabase auth + projects | yes | yes (local + production) |
| Cross-user isolation | yes | yes (API-level) |
| Pawn CAD + cache | yes | yes locally; production Modal path skipped by flag |
| Classroom beam analysis | yes | yes (local + production) |
| CalculiX FEM | yes | **not proven** here (no local solver; Modal flag off) |
| Meta AI | yes | **not proven** (flag off) |
| Modal pipeline | yes | health shows available in prod; **job not executed** |
| Scenario delete / geometry retain | yes | yes |
