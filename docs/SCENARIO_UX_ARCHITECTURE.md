# Scenario workstation

Two entries stay on the homepage. **Start with AI** opens `/scenario/new`. **Open Studio** opens `/studio` and does not need a key.

`/scenario/new` is one workspace: conversation, evidence, inputs, sources, a 2D load-path diagram, and an optional I-section preview. The preview is geometry only. The session lives on the API under `data/scenarios/` and the browser remembers the id in `drafty.scenario.v2`.

One orchestration handles understanding, research, assumptions, modeling, verification, and criticism. Physics is `evaluate_classroom` in Python. The model cannot replace those numbers.

## Offline, no Meta key

The page says **AI not connected**. A classroom note of 30 students does not become a load. NSR-10 Title B Table B.4.2.1-1, 2.0 kN/m², is applied only after the jurisdiction is Colombia, and it is marked assumed. The line load is `(q_dead + q_live) * tributary width + self-weight`. A simple-span elastic moment, reaction, and deflection are shown when the I-section is valid. `ready_for_3d_simulation` stays false.

## With a Meta key

The turn calls `POST /v1/responses` on `muse-spark-1.3`, or `muse-wonder-1.0` when that model is requested. Each turn resends `instructions` and `tools: [{type: web_search}]`, chains `previous_response_id`, and may attach up to eight `input_image` data URLs within a 4 MB cap. Stored citations are `url_citation` annotations only. A reply that claims safety or a stress is dropped. This path was contract-tested, not called with a live key.

## Not supported

- A distributed floor load or a simply supported I-beam inside CalculiX.
- Turning the classroom case into the cantilever example.
- B-rep face picking, code combinations, strength, buckling, connections, bearing, vibration, or a certification.
- SAM 3.1.
- Supabase session sync and Modal solves.

Images are PNG, JPEG, or WebP, at most eight, 8 MB each, decoded before they are stored. They are not measured.
