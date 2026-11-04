# Drafty Engineering — Automated End-to-End QA Report

**Latest authorized production QA:** `prod-qa-0578799-20261104032051`  
**Expected / verified production SHA:** `05787990cdeb663f0d55801a94ed46df8d7f04c3`  
**Batch 10A:** not started  

Historical archives (immutable; do not overwrite):

- `docs/qa/archive/PRODUCTION_QA_REPORT_prod-qa-64578bd-20261104005258.md`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-64578bd-20261104005258.json`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-0578799-20261104032051.json`

---

## Production QA session `prod-qa-0578799-20261104032051` (2026-11-04)

**Authorization:** single controlled production run only. Executed once. No retry / no budget reset / no new run id.

### Preflight

| Check | Result |
|---|---|
| Web deployment `8AeLjnpcr1vfygpernXrjLeftr2c` | Ready / Latest / Production / **Current** — commit `05787990…` — alias `drafty-web-umber.vercel.app` |
| API deployment `Bz6wyJJqNT8YQWENe2GQL4rU2z4x` | Ready / Latest / Production / **Current** — commit `05787990…` — alias `drafty-api.vercel.app` |
| `DRAFTY_QA_REQUIRE_PROD_COMMIT` | `05787990cdeb663f0d55801a94ed46df8d7f04c3` |
| `DRAFTY_QA_BUDGET_RUN_ID` | `prod-qa-0578799-20261104032051` |
| Live flags at start | `RUN_PRODUCTION=true`, `RUN_LIVE_MODAL=true`, `RUN_LIVE_META=true` |
| Concurrent paid QA | none |
| Prior archives preserved | yes |

### Invocation

```text
cd apps/web
npm run test:qa-production
# playwright … --project=qa-production --workers=1 --retries=0
```

Exit code: **1** (fail-stop after geometry failure; remaining tests skipped).

### Per-test results

| # | Test | Status | Notes |
|---|---|---|---|
| 1 | cleanup verified DRAFTY_QA leftover scenarios only | **PASS** | no failed deletes; known leftover IDs already-gone |
| 2 | health and homepage are reachable | **PASS** | health 200; `auth=supabase`, `compute=modal`, `modal=true`, `meta=true`; paid gate ok |
| 3 | auth persistence, rename, reload, and sign-in cycle | **PASS** | |
| 4 | cross-user isolation via authenticated API | **PASS** | |
| 5 | Staunton pawn geometry-only CAD + downloads + cache headers | **FAIL** | Timed out 180s waiting for `/geometry/` GET **200**. UI left **CAD pending**. |
| 6 | classroom demo Euler-Bernoulli analysis and span compare | **DID NOT RUN** | skipped after serial failure |
| 7 | aluminum bracket path (Modal CalculiX FEM) | **DID NOT RUN** | skipped — no FEM job |
| 8 | mocked microphone UI | **DID NOT RUN** | skipped |
| 9 | scenario deletion cleanup policy | **DID NOT RUN** | skipped |
| 10 | optional single Meta turn | **DID NOT RUN** | skipped — no Meta request |

`afterAll` cleanup: **deleted 2** QA-tracked scenarios. Post-run `scenarios` query for `DRAFTY_QA_%`: **empty**.

### Paid operations

| Kind | Authorized | Reservation | Invocation attempt | Completed response | Provider IDs |
|---|---|---|---|---|---|
| Modal geometry | 1 | **1** | **1** | **0** | `modal_call_id` **null** (never attached) |
| Modal CalculiX FEM | 1 | 0 | 0 | 0 | no job id |
| Meta AI turn | 1 | 0 | 0 | 0 | none |

**Billing:** unknown (`billing: {}`, no measured cost fields).

### End-of-session budget file

