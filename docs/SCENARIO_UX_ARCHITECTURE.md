# Scenario workstation

Drafty has two entries. **Start with a problem** opens `/scenario/new`. **Open Studio** opens `/studio` and does not need an AI key.

The scenario wizard is a guided template stored in `localStorage` under `drafty.scenario.v1`. It does not call Meta. The status on the page says the AI is not connected. A citation shown there is the checked NSR-10 classroom card, not a web-search result.

## Supported in this pass

- Describe a goal, a domain, and a jurisdiction typed by the user.
- Attach up to eight PNG, JPEG, or WebP files as evidence. The browser keeps names only. An image is not measured.
- Ask for span, tributary width, dead load, and beam self-weight.
- Show NSR-10 Title B, Table B.4.2.1-1, educational classrooms, 2.0 kN/m², as an illustrative published minimum.
- Calculate `q_line = (q_dead + q_live) * tributary_width + beam_self_weight` when the width is a positive finite number. Self-weight is added once.
- Elastic I-section area and second moments, and the simply supported uniform-load moment, end shear, and midspan deflection, through `POST /api/v1/scenarios/classroom`.
- A scenario brief that says 3D simulation is not available for this floor beam.
- Studio solids that already solve: cantilever beam, plate, L-bracket, perforated plate. One encastre face and one loaded face. CalculiX remains the source of the 3D numbers.
- Viewport fit from the part bounding sphere, orthographic or perspective, views iso / front / top / right, labeled fixed-support and load arrows on the six bounding-box faces.

## Not supported

- Turning a classroom floor into the cantilever example.
- A distributed floor load or a simply supported I-beam inside the current solid solver.
- B-rep face picking. The six faces are bounding-box presets.
- Measuring drawings, inferring jurisdiction, or treating a headcount as a live load.
- Ultimate combinations, strength, buckling, connections, bearing, vibration, or a safe / approved badge.
- Live Meta web search or multi-image understanding. The Responses adapter exists and is covered by a contract test. It is not called without `MODEL_API_KEY`.
- Supabase draft sync and Modal solves.

## Checklist

- [x] Two entry paths and a manual Studio escape
- [x] Progressive scenario steps with back, edit, and local resume
- [x] Missing tributary width blocks the line load
- [x] Unsupported floor beam ends in a brief instead of a fake solve
- [x] Camera fit and labeled support / load markers
- [x] Solver log hidden until opened
- [ ] Real Muse Spark multi-image pass
- [ ] Real Responses `web_search` with `url_citation`
- [ ] I-beam solid in the CalculiX path
