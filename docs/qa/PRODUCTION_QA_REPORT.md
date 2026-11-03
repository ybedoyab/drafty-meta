# Drafty Engineering — Automated End-to-End QA Report

**Baseline commit:** `c55173e2beeafef67dad197cc29544c46c08f8a9` (`main` after PR #1)  
**QA harness branch:** `qa/e2e-live-harness`  
**This incremental commit:** (see git tip after push)  
**Report updated:** 2026-11-03  
**Batch 10A:** not started · **Merge/deploy:** not performed  

## Endpoints

| Target | Web | API |
|---|---|---|
| Local | http://127.0.0.1:5173 | http://127.0.0.1:8000 |
| Production | https://drafty-web-umber.vercel.app | https://drafty-api.vercel.app |

## Environment capabilities (this session)

| Capability | Local | Production |
|---|---|---|
| Docker Desktop engine | **available** (Server 29.9.2) | N/A |
| `drafty-ccx` image | **built and used** | N/A |
| CalculiX | **available** (`mode=docker`) | unavailable on Vercel (expected; compute=`modal`) |
| Auth | `supabase` | `supabase` |
| Modal configured/available | false / false | true / true (health only) |
| `DRAFTY_QA_RUN_LIVE_MODAL` | **false** | **false** |
| `DRAFTY_QA_RUN_LIVE_META` | **false** | **false** |
| `DRAFTY_QA_RUN_PRODUCTION` | true | true |

## Regression

| Check | Result |
|---|---|
| Ruff (touched modules) | PASS |
| Pytest non-FEM | PASS (prior + this session) |
| Pytest FEM (`-m fem`) | **PASS (9)** |
| Production hardening / integration cleanup tests | **PASS (22)** |
| Vitest / TS build | PASS (prior session; unchanged frontend product code) |
| Deterministic `bracket-fem.spec.ts` (auth disabled) | **PASS** (~51s, includes one local optimization) |
| Deterministic Playwright under `auth=supabase` | BLOCKED (expected; CI remains auth-disabled) |

## Live QA harness fixes (this session)

- Full bracket lifecycle: Confirm faces → Studio → Run analysis → poll job to **completed** → results/artifacts → reload → re-open Results.
- Paid-call budget module (`e2e/qa/budget.ts`): ≤1 Modal geometry, ≤1 Modal FEM, ≤1 Meta across the process.
- Auth hardening: wait for authenticated `/scenarios` GET; JWT probe before API helpers.
- Artifact fetch uses authenticated API (not bare `page.request`).
- **Defect fix:** Supabase Storage returns HTTP **400** with nested `statusCode: "404"` for missing objects; `delete_private_object` now treats that as success so local FEM scenario delete no longer 503s.
- **Defect fix:** `purge_remote_job` skips speculative remote deletes when no remote job/artifact rows exist.

## Live results

### Local (`qa-local`)

| Case | Status | Evidence |
|---|---|---|
| Auth / persistence / isolation / classroom beam / pawn (prior) | PASS | Prior report; not re-burned unnecessarily |
| Aluminum bracket **real CalculiX** | **PASS** | Job `6883389d-07cb-44d3-adc9-da5d5b9e8279` (also verified `a4b6b782…`, `140dd573…`, `5a119649…` during harness iteration) |
| Scenario deletion after FEM | **PASS** | `QA cleanup deleted: 1`; geometry cache retained |
| Live Meta | SKIP | flag false |
| Mic / live ASR | NOT TESTED | mock only |

**Representative FEM metrics (job `6883389d-07cb-44d3-adc9-da5d5b9e8279`):**

| Field | Value |
|---|---|
| Solver | CalculiX 2.20 · `mode=docker` |
| Mesh | 31795 nodes · 18980 · C3D10 · order 2 · target 2.4 mm |
| Max displacement | 1.3038230447564577e-7 m |
| Governing von Mises | 665097.1852987445 Pa |
| Equilibrium | **passed=true** |
| Validation label | `solver_completed` |
| Warnings | 5 (non-empty; exploratory / numerical notices preserved) |

### Production (`qa-production`)

| Case | Status | Notes |
|---|---|---|
| Prior auth/persistence/isolation/beam/cleanup | PASS | Prior session |
| Pawn Modal geometry (miss→hit) | **SKIP** | `DRAFTY_QA_RUN_LIVE_MODAL=false` |
| Bracket Modal FEM | **SKIP** | flag false — **not proven** |
| Live Meta (one turn) | **SKIP** | `DRAFTY_QA_RUN_LIVE_META=false` |

## Invocation / cost

| Resource | Count | Cost |
|---|---|---|
| Paid Meta | 0 | NOT MEASURED / not invoked |
| Paid Modal geometry | 0 | NOT MEASURED / not invoked |
| Paid Modal CalculiX | 0 | NOT MEASURED / not invoked |
| Paid Modal optimization | 0 | NOT MEASURED |
| Local CalculiX solves (QA + benchmarks + bracket-fem) | multiple (local Docker; not cloud-billed) | local |

## Screenshots

Under `docs/qa/screenshots/` (passwords cleared). New bracket capture: `local-bracket-fem.png` when produced by the harness.

## Defects

| ID | Sev | Finding | Status |
|---|---|---|---|
| D1 | P1 | `dev.ps1` aborted on Docker inspect errors | Fixed prior |
| D4 | P1 | Bracket live QA did not submit/await FEM | **Fixed** this session |
| D5 | P1 | Scenario delete 503 after local FEM: Storage delete of missing objects returned HTTP 400/`not_found`, treated as failure | **Fixed** in `storage.py` |
| D6 | P2 | Speculative remote purge for local-only jobs | **Hardened** in `remote.py` |
| D3 | P2 | Deterministic E2E incompatible with local `auth=supabase` | Open (CI OK) |

## Cleanup

- Latest successful local bracket run: scenario deleted (`cleanup deleted: 1`).
- Shared geometry cache retained by policy.
- Earlier iteration leftovers (pre-D5 fix) may still exist as `DRAFTY_QA_*` rows if delete 503’d before the Storage fix; re-delete via Projects or retry DELETE now that D5 is fixed.
- Recorded leftover IDs from failed iterations (for manual retry if needed):  
  `d27dd637-c521-44b5-932d-e205a5846b37`, `7d41ac60-112c-407b-ba55-79bb1e0645e0`, `c658a20c-7c2e-4738-98a8-89282610a2fc`, `229f8821-1538-476a-aaf9-29a320424402`, `5284c7a3-b0bf-46f8-b220-f562df3252ff`, `535f2a7f-de71-4e18-a56c-3f887de1af7f`.

## Ready for Batch 10A?

**Not yet.** Local CalculiX FEM is now **proven**. Production Modal FEM/geometry and live Meta remain **unimplemented in this run** because flags are false (by design — no unpaid cloud spend).

Next actions before Batch 10A:

1. Set `DRAFTY_QA_RUN_LIVE_MODAL=true` and run **one** production pawn miss→hit + **one** bracket Modal solve (harness already budget-capped).
2. Optionally set `DRAFTY_QA_RUN_LIVE_META=true` for **one** Meta turn.
3. Retry DELETE on any leftover QA scenario IDs listed above.

## Implemented vs proven

| Area | Implemented | Proven end-to-end |
|---|---|---|
| Supabase auth / isolation / projects | yes | yes (prior) |
| Local CalculiX bracket FEM | yes | **yes (this session)** |
| Local FEM benchmarks | yes | **yes (9 passed)** |
| Deterministic bracket + optimization E2E | yes | **yes** |
| Production Modal geometry/FEM | yes | **no** (flag off) |
| Meta AI live | yes | **no** (flag off) |
| Scenario delete after FEM | yes | **yes** (after D5 fix) |
