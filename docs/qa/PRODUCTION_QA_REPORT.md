# Drafty Engineering — Automated End-to-End QA Report

**Latest authorized production QA:** `studio-batch10b-d05cd76-20261104164700`  
**Production SHA:** `d05cd76b63b025f32a02882b96c6515aa3cc28b5` (merge of PR #13)  
**Modal worker:** `drafty-engineering` **v5** (unchanged; no redeploy)  
**Prior FEM Batch 10A session (preserved):** `fem-batch10a-v5-65fb796-20261104155241` / job `6066bc77-…`  
**Prior FEM-only session (preserved):** `fem-only-145e1c37-20261104103205` / job `4f8ed6cc-…`  
**Prior Meta-only session (preserved):** `meta-only-919cd326-20261104124808`  
**Batch 10B Studio production verification:** **PASS** (read-only; zero paid POSTs)  
**Meta / Modal FEM / Modal CAD / optimization (this session):** **0**

Historical archives (immutable; do not overwrite):

- `docs/qa/archive/PRODUCTION_QA_REPORT_prod-qa-64578bd-20261104005258.md`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-64578bd-20261104005258.json`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-0578799-20261104032051.json`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-4fbd50b-20261104042159.json`
- `docs/qa/archive/drafty-qa-paid-budget_fem-only-145e1c37-20261104103205.json`
- `docs/qa/archive/drafty-qa-paid-budget_meta-only-919cd326-20261104124808.json`
- `docs/qa/archive/drafty-qa-paid-budget_fem-batch10a-v5-65fb796-20261104155241.json`

---

## Batch 10B Studio production verification `studio-batch10b-d05cd76-20261104164700` (2026-11-04)

**Authorization:** user explicitly authorized merge of PR #13 and post-merge read-only production Studio verification. Zero Meta. Zero Modal FEM/CAD. Zero optimization. Zero new jobs. Zero Modal redeploy. Browser interceptor blocked all potentially chargeable mutations.

### Verdict

| Axis | Result |
|---|---|
| PR #13 merge | **PASS** — merge commit `d05cd76b63b025f32a02882b96c6515aa3cc28b5`; PR **MERGED** |
| GitHub CI on merge SHA | **PASS** — run `41918377046` (`python`/`web`/`api-bundle`/`e2e`) |
| Vercel production deploy | **PASS** — GitHub statuses `Vercel – drafty-web` / `drafty-api` success for `d05cd76…`; production web bundle contains Batch 10B markers (`mesh-quality`, preview-gate copy) |
| API health / auth | **PASS** — `GET /api/v1/health` 200 (`auth=supabase`, `modal_available=true`); QA sign-in succeeded |
| Modal worker | **PASS** — `drafty-engineering` remains **v5** (deployed 2026-11-04 15:46; not redeployed) |
| Studio Batch 10A job UI | **PASS** — job `6066bc77-…` shows Solver completion, Validation gates, Mesh quality |
| Mesh quality fields | **PASS** — C3D10 · 18980 · `sampled_ok_certification_inconclusive` · `mesh_validity=passed_sampled` · whole-element certification **inconclusive** |
| False low-ratio warning | **PASS** — no fabricated “below 0.10” warning (honest Batch 10A limitation soft notes still shown from retained artifacts) |
| Reload persistence | **PASS** — Results restored after reload without new job POST |
| Legacy FEM compatibility | **PASS** — job `4f8ed6cc-…` shows legacy mesh summary; no fabricated `certified_valid` |
| Preview safety | **PASS** — passive scenario/Studio open/reload caused **0** `/designs/preview` POSTs; explicit Preview/Generate controls visible and **not clicked** |
| Forbidden paid POST attempts | **0** blocked / **0** attempted (only allowed POST: Supabase auth token) |
| Overall | **PASS** |

### Preflight / merge

| Field | Value |
|---|---|
| Expected PR head | `11fc79cd4bcf33922d647dd4aa5a6bca792a98df` |
| Pre-merge main | `745ff7715fdb3c17ee3a9c2dbbafd29641d3eb95` |
| Merge strategy | GitHub merge commit |
| Merge SHA | `d05cd76b63b025f32a02882b96c6515aa3cc28b5` |
| CI run | https://github.com/ybedoyab/drafty-meta/actions/runs/41918377046 |
| Web deploy status URL | https://vercel.com/ybedoyabs-projects/drafty-web/2HH4aMZkyFkApNF2t91cen3EUDsK |
| API deploy status URL | https://vercel.com/ybedoyabs-projects/drafty-api/7chme5dQtvFQrFkbbqwKgN64rL6Z |
| Production web alias | `https://drafty-web-umber.vercel.app` |
| Production API alias | `https://drafty-api.vercel.app` |

### Studio checks (interceptor armed)

Allowed: authentication + read-only GETs.  
Blocked if attempted: `POST /api/v1/designs/preview`, `POST /api/v1/jobs`, optimize/analyze/turn/segment mutations, Modal/Meta paid paths.

| Check | Result |
|---|---|
| Open completed Batch 10A job `6066bc77-…` | PASS |
| Solver completion / Validation gates / Mesh quality sections | PASS |
| C3D10 + 18980 elements | PASS |
| Jacobian status inconclusive | PASS |
| `passed_sampled` gate | PASS |
| No false low-ratio soft warning | PASS |
| Reload restores results | PASS |
| Legacy job `4f8ed6cc-…` legacy summary | PASS |
| Passive scenario `abc2180d-…` + Studio navigation | PASS · 0 preview POSTs |

### Evidence

- `docs/qa/evidence/batch10b-prod-verify_2026-11-04T21-47-01-305Z.json`
- `docs/qa/evidence/_batch10b_prod_verify.mjs` (read-only interceptor harness)
- `docs/screenshots/prod-batch10b-mesh-quality-10a.png`
- `docs/screenshots/prod-batch10b-mesh-quality-legacy.png`
- `docs/screenshots/prod-batch10b-preview-gated.png`

Retained jobs/scenarios unchanged. Historical QA budgets unchanged.

---

## FEM Batch 10A / Modal v5 session `fem-batch10a-v5-65fb796-20261104155241` (2026-11-04)

**Authorization:** user explicitly authorized ONE production Modal FEM on worker v5. Zero Meta. Zero optimization. Zero separate CAD preview. Zero Modal redeploy. Playwright Studio path rejected because Workstation auto-calls `/designs/preview` on load.

### Verdict (separate axes)

| Axis | Result |
|---|---|
| Modal provider execution | **PASS** — job `6066bc77-…` `completed`, `compute=modal`, CalculiX |
| Batch 10A runtime code verification | **PASS** — `jacobian_validation_method` present on Modal-produced `results.json` |
| Jacobian sampled validity | **PASS** — status `sampled_ok_certification_inconclusive`; inverted=0; degenerate=0; min/max J > 0 |
| Whole-element certification | **INCONCLUSIVE** (honest; never `certified_valid`) |
| Numerical equilibrium | **PASS** |
| Engineering reports | **PASS** — `report.json` quality + gates; PDF `%PDF-` with Mesh quality / Jacobian sampling text |
| Persistence | **PASS** — re-GET results + scenario after completion |
| Studio UI restoration | **NOT TESTED** (API-only to keep CAD preview = 0) |
| Evidence retention | **PASS** — scenario retained before invoke; prior FEM scenario kept |
| Overall | **FULL PASS** |

### Preflight (unpaid)

| Check | Result |
|---|---|
| Git HEAD | `65fb796…` |
| Modal app | `drafty-engineering` **v5** · 0 running containers |
| Functions | `run_simulation` / `optimize_design` / `generate_preview` / `generate_revolved` resolvable |
| API health | **200** · `auth=supabase` · `modal_available=true` |
| Prior FEM | job `4f8ed6cc-…` still `completed` |
| `DRAFTY_QA_RELEASE_RETAINED` | unset |
| LIVE_MODAL / LIVE_META | false (Playwright QA flags; FEM executed via authorized API script) |

### Execution (exactly one paid FEM)

API-only sequence: create scenario → load bracket demo → faces `xmin`/`zmax` → approve → **retain** → `POST /api/v1/jobs` (`compute=modal`) once → GET poll → artifact GETs.

| Field | Value |
|---|---|
| Scenario ID | `abc2180d-e0e3-4ddb-87cc-da3f8ada8c7b` |
| Job ID | `6066bc77-07d0-44ad-a49b-720b947d99fd` |
| Invoke (UTC) | `2026-11-04T20:52:51Z` |
| Mesh | C3D10 · **31 795** nodes / **18 980** elements |
| Jacobian method | `numpy_tet10_analytical_derivatives+selective_adaptive` |
| Jacobian status | `sampled_ok_certification_inconclusive` |
| min / max J | `3.74e-9` / `4.00e-8` |
| Ratio min | ≈ 1.0 |
| quality_gates | `mesh_validity=passed_sampled`, `mesh_quality=reported` |
| Equilibrium | passed |
| Benchmark | not applicable (bracket, not tip-loaded cantilever) |
| PDF | 3130 bytes · Mesh quality + limitation text present |
| Provider count | **modal_fem invocations=1**, completed=1 · Meta=0 · CAD preview=0 · opt=0 |
| Cost | Modal wall time ~1 minute; no dollar amount exposed by API |

Evidence files:

- `docs/qa/evidence/fem-evidence_fem-batch10a-v5-65fb796-20261104155241.json`
- `docs/qa/evidence/fem-readonly-verify_fem-batch10a-v5-65fb796-20261104155241.json`
- `docs/qa/archive/drafty-qa-paid-budget_fem-batch10a-v5-65fb796-20261104155241.json`

---

## Meta-only session `meta-only-919cd326-20261104124808` (2026-11-04)

**Authorization:** user explicitly authorized ONE Meta text turn with current credentials (rotation waived for this session only). Zero Modal FEM/CAD/optimization. Workers=1, retries=0. No second paid request. `DRAFTY_QA_RELEASE_RETAINED` unset. Batch 10A not started.

### Verdict (separate axes)

| Axis | Result |
|---|---|
| Observed provider response | **PASS** — Muse Spark 1.3 Responses API clarification; asked for missing inputs; no invented span/loads/citations in the failure DOM |
| Playwright UI assertions | **FAIL** — locator required presentation-only `Drafty:`; UI renders exact `Drafty` |
| API persistence verification | **FAIL / NOT COMPLETED** — no authenticated post-reload GET; scenario removed by cleanup |
| Evidence retention | **FAIL** for that run — Meta scenario not retained before invoke; `afterAll` deleted it |
| Overall session | **FAIL** (UI + retention); **no paid retry** |
| CAD / FEM / historical budgets | **unchanged / preserved** |
| Batch 10A | not started |

### Preflight (unpaid)

| Check | Result |
|---|---|
| Production SHA | `919cd326527e843bf2c1f4cbf05cb8e372e2d831` = `main` HEAD; GitHub `Vercel – drafty-web` / `drafty-api` success; CI `41872349866` all passed |
| API health | **PASS** — `drafty-api.vercel.app` and web-bundled `drafty-api-ybedoyabs-projects.vercel.app` both `meta=true`, `modal_available=true`, `auth=supabase` |
| QA auth | **PASS** |
| Focused filter | **PASS** — exactly 1 test: `optional single Meta turn when explicitly enabled` |
| Retained FEM | **PASS** — scenario `4b032aac-…` / job `4f8ed6cc-…` status `completed` |
| `DRAFTY_QA_RELEASE_RETAINED` | unset |
| Prior budgets/evidence hashes | unchanged before execution |

### Execution

```powershell
cd apps/web
$env:DRAFTY_QA_RUN_PRODUCTION="true"
$env:DRAFTY_QA_RUN_LIVE_MODAL="false"
$env:DRAFTY_QA_RUN_LIVE_META="true"   # process-only; restored to false after
$env:DRAFTY_QA_REQUIRE_PROD_COMMIT="919cd326527e843bf2c1f4cbf05cb8e372e2d831"
$env:DRAFTY_QA_BUDGET_RUN_ID="meta-only-919cd326-20261104124808"
$env:DRAFTY_QA_PRODUCTION_API="https://drafty-api-ybedoyabs-projects.vercel.app"
npx playwright test -c playwright.qa.config.ts --project=qa-production --workers=1 --retries=0 -g "optional single Meta turn"
```

Playwright exit code: **1**. Process flags restored: `LIVE_META=false`, `LIVE_MODAL=false`.

### Scenario / provider evidence

| Field | Value |
|---|---|
| Scenario name (UI) | `DRAFTY_QA_meta_2026-11-04T17-48-13` |
| Scenario ID | **not retained** — deleted by suite `afterAll` cleanup (`QA cleanup deleted: 1`) |
| UI mode signal | `Muse Spark 1.3 · Responses API` ⇒ `mode=meta-responses` (not offline-template) |
| Provider response ID | **not captured via API** (scenario gone); UI showed live assistant reply + token usage |
| Usage (UI footer at failure snapshot) | 1995 input tokens, 438 output tokens (no dollar amount) |
| Reply behavior | Asked for missing span, tributary width, dead load, supports, I-section dims; noted headcount ≠ floor load; no DOI / ASCE fabricated citations in visible text |
| Span field | empty in inspector snapshot |
| Offline-template fallback | **No** |

DOM snapshot archived at `docs/qa/evidence/meta-error-context_meta-only-919cd326-20261104124808.md`.

### Accounting

| Kind | Authorized | Reservation | Invocation attempt | Completed response (budget) | UI assertion |
|---|---|---|---|---|---|
| Meta AI | 1 | **1** | **1** | **0** | **0** (locator fail after provider reply) |
| Modal FEM | 0 | **0** | **0** | **0** | — |
| Modal CAD | 0 | **0** | **0** | **0** | — |
| Optimization | 0 | — | — | — | — |

Budget archived: `docs/qa/archive/drafty-qa-paid-budget_meta-only-919cd326-20261104124808.json`.

### Post-run investigation (no new provider request)

| Source | Finding |
|---|---|
| Playwright `error-context.md` | Full assistant reply + `Muse Spark 1.3 · Responses API` + UI usage **1995 / 438** tokens; scenario name `DRAFTY_QA_meta_2026-11-04T17-48-13` |
| Authenticated scenario list/GET | **0** scenarios contain the I-beam prompt or 1995/438 usage — deleted scenario **not recoverable** |
| `previous_response_id` / `resp_*` | **Not recoverable** from remaining scenarios, budget archive, or local evidence (never persisted for this run) |
| Vercel runtime logs | **Unavailable** this session (team scope `ybedoyabs-projects` unauthorized for MCP/CLI) |
| Provider dashboard | **Not available** to this agent |
| Limitation | Cannot reconstruct the Meta response ID without recreating the scenario or a new provider call — **neither was done** |

### Unpaid hardening after this run (no paid QA)

- UI locator → `assistantMessageArticle()` (exact `Drafty`, article-scoped); fixture Playwright + vitest coverage.
- Meta retain-before-invoke via `recordMetaScenarioRetained` + shared retention ledger (FEM behavior unchanged).
- API-first `evaluateMetaProviderSession` before `recordCompletedResponse`; UI failures set `ui_assert_failed` without clearing provider completion; offline-template never PASS.
- Invented-load checks use canonical `span_m` / `dead_n_per_m2` / `live_n_per_m2` (aliases retained) and only apply to `DRAFTY_QA_meta_*` QA scenarios.
- Production leftover cleanup fail-closes `DRAFTY_QA_meta_*` by name across machines (no local ledger / no linked jobs) unless explicitly released; FEM job-linked protection unchanged.
- Historical budget JSON files left byte-stable except the already-recorded `…meta-only-919cd326-20261104124808.json` archive from the paid session.

---


## Prior blocked attempt `meta-only-919cd326-20261104120042` (2026-11-04) — FAIL (gate)

**Authorization:** exactly **one** live Meta AI text-model request. Zero Modal FEM. Zero CAD. Zero optimization. Zero automatic retries. Workers=1, retries=0. Full suite not run. `DRAFTY_QA_RELEASE_RETAINED` unset. Do not reuse historical budgets.

### Verdict

| Item | Result |
|---|---|
| Overall | **FAIL** — stopped at pre-execution credential-rotation gate |
| Focused Playwright `-g "optional single Meta turn"` | **DID NOT RUN** |
| Meta provider requests | **0** |
| Offline-template fallback | N/A (no turn) |
| Independent Meta verification (`mode=meta-responses`, `meta_turns≥1`, response id) | **NOT VERIFIED** |
| Batch 10A | not started |
| FEM evidence / archives | **preserved** (no delete / no release) |

### Preflight (before any paid Meta call)

| Check | Result |
|---|---|
| Exposed private credentials rotated | **FAIL** — local `.env` fingerprints still match previously exposed `MODEL_API_KEY`, Supabase publishable + secret keys, and both QA passwords |
| Production env vars updated after rotation | **NOT CONFIRMED** — Vercel team scope `ybedoyabs-projects` not accessible from this CLI/MCP session; cannot attest prod secret replacement |
| Production application healthy | **PASS (partial)** — `GET https://drafty-api.vercel.app/api/v1/health` → 200; `meta=true`, `modal_available=true`, `auth=supabase`, `compute=modal`; web alias `drafty-web-umber.vercel.app` → 200 |
| GitHub deploy status for `919cd326…` | **PASS** — `Vercel – drafty-web` success; `Vercel – drafty-api` success; CI jobs api-bundle/web/python/e2e success |
| Alias Current/Latest pin to `919cd326…` | **NOT RE-CONFIRMED this session** (team inspect unauthorized); prior preflight had both aliases Ready/Current/Latest on this SHA |
| Budget run ID unused | **PASS** — no `*meta-only-919cd326*` budget/evidence artifact created |
| `DRAFTY_QA_RELEASE_RETAINED` | unset |
| Live flags in repo `.env` (defaults) | `RUN_PRODUCTION=true`, `RUN_LIVE_MODAL=false`, `RUN_LIVE_META=false` (live Meta would have been session-only if gates passed) |

### Execution

**Not started.** Per authorization: ensure rotation + prod env update + health **before** execution. Credential rotation failed → **STOP**. No Playwright Meta turn. No retries.

### Accounting

| Kind | Authorized | Reservation | Invocation | Completed | Notes |
|---|---|---|---|---|---|
| Meta AI | 1 | **0** | **0** | **0** | blocked preflight |
| Modal FEM | 0 | **0** | **0** | **0** | |
| Modal CAD | 0 | **0** | **0** | **0** | |
| Optimization | 0 | — | — | — | |

Scenario ID / Meta response ID / provider usage: **none** (no request).

### Required before re-authorization

1. Rotate every previously exposed secret (Meta `MODEL_API_KEY`, Supabase publishable + secret, QA user passwords).
2. Update production Vercel env for `drafty-api` (and any mirrored local `.env` used for QA auth).
3. Confirm fingerprints no longer match exposed values; re-check health on `919cd326…`.
4. New authorization + **new** `DRAFTY_QA_BUDGET_RUN_ID` (do not reuse `meta-only-919cd326-20261104120042` after a failed attempt if any partial spend occurred — none did here, but prefer a fresh ID).

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
- Meta-only `meta-only-919cd326-20261104124808`: **1** Meta provider request; provider **PASS** / UI **FAIL** / API persistence **not completed** / retention **FAIL**; response ID **not recoverable** without a new request (not issued); Batch 10A not started.
- Unpaid follow-up: Meta retain + API-first verify + `Drafty` locator regressions (see `fix/meta-qa-evidence-retention`).
- Prior blocked ID `meta-only-919cd326-20261104120042` remains unused (0 Meta).
- Optional follow-up (unpaid): harden Playwright post-reload Results navigation so UI assertion matches durable API success.
