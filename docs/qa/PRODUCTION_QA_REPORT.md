# Drafty Engineering — Automated End-to-End QA Report

**Production merge commit:** `64578bd7203a86c156a600d28d4be2e3b43f3d04`  
**Branch:** `main` (PR #3 merged)  
**PR:** https://github.com/ybedoyab/drafty-meta/pull/3  
**Batch 10A:** not started  

## Deploy verification (2026-11-04)

| Check | Result |
|---|---|
| `origin/main` tip | `64578bd7203a86c156a600d28d4be2e3b43f3d04` |
| GitHub Actions `ci` on that commit | **PASS** — python, api-bundle, web, e2e all green ([run 41780854121](https://github.com/ybedoyab/drafty-meta/actions/runs/41780854121)) |
| GitHub commit status `Vercel – drafty-web` | **success** — Deployment has completed (`…/drafty-web/BQAaDvA6npC24wQtoKuvEcARGAdm`) |
| GitHub commit status `Vercel – drafty-api` | **success** — Deployment has completed (`…/drafty-api/9CGLG6qgmj9fQ2pY9ZtWSaTDg4fE`) |
| Production health (`drafty-api.vercel.app`) | **200** — `auth=supabase`, `compute=modal`, `modal_available=true`, `meta=true` |
| Storage nested-404 delete fix live | **YES** — production leftover DELETE no longer returns 503; prior leftover IDs reported `already-gone` / new QA rows deleted successfully |
| Exact SHA on production aliases via Vercel MCP/CLI | **Not independently readable** from this agent account (team `ybedoyabs-projects` unauthorized). Verification used commit statuses + main tip identity + live cleanup behavior instead. |
| Local rebuild asset fingerprint at `64578bd` | CSS `index-8SMhBQiK.css` matches production; JS hash differs (expected when Vercel injects `VITE_*` at build time) |

## Environment flags (production QA session)

| Flag | Value |
|---|---|
| `DRAFTY_QA_RUN_PRODUCTION` | true |
| `DRAFTY_QA_RUN_LIVE_MODAL` | true |
| `DRAFTY_QA_RUN_LIVE_META` | true |
| `DRAFTY_QA_REQUIRE_PROD_COMMIT` | `64578bd7203a86c156a600d28d4be2e3b43f3d04` |
| Budget run id | `prod-qa-64578bd-20261104005258` |

## Production QA session results

Invocation: `npm run test:qa-production` (`--workers=1 --retries=0`), then continued remaining tests under the **same** budget run id after the first paid failure (no budget reset; no second geometry/FEM reservation).

| Step | Status | Notes |
|---|---|---|
| Leftover `DRAFTY_QA_*` cleanup | **PASS** | Prior IDs already gone; session rows deleted (including failed pawn/bracket). `failed: []` |
| Health + homepage | **PASS** | Modal/Meta/Supabase configured on production |
| Auth persistence / rename / reload | **PASS** | |
| Cross-user isolation | **PASS** | |
| Classroom demo + span compare | **PASS** | No paid Modal/Meta |
| Scenario deletion cleanup policy | **PASS** | DELETE 200 + retained geometry cache; Storage fix live |
| Mocked microphone UI | **SKIPPED** | Mic control not visible on production UI |
| One Modal pawn geometry miss → hit | **FAIL** | Budget slot consumed. Timed out 180s waiting for `/geometry/` GET. Scenario stuck `CAD pending`. No cache miss/hit headers captured. **No retry** (budget policy). |
| One Modal CalculiX FEM + artifacts | **FAIL (pre-solve)** | Budget slot consumed before solve. Failed waiting for **Approve and open Studio** after Confirm faces (30s). No Modal job id recorded. **No retry**. |
| ≤1 Meta turn | **NOT COMPLETED** | Budget slot was consumed then harness skipped (`AI not connected` path / exhausted remaining). No successful Meta reply asserted. |
| Remote optimization | forbidden / not run | |
| Cost | **NOT MEASURED** | No Modal/Meta billing figures available from this environment; `jobIds: []` in budget file |

### Budget file (end of session)

```json
{
  "used": { "modal_geometry": 1, "modal_fem": 1, "meta": 1 },
  "jobIds": [],
  "runId": "prod-qa-64578bd-20261104005258"
}
```

### Paid-call interpretation

- Caps honored (1/1/1). Failed/skipped attempts still consumed slots by design.
- No evidence a Modal FEM job or Meta response completed (`jobIds` empty; pawn never reached geometry GET).
- Do **not** re-run paid Modal/Meta against production until the pawn CAD path and bracket approve gate are diagnosed; do not reset the budget file to “retry” the same spend without an explicit new authorization.

## Earlier local proof (unchanged)

| Area | Evidence |
|---|---|
| Local FEM benchmarks | 9 passed |
| Authenticated local bracket CalculiX | Job `6883389d-07cb-44d3-adc9-da5d5b9e8279` (nodes 31795, C3D10, equilibrium passed) |

## Ready for Batch 10A?

**No.** Production auth/isolation/cleanup look healthy after merge, but the controlled paid Modal geometry + FEM path did not complete successfully. Diagnose CAD/approve regressions on production before Batch 10A.
