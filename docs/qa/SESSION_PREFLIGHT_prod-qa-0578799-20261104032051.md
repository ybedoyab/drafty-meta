# Drafty Production QA — Session Preflight

**Status:** READY for explicit authorization (no paid calls made during preflight)
**Session / budget run id:** `prod-qa-0578799-20261104032051`
**Required production SHA:** `05787990cdeb663f0d55801a94ed46df8d7f04c3`
**Prior paid session (archived, do not reset):** `prod-qa-64578bd-20261104005258`

## Archives (immutable copies)

- `docs/qa/archive/PRODUCTION_QA_REPORT_prod-qa-64578bd-20261104005258.md`
- `docs/qa/archive/drafty-qa-paid-budget_prod-qa-64578bd-20261104005258.json`

## Budgets (hard caps)

- modal_geometry: 1
- modal_fem: 1
- meta: 1

## Execution policy

- serial suite (`test.describe.configure({ mode: "serial" })`)
- `workers=1`, `retries=0`
- fail-stop: serial failures skip remaining tests; FEM failure rethrows without retry
- layered accounting: reservations vs invocation_attempts vs completed_responses

## Exact command (wait for explicit authorization)

```powershell
cd apps/web
$env:DRAFTY_QA_BUDGET_RUN_ID='prod-qa-0578799-20261104032051'
$env:DRAFTY_QA_REQUIRE_PROD_COMMIT='05787990cdeb663f0d55801a94ed46df8d7f04c3'
npm run test:qa-production
```

Do not run until human authorization. Do not reset archived budget files.
