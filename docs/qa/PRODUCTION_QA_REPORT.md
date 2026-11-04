# Drafty Engineering — Automated End-to-End QA Report

**Latest authorized production QA:** `fem-only-145e1c37-20261104103205` (FEM-only)  
**Expected / verified production SHA:** `145e1c37f4c05334a31c98808e85ad092021c407`  
**Batch 10A:** not started  
**Meta AI:** not run  

Historical archives (immutable; do not overwrite):

- `docs/qa/archive/PRODUCTION_QA_REPORT_prod-qa-64578bd-20261104005258.md`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-64578bd-20261104005258.json`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-0578799-20261104032051.json`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-4fbd50b-20261104042159.json`
- `docs/qa/archive/drafty-qa-paid-budget_fem-only-145e1c37-20261104103205.json`

---

## Production FEM-only session `fem-only-145e1c37-20261104103205` (2026-11-04)

**Authorization:** exactly **one** paid Modal FEM (`run_simulation`). Zero CAD. Zero Meta. Zero optimization. Zero retries. Evidence retained (`DRAFTY_QA_RELEASE_RETAINED` unset).

### Preflight

| Check | Result |
|---|---|
| Production SHA | `145e1c37f4c05334a31c98808e85ad092021c407` (PR #9) on both aliases — Ready / Current / Latest |
| `DRAFTY_QA_REQUIRE_PROD_COMMIT` | `145e1c37f4c05334a31c98808e85ad092021c407` |
| `DRAFTY_QA_BUDGET_RUN_ID` | `fem-only-145e1c37-20261104103205` |
| Live flags | `RUN_PRODUCTION=true`, `RUN_LIVE_MODAL=true` (session only), `RUN_LIVE_META=false` |
| Focused filter | `-g "aluminum bracket path"` → 1 test listed |
| Prior budgets | preserved under `docs/qa/archive/` |

### Invocation

```powershell
cd apps/web
$env:DRAFTY_QA_RUN_PRODUCTION="true"
$env:DRAFTY_QA_RUN_LIVE_MODAL="true"
$env:DRAFTY_QA_RUN_LIVE_META="false"
$env:DRAFTY_QA_REQUIRE_PROD_COMMIT="145e1c37f4c05334a31c98808e85ad092021c407"
$env:DRAFTY_QA_BUDGET_RUN_ID="fem-only-145e1c37-20261104103205"
npm run test:qa-production -- -g "aluminum bracket path"
# playwright … --workers=1 --retries=0
```

Playwright exit code: **1** (UI assertion after successful solve; **no** additional paid retry).

### Evidence captured at submit (before poll / reports)

| Field | Value |
|---|---|
| Scenario ID | `4b032aac-f23d-438e-9a58-237ce83f5e2b` |
| Scenario name | `DRAFTY_QA_bracket_2026-11-04T15-37-41` |
| Job ID | `4f8ed6cc-7d26-4a53-ba2a-ba1569ab4933` |
| Compute | `modal` |
| Retained | **yes** (`afterAll` deleted **0**) |
| Evidence files | `docs/qa/evidence/fem-evidence_fem-only-145e1c37-20261104103205.json`, `docs/qa/evidence/retained-scenarios.json` |

### Playwright result

| Step | Status | Notes |
|---|---|---|
| Load Bracket Demo (no CAD generation) | **PASS** | demo geometry; zero Modal geometry |
| POST `/api/v1/jobs` (Modal FEM) | **PASS** | job id recorded immediately |
| Poll to `completed` + `/results` + report fetch in helper | **PASS** (reached) | failure occurred **after** reload UI step |
| Re-open Results cell after `page.reload()` | **FAIL** | `getByRole('cell', { name: '4f8ed6cc' })` not visible within 30s; page restored to Design/Part |

**Blocker (Playwright only):** post-reload Studio Results table did not show the job id cell. Solver/API path had already completed. **Not** a second Modal invocation. **Not** a report 404.

### Paid operations (provider accounting)

| Kind | Authorized | Reservation | Invocation attempt | Completed response (budget counter) | Provider / IDs |
|---|---|---|---|---|---|
| Modal geometry (CAD) | 0 | **0** | **0** | **0** | none |
| Modal CalculiX FEM | 1 | **1** | **1** | **0*** | job `4f8ed6cc-…` · `compute=modal` · status **completed** |
| Meta AI | 0 | **0** | **0** | **0** | none |
| Optimization | 0 | — | — | — | none |

\*Historical archive `completed_responses.modal_fem=0` is **preserved as recorded** — the counter was only incremented after the full E2E helper returned, so a post-reload **UI** failure left the provider counter at 0. **Confirmed provider completion (separate from that archive field):** Modal job `4f8ed6cc-…` status `completed`; CalculiX C3D10; results/report.json/report.pdf all HTTP 200. A UI failure must not be read as a failed Modal computation.

**Billing:** unknown (`billing: {}`).

**Accounting correction (future runs):** `completed_responses` is recorded at solver/artifact verification (`onSolverArtifactsVerified`), before reload UI. `ui_assertions` records Studio restoration separately. Historical archives are not rewritten.

### End-of-session budget file

```json
{
  "used": { "modal_geometry": 0, "modal_fem": 1, "meta": 0 },
  "reservations": { "modal_geometry": 0, "modal_fem": 1, "meta": 0 },
  "invocation_attempts": { "modal_geometry": 0, "modal_fem": 1, "meta": 0 },
  "completed_responses": { "modal_geometry": 0, "modal_fem": 0, "meta": 0 },
  "billing": {},
  "jobIds": ["4f8ed6cc-7d26-4a53-ba2a-ba1569ab4933"],
  "runId": "fem-only-145e1c37-20261104103205"
}
```

Archived at `docs/qa/archive/drafty-qa-paid-budget_fem-only-145e1c37-20261104103205.json`.

### Read-only post-checks (same job ID — zero new Modal)

Authenticated GETs only against production API. Artifact dump: `docs/qa/evidence/fem-readonly-verify_fem-only-145e1c37-20261104103205.json`.

| Check | Result |
|---|---|
| `GET /jobs/{id}` | **200** · `status=completed` · `compute=modal` · `kind=simulation` |
| `GET /jobs/{id}/results` (`results.json`) | **200** · CalculiX · C3D10 · 31795 nodes / 18980 elems |
| Equilibrium | **passed=true** |
| Stress / displacement | `max_displacement_m≈1.304e-7` · `governing_von_mises_pa≈6.651e5` · `max_von_mises_pa≈2.037e6` |
| Validation | `validation_status=solver_completed` · **5** informational warnings |
| `GET …/artifacts/report.json` | **200** · `report=drafty-engineering` · contains CalculiX |
| `GET …/artifacts/report.pdf` | **200** · `application/pdf` · 2082 bytes · magic `%PDF-` |
| Fresh auth + re-GET results / report.json / report.pdf | all **200** · PDF still 2082 bytes |
| Scenario still present | **200** · name unchanged · **retained** |

Warnings (summary): nodal FRD stresses; corner-triangle contour; peak includes fixed-face singularity; FoS exploratory; no closed-form benchmark.

### Verdict

| Claim | Status |
|---|---|
| ≤1 Modal FEM | **MET** (exactly 1) |
| 0 CAD / 0 Meta / 0 optimization / 0 retries | **MET** |
| Job + Storage artifacts durable after UI failure | **MET** |
| `report.json` / `report.pdf` via production API | **PASS** |
| Playwright full UI path after reload (original helper) | **FAIL** — did not open **Jobs queue** after reload (`bottomPanel` defaults to `edit`) |
| Existing-job UI reopen (Jobs queue → select → Results) | **PASS** (read-only; 0 POST /jobs) — Governing von Mises visible |
| Evidence retention | **PASS** (scenario + job kept) |

**Root cause (confirmed):** E2E clicked Run→Results after reload without selecting the bottom **Jobs queue** tab. Jobs table is only rendered when `bottomPanel === "jobs"`. Production UI restores correctly when that tab is opened.

**Overall — FEM computation / artifacts:** **FULL PASS**.  
**Overall — original Playwright helper path:** **FAIL** (test bug, fixed in follow-up PR; not a Modal failure).  
No further paid calls. Batch 10A not started. Meta-only QA still pending (not authorized).

### Post-run controls

- Process live Modal flag was session-scoped; repo `.env` remains `DRAFTY_QA_RUN_LIVE_MODAL=false` / `DRAFTY_QA_RUN_LIVE_META=false`
- Do **not** set `DRAFTY_QA_RELEASE_RETAINED` until explicit cleanup authorization
- Retained scenario: `4b032aac-f23d-438e-9a58-237ce83f5e2b`
- Retained job: `4f8ed6cc-7d26-4a53-ba2a-ba1569ab4933`

---

## Prior production QA session `prod-qa-0578799-20261104032051` (2026-11-04)

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

**Conclusion:** Charge succeeded; Modal lookup for `generate_revolved` failed; fail-open left an indefinitely pending charged job. FEM and Meta were not attempted (fail-stop). Later fixed/deployed on subsequent SHAs; CAD later passed on `prod-qa-4fbd50b-…`.

### Post-run controls (that session)

- `DRAFTY_QA_RUN_LIVE_MODAL=false`
- `DRAFTY_QA_RUN_LIVE_META=false`
- Session budget archived at `docs/qa/archive/drafty-qa-paid-budget_prod-qa-0578799-20261104032051.json`
- Batch 10A **not** started

---

## Historical — prior paid session `prod-qa-64578bd-20261104005258`

**Production merge commit (prior paid QA):** `64578bd7203a86c156a600d28d4be2e3b43f3d04`

### Production QA session results (prior paid run)

| Step | Status | Notes |
|---|---|---|
| Leftover `DRAFTY_QA_*` cleanup | **PASS** | Storage nested-404 delete live |
| Health + homepage / auth / isolation / classroom / delete | **PASS** | |
| One Modal pawn geometry miss → hit | **FAIL** | Budget slot consumed. Timed out 180s waiting for `/geometry/` GET 200. |
| One Modal CalculiX FEM + artifacts | **FAIL (pre-solve)** | Budget slot consumed before solve. |
| ≤1 Meta turn | **NOT COMPLETED** | |

### Budget file (end of prior paid session)

```json
{
  "used": { "modal_geometry": 1, "modal_fem": 1, "meta": 1 },
  "jobIds": [],
  "runId": "prod-qa-64578bd-20261104005258"
}
```

---

## Remaining notes

- Do not reset archived budget files to “retry” spend.
- FEM-only session retained scenario/job until explicit `DRAFTY_QA_RELEASE_RETAINED` / `releaseRetainedScenario`.
- Batch 10A not started.
- Optional follow-up (unpaid): harden Playwright post-reload Results navigation so UI assertion matches durable API success.
