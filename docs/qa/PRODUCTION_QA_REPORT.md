# Drafty Engineering — Automated End-to-End QA Report

**Baseline / main tip (production today):** `6c6a17e153e505183718dc5276fd82585a1bdc25`  
**QA harness branch:** `qa/e2e-live-harness`  
**QA branch tip (pre-merge):** see latest push on PR #3  
**PR:** https://github.com/ybedoyab/drafty-meta/pull/3  
**Batch 10A:** not started · **Auto-merge:** not performed  

## Deploy / paid-cloud gate (critical)

| Claim | Status |
|---|---|
| Local CalculiX + FEM proven | **YES** (prior session + this prep) |
| Storage nested-404 delete fix on QA branch | **YES** (`storage.py`) |
| Same fix live on **Vercel production** | **NO** until PR #3 is merged **and** production redeploys |
| Paid Modal/Meta production session | **NOT RUN** — flags false and/or production lacks cleanup fix |

Paid production QA requires **all** of:

1. PR #3 merged to `main`
2. Vercel production deployment of that commit
3. `DRAFTY_QA_RUN_PRODUCTION=true`
4. `DRAFTY_QA_RUN_LIVE_MODAL=true` and/or `DRAFTY_QA_RUN_LIVE_META=true`
5. `DRAFTY_QA_REQUIRE_PROD_COMMIT=<deployed production git SHA>`
6. Single invocation: `npm run test:qa-production` (`--workers=1 --retries=0`)

## Environment flags (this prep session)

| Flag | Value |
|---|---|
| `DRAFTY_QA_RUN_PRODUCTION` | true |
| `DRAFTY_QA_RUN_LIVE_MODAL` | **false** |
| `DRAFTY_QA_RUN_LIVE_META` | **false** |
| `DRAFTY_QA_REQUIRE_PROD_COMMIT` | unset |

## CI (PR #3)

| Check | First run on `d7909f4` | After config/CI fix |
|---|---|---|
| python | PASS | (pending re-run) |
| api-bundle | PASS | (pending re-run) |
| web | PASS | (pending re-run) |
| e2e | **FAIL** | Root cause: Playwright config changed regression defaults (`timeout` / `fullyParallel`) vs `main`. Fixed by restoring CI-like defaults unless live QA is requested; CI now pins `--project=regression`. |

## Live-call budget

| Control | Implementation |
|---|---|
| Caps | 1 Modal geometry · 1 Modal FEM · 1 Meta |
| Persistence | File-backed under OS temp (`drafty-qa-paid-budget.json`) keyed by process run id |
| Workers | Forced `workers: 1` when live QA is enabled; npm script also passes `--workers=1 --retries=0` |
| Retries | `retries: 0` globally for QA; failed paid attempts still consume budget (no release) |
| Production webServer | Skipped when only `qa-production` is selected |

## Leftover `DRAFTY_QA_*` cleanup

| Target | Result |
|---|---|
| Local API (branch code + `drafty-ccx`) | **PASS** — deleted 8 leftover bracket scenarios owned by the QA account |
| Production API | **BLOCKED** — DELETE returned **503** for the same mirrored QA rows. Expected: production has not received the Storage nested-404 fix yet |

Leftover IDs still present on production until post-merge cleanup:

`535f2a7f-de71-4e18-a56c-3f887de1af7f`, `6decff8a-5f98-4ed1-8c62-eba7a2fd4542`, `5284c7a3-b0bf-46f8-b220-f562df3252ff`, `229f8821-1538-476a-aaf9-29a320424402`, `d6d64762-a808-4b17-843c-3dc618db7175`, `c658a20c-7c2e-4738-98a8-89282610a2fc`, `7d41ac60-112c-407b-ba55-79bb1e0645e0`, `d27dd637-c521-44b5-932d-e205a5846b37`

## Proven earlier (not re-run this prep)

| Area | Evidence |
|---|---|
| Local FEM benchmarks | 9 passed |
| Deterministic bracket + optimization E2E | PASS |
| Authenticated local bracket CalculiX | Job `6883389d-07cb-44d3-adc9-da5d5b9e8279` (nodes 31795, C3D10, equilibrium passed) |
| Auth / isolation / classroom beam | PASS (prior) |

## Production paid session (post-merge)

| Step | Status |
|---|---|
| One pawn geometry miss → hit | **NOT RUN** (await merge+deploy+flags) |
| One Modal bracket FEM + artifacts + persistence | **NOT RUN** |
| ≤1 Meta turn | **NOT RUN** |
| Remote optimization | forbidden / not run |
| Cost | **NOT MEASURED** |

## Merge readiness

Once CI is fully green on the follow-up commit:

- **PR #3 is merge-ready for harness + local FEM proof + cleanup fix.**
- **Do not** treat merge as authorization for Batch 10A.
- **Do not** run paid Modal/Meta until production deploy SHA is confirmed and `DRAFTY_QA_REQUIRE_PROD_COMMIT` is set.
- After merge+deploy: run exactly one `npm run test:qa-production` session with live flags; stop after the first failed paid attempt.

## Ready for Batch 10A?

**No.** Await green CI → merge → production deploy → single authorized paid QA session → update this report with cloud job IDs.
