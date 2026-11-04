# Drafty Engineering — Automated End-to-End QA Report

**Production merge commit (prior paid QA):** `64578bd7203a86c156a600d28d4be2e3b43f3d04`  
**Investigation tip (this branch):** see open PR for `fix/prod-qa-geometry-approve-budget`  
**Batch 10A:** not started  

## Deploy verification (2026-11-04)

| Check | Result |
|---|---|
| `origin/main` tip (at paid QA) | `64578bd7203a86c156a600d28d4be2e3b43f3d04` |
| GitHub Actions `ci` on that commit | **PASS** — python, api-bundle, web, e2e all green ([run 41780854121](https://github.com/ybedoyab/drafty-meta/actions/runs/41780854121)) |
| GitHub commit status `Vercel – drafty-web` | **success** |
| GitHub commit status `Vercel – drafty-api` | **success** |
| Production health (`drafty-api.vercel.app`) | **200** — `auth=supabase`, `compute=modal`, `modal_available=true`, `meta=true` |
| Exact SHA on production aliases via Vercel MCP/CLI | **Not independently readable** from this agent account (`ybedoyabs-projects` unauthorized) |

## Production QA session results (paid run; do not re-run unpaid)

Invocation: `npm run test:qa-production` under budget run id `prod-qa-64578bd-20261104005258`.

| Step | Status | Notes |
|---|---|---|
| Leftover `DRAFTY_QA_*` cleanup | **PASS** | Storage nested-404 delete live |
| Health + homepage / auth / isolation / classroom / delete | **PASS** | |
| One Modal pawn geometry miss → hit | **FAIL** | Budget slot consumed. Timed out 180s waiting for `/geometry/` GET 200. Scenario stuck `CAD pending`. |
| One Modal CalculiX FEM + artifacts | **FAIL (pre-solve)** | Budget slot consumed before solve. Failed waiting for **Approve and open Studio** after Confirm faces (30s). |
| ≤1 Meta turn | **NOT COMPLETED** | Budget reservation burned then harness skipped (`AI not connected` path). |
| Cost | **NOT MEASURED** | `jobIds: []` |

### Budget file (end of paid session)

```json
{
  "used": { "modal_geometry": 1, "modal_fem": 1, "meta": 1 },
  "jobIds": [],
  "runId": "prod-qa-64578bd-20261104005258"
}
```

---

## Investigation (branch `fix/prod-qa-geometry-approve-budget`)

No live Modal or Meta calls were made during this investigation.

### Confirmed root causes

#### 1. CAD pending / preview quota without artifacts

**Evidence (not speculation):**

| Fact | Source |
|---|---|
| Preview charge at `2026-11-04T05:53:56.321871+00:00` | Supabase `preview_charges` id=3 for QA owner |
| Zero objects under `artifacts/geometry/` after that charge | Supabase Storage list |
| Empty `geometry_build_locks` after the window | Supabase table |
| Production handler charged **then** waited on Modal with `call.get(timeout=50)` and **cancelled** the call on timeout | `geometry_cache.load_or_build_geometry` + `remote.remote_geometry` on `64578bd` |
| Function `maxDuration` 60s; Modal `generate_revolved` timeout 180s | `vercel.json`, `infra/modal/app.py` |
| QA waited 180s for a geometry GET **200** and never saw cache headers | `PRODUCTION_QA_REPORT` / Playwright waiter |

**Conclusion:** Synchronous HTTP waiting for Modal inside a short-lived serverless request is the reliability failure mode. Quota was charged on the miss path before artifacts could be published; the sync wait + cancel prevented durable completion. Vercel team logs for `ybedoyabs-projects` were not readable from this agent; the charge/storage/code evidence is sufficient to classify this as sync-wait reliability (not a frontend-only bug).

**Fix:** Durable async geometry builds — charge + spawn Modal, persist `geometry_builds` status + `modal_call_id`, return **202** while pending, poll without cancelling, publish digest cache atomically when ready. Frontend polls 202 with a bounded backoff (≤180s). Migration `0008_geometry_builds.sql` required on Supabase before production retest.

#### 2. Bracket Approve missing before CalculiX

**Evidence (reproduced against live production API, no Modal/solver):**

1. `POST /scenarios/demo` (bracket) → **200**, missing faces only.
2. `POST /scenarios/{id}/faces` → **503** `"The scenario was not saved."`
3. Remote `scenarios.state` **did** contain `studio_spec` after the 503 (main upsert succeeded).
4. Direct `scenario_versions` INSERT with `Prefer: resolution=merge-duplicates` → **403** needing `GRANT UPDATE ON scenario_versions` (authenticated only has INSERT).
5. Same INSERT with `Prefer: return=minimal` → **201**.

**Conclusion:** `mirror_scenario(..., snapshot=True)` reused upsert Prefer headers on `scenario_versions`. Confirm faces / approve snapshot writes failed closed with 503 even though the scenario row was updated — the UI never received `studio_spec`, so **Approve and open Studio** never appeared.

**Fix:** Version inserts use `Prefer: return=minimal` only. Deterministic e2e: Load Bracket Demo → Confirm faces → Approve → Open Studio.

#### 3. Meta QA budget accounting

**Evidence:** Production Meta test called `tryConsume("meta")` **before** checking `AI not connected`, so a skipped target still counted as a paid reservation.

**Fix:** Check AI availability first; reserve only when connected. Budget file now records separately: `reservations`, `invocation_attempts`, `completed_responses`, and optional `billing` (`used` remains an alias of reservations for older readers).

### Changes made

- `apps/api/src/drafty_api/storage.py` — snapshot Prefer fix; geometry build RPCs
- `apps/api/src/drafty_api/geometry_cache.py` — async durable production builds (`GeometryPending`)
- `apps/api/src/drafty_api/remote.py` — `spawn_remote_geometry` / `poll_remote_geometry` (no cancel on poll timeout)
- `apps/api/src/drafty_api/scenarios.py` — geometry **202** pending responses
- `apps/web/src/lib/api.ts` — bounded 202 polling for geometry blobs
- `apps/web/e2e/qa/budget.ts` + `qa-live.spec.ts` — Meta gate before reserve; layered counters
- `apps/web/e2e/scenario.spec.ts` — demo → faces → Approve → Studio
- `supabase/migrations/0008_geometry_builds.sql` — durable build rows
- Tests for Prefer headers + async geometry spawn/poll

### Regression tests run locally (no live Modal/Meta)

| Check | Result |
|---|---|
| `pytest -m "not fem and not postgres"` | **200 passed** |
| `pytest -m fem` | **9 passed** |
| `pytest` auth + production hardening (incl. async geometry + Prefer) | **passed** |
| API bundle `from app import app` | **ok** |
| `ruff check packages apps tests` | **passed** |
| `npm test` (Vitest) | **28 passed** |
| `npm run build` (tsc + vite) | **passed** |
| Playwright `e2e/scenario.spec.ts` (local API, auth disabled) | **12 passed** (includes new Approve path) |
| GitHub Actions | Opened with this PR (do not merge/deploy automatically) |

### Actual provider invocation evidence (investigation)

| Provider | Invocations during investigation |
|---|---|
| Modal | **0** (no spawn / no paid geometry or FEM) |
| Meta | **0** |
| Production API (diagnostic only) | Bracket demo/faces/approve/delete against `drafty-api.vercel.app` to confirm 503 Prefer bug; no CalculiX |

### Remaining limitations

- Migration `0008_geometry_builds` **applied** to Supabase project `dwwwyuybbwihpizdrhqp` during investigation (DDL only; unused until API deploy).
- Deploy API + web from this PR before retest; Prefer fix and 202 geometry path are not live until then.
- One separately authorized, controlled production retest only — do not reset the prior budget file to “retry” spend.
- Vercel/`ybedoyabs-projects` runtime logs remain unread from this agent account.
- Batch 10A not started.

## Ready for Batch 10A?

**No.** Fixes are ready for review and one separately authorized production retest after merge/deploy + migration 0008.
