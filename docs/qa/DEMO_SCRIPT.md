# Drafty hackathon demo script (record-ready)

**Production:** https://drafty-web-umber.vercel.app  
**API:** https://drafty-api.vercel.app  
**Merge:** PR #14 → `8092615` (Batch 10C voice)  
**Modal worker:** `drafty-engineering` **v5** (do not redeploy)  
**Validated demo scenario:** `072d3280-1bd3-4a10-a9bc-138fb41ebef3`  
**Validated FEM job:** `f0c39d56-afd4-4374-b4f1-b08d21d31e9d`

Use the retained scenario/job for a short recording. Full cold-start agent path is documented below for narration fidelity.

---

## A. Fast recording path (recommended, ~3–4 min)

Opens **already completed** agent + FEM results. Zero new paid calls.

### Narration + UI

1. **Sign in** → Projects.  
   *“Drafty is authenticated with Supabase on production.”*

2. Open scenario **`DRAFTY_QA_demo_freeze_…73800`** (id `072d3280-…`).  
   *“This started as a natural-language L-bracket problem with Muse Spark — not a canned offline template.”*

3. Show chat: Muse Spark · Responses API, aluminum L-bracket, force 200 N, faces xmin/zmax.  
   *“Meta Muse proposed the structured scenario; the user confirmed loads and faces.”*

4. Click **Approve and open Studio** (or **Return to scenario** → Studio if already linked).  
   *“Studio opens with the approved L-bracket — 80×80×8 mm, width 40 mm, Al 6061-T6, quadratic C3D10.”*

5. Open **Jobs queue** → select job `f0c39d56-…`.  
   *“One Modal CalculiX solve — no retries.”*

6. **Results:** displacement / von Mises visualization, **Solver completion**, **Validation gates**, **Mesh quality** (C3D10 · 18980 · sampled OK · certification inconclusive).  
   *“Honest mesh-quality gates — we never claim certified_valid.”*

7. Download **report.pdf** / show **report.json**.  
   *“Engineering report retained with the job artifacts.”*

8. **Reload** the page → re-open the same job.  
   *“Results persist after reload; no new FEM submission.”*

### Fallback if the new job UI flakes

| Job | Role |
| --- | --- |
| `f0c39d56-afd4-4374-b4f1-b08d21d31e9d` | Primary demo freeze agent E2E (this session) |
| `6066bc77-07d0-44ad-a49b-720b947d99fd` | Prior Batch 10A / Modal v5 benchmark (same mesh family) |
| `4f8ed6cc-7d26-4a53-ba2a-ba1569ab4933` | Legacy FEM (mesh summary without Batch 10A fields) |

Screenshots: `docs/screenshots/demo-freeze-*.png`

---

## B. Cold-start agent path (narrate; do not re-burn budget unless authorized)

Caps if re-run: Meta ≤3 · CAD preview ≤1 · Modal FEM ≤1 · voice STT 0 · optimize 0 · retries 0.

1. Landing → **Start with AI**.
2. Paste:

   > I need to design and analyze an aluminum L-bracket. Legs 80 mm by 80 mm, width 40 mm, thickness 8 mm. Material aluminum 6061-T6. Force 200 N, displacement limit 1 mm. Quadratic C3D10 solid mesh. Propose the Drafty L-bracket scenario with these values.

3. If Muse asks for force/faces: reply once with `200 N`, `1 mm`, support `xmin`, load `zmax`.
4. Inspector → **Results** → set faces → **Confirm faces** → **Approve and open Studio**.
5. **Preview rebuild solid** once (watch CAD appear).
6. Select **Modal Cloud CalculiX** → **Run analysis** once → wait for completion.
7. Show Results + mesh quality → download report → reload.

---

## Talking points

- STT is Muse Voice via API; on-screen speech playback is **browser TTS, not Meta TTS**.
- Opening Studio does **not** auto-bill CAD; preview is explicit.
- Mesh quality is Batch 10A honest: sampled validity, whole-element certification **inconclusive**.