```json
{
  "used": { "modal_geometry": 1, "modal_fem": 0, "meta": 0 },
  "reservations": { "modal_geometry": 1, "modal_fem": 0, "meta": 0 },
  "invocation_attempts": { "modal_geometry": 1, "modal_fem": 0, "meta": 0 },
  "completed_responses": { "modal_geometry": 0, "modal_fem": 0, "meta": 0 },
  "billing": {},
  "jobIds": [],
  "runId": "prod-qa-0578799-20261104032051"
}
```

### Confirmed cause (geometry FAIL)

Supabase evidence after the timeout (no additional paid spawn attempted by QA):

| Fact | Value |
|---|---|
| `geometry_builds.digest` | `53d01db00c88f42539c2697e82581376d53e36431830216357ea9a50486afcb0` |
| `status` | **`queued`** |
| `charged` | **`true`** |
| `modal_call_id` | **`null`** |
| `error` | null |
| `created_at` / `updated_at` | `2026-11-04 08:29:00.144+00` / `08:29:00.331+00` |
| Profile | `staunton-pawn` (unique height from QA) |
| `preview_charges` | id **4**, owner QA, `charged_at` `2026-11-04 08:29:00.232+00` |

### Post-mortem from Vercel runtime logs (authenticated browser)

Request: `GET /api/v1/scenarios/653b731d-…/geometry/preview.glb`  
Deployment: `dpl_Bz6wyJJqNT8YQWENe2GQL4rU2z4x` · region `gru1` · request id `l4ttc-1793780939373-2fc8dad26626`

Observed stage order at **03:29:00 local / 08:29:00 UTC**:

1. storage miss `geometry/53d01db0…/manifest.json` → **400**
2. `claim_geometry_build_start` → **200**
3. `charge_preview_quota` → **200**
4. `mark_geometry_build_charged` → **200**
5. **No** `attach_geometry_build_call` RPC

Exception (ASGI traceback on the geometry path):

```text
File ".../geometry_cache.py", line 349, in _load_or_progress_remote
  call_id = spawn_remote_geometry(profile.model_dump())
File ".../remote.py", line 314, in spawn_remote_geometry
  call = modal.Function.from_name("drafty-engineering", "generate_revolved").spawn(profile)
modal.exception.NotFoundError: Lookup failed for Function 'generate_revolved'
  from the 'drafty-engineering' app: Function 'generate_revolved' not found
  on App 'drafty-engineering' in environment 'main'.
```

**Root cause:** spawn failed **before** returning a Modal call id (`NotFoundError`). Attachment never ran. Because the exception was uncaught, the durable row stayed `charged=true` / `queued` / `modal_call_id=null`, so later polls returned **202 GeometryPending** during the resume grace window and the UI stayed on **CAD pending / Building the preview** instead of a terminal error.

**Modal dashboard:** Cursor browser hit Modal login — function inventory for `drafty-engineering` could **not** be independently confirmed in-dashboard. Repo source still defines `@app.function … def generate_revolved` in `infra/modal/app.py`; production Modal env `main` does not currently expose that function to the API tokens in use.

**Conclusion:** Not an attach-after-success bug. Charge succeeded; Modal lookup for `generate_revolved` failed; fail-open left an indefinitely pending charged job. FEM and Meta were not attempted (fail-stop).

### Post-run controls

- `DRAFTY_QA_RUN_LIVE_MODAL=false`
- `DRAFTY_QA_RUN_LIVE_META=false`
- Session budget archived at `docs/qa/archive/drafty-qa-paid-budget_prod-qa-0578799-20261104032051.json`
- Batch 10A **not** started

### Ready for Batch 10A?

**No.** Geometry paid path still fails on production under the authorized budget; investigate charge→spawn/attach without starting another paid session until authorized.

---

## Historical — prior paid session `prod-qa-64578bd-20261104005258`

**Production merge commit (prior paid QA):** `64578bd7203a86c156a600d28d4be2e3b43f3d04`  
**Investigation tip (this branch):** see open PR for `fix/prod-qa-geometry-approve-budget`  

