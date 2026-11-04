# FEM-only production validation — prepared, not authorized

**Do not run until separately authorized.**

## Baseline

| Item | Value |
|---|---|
| Production SHA (verify again at run time) | `979cdbd2f9c2f6be89fe9459cebe4a07c5a0168b` (or newer if redeployed) |
| Prior CAD | PASS on `prod-qa-4fbd50b-20261104042159` (digest `5614aa62cf8c…`) |
| Prior FEM | Modal `run_simulation` invoked once; job/Storage lost to cleanup; report 404 unverified |
| Evidence fix | PR for `fix/qa-preserve-fem-evidence` — record job id at submit; retain scenario |

## Caps

- **0** new CAD / geometry generations  
- **1** Modal FEM (`run_simulation`) max  
- **0** Meta  
- **0** optimization  
- **0** automatic retries  
- `workers=1`, `retries=0`, serial, fail-stop  

## Suggested env (set only when authorized)

```text
DRAFTY_QA_RUN_PRODUCTION=true
DRAFTY_QA_RUN_LIVE_MODAL=true
DRAFTY_QA_RUN_LIVE_META=false
DRAFTY_QA_REQUIRE_PROD_COMMIT=<verified production SHA>
DRAFTY_QA_BUDGET_RUN_ID=fem-only-<sha8>-<timestamp>
# Do NOT set DRAFTY_QA_RELEASE_RETAINED — evidence must survive afterAll
```

Preserve historical budgets under `docs/qa/archive/`. Use a **new** unique `DRAFTY_QA_BUDGET_RUN_ID`.

## Exact next command (after authorization + merge/deploy of evidence fix)

```bash
cd apps/web
npm run test:qa-production -- -g "aluminum bracket path"
```

Or full production suite with Meta still disabled (CAD may skip if Modal geometry budget is 0 / LIVE_MODAL used only for FEM depending on flags — prefer the focused `-g` filter above so CAD is not re-run).

**Expected maximum paid operations:** 1 × Modal FEM. Zero Meta. Zero CAD if the focused FEM test is used and geometry is not re-triggered.

## Must verify

1. Job id persisted at submit (`docs/qa/evidence/fem-evidence_<runId>.json` + budget `jobIds`)  
2. Job completes; CalculiX; C3D10 mesh; equilibrium; `results.json`  
3. `report.json` and `report.pdf` via production API  
4. Results remain after page reload + fresh API GET  
5. Scenario / Storage **retained** even if an assertion fails  
6. Leftover cleanup skips retained evidence  

## Retention across runs

Retained scenario IDs live in `docs/qa/evidence/retained-scenarios.json` (gitignored) and are **not** scoped to `DRAFTY_QA_BUDGET_RUN_ID`. Later sessions must not auto-delete them. Production leftover cleanup also fail-closes on QA scenarios that still have linked FEM jobs unless release was recorded on this machine.

## Explicit cleanup later

Only after investigation is finished:

```text
DRAFTY_QA_RELEASE_RETAINED=true
```

then a leftover-cleanup pass, or call `releaseRetainedScenario(scenarioId)` from a one-off script.