### Deploy verification (2026-11-04, prior session)

| Check | Result |
|---|---|
| `origin/main` tip (at paid QA) | `64578bd7203a86c156a600d28d4be2e3b43f3d04` |
| GitHub Actions `ci` on that commit | **PASS** — python, api-bundle, web, e2e all green ([run 41780854121](https://github.com/ybedoyab/drafty-meta/actions/runs/41780854121)) |
| GitHub commit status `Vercel – drafty-web` | **success** |
| GitHub commit status `Vercel – drafty-api` | **success** |
| Production health (`drafty-api.vercel.app`) | **200** — `auth=supabase`, `compute=modal`, `modal_available=true`, `meta=true` |
| Exact SHA on production aliases via Vercel MCP/CLI | **Not independently readable** from this agent account (`ybedoyabs-projects` unauthorized) |

### Production QA session results (prior paid run)

Invocation: `npm run test:qa-production` under budget run id `prod-qa-64578bd-20261104005258`.

| Step | Status | Notes |
|---|---|---|
| Leftover `DRAFTY_QA_*` cleanup | **PASS** | Storage nested-404 delete live |
| Health + homepage / auth / isolation / classroom / delete | **PASS** | |
| One Modal pawn geometry miss → hit | **FAIL** | Budget slot consumed. Timed out 180s waiting for `/geometry/` GET 200. Scenario stuck `CAD pending`. |
| One Modal CalculiX FEM + artifacts | **FAIL (pre-solve)** | Budget slot consumed before solve. Failed waiting for **Approve and open Studio** after Confirm faces (30s). |
| ≤1 Meta turn | **NOT COMPLETED** | Budget reservation burned then harness skipped (`AI not connected` path). |
| Cost | **NOT MEASURED** | `jobIds: []` |

### Budget file (end of prior paid session)

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

### Confirmed root causes (pre-merge)

#### 1. CAD pending / preview quota without artifacts

**Evidence (not speculation):**

| Fact | Source |
|---|---|
| Preview charge at `2026-11-04T05:53:56.321871+00:00` | Supabase `preview_charges` id=3 for QA owner |
| Zero objects under `artifacts/geometry/` after that charge | Supabase Storage list |
| Empty `geometry_build_locks` after the window | Supabase table |
| Production handler charged **then** waited on Modal with `call.get(timeout=50)` and **cancelled** the call on timeout | `geometry_cache.load_or_build_geometry` + `remote.remote_geometry` on `64578bd` |
| Function `maxDuration` 60s; Modal `generate_revolved` timeout 180s | `vercel.json`, `infra/modal/app.py` |
| QA waited 180s for a geometry GET **200** and never saw cache headers | prior `PRODUCTION_QA_REPORT` / Playwright waiter |

**Conclusion (then):** Synchronous HTTP waiting for Modal inside a short-lived serverless request was the reliability failure mode.

**Fix shipped in PR #4:** Durable async geometry builds — claim → charge → spawn → attach call id, return **202** while pending, poll without cancelling, publish digest cache atomically when ready. Frontend polls 202 with a bounded backoff (≤180s). Migrations `0008` + `0009` applied on Supabase.

#### 2. Bracket Approve missing before CalculiX

Prefer upsert on `scenario_versions` required UPDATE; authenticated only had INSERT → 503. Fixed with `Prefer: return=minimal` for version inserts.

#### 3. Meta QA budget accounting

Reserve only after AI-connected check; layered counters for reservations / invocation_attempts / completed_responses.

### Remaining limitations (updated after `prod-qa-0578799-20261104032051`)

- Async path is deployed, but production still observed **charged + queued + `modal_call_id` null** with no completed artifacts within 180s.
- Stale `queued`/`running` builds fail closed after ~10 minutes without auto-spawning; a later client retry may charge again for a new attempt.
- Do not reset archived budget files to “retry” spend.
- Batch 10A not started.
