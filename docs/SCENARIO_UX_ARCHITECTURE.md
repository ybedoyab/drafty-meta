# Scenario workstation

Two entries stay on the homepage. **Start with AI** opens `/scenario/new`. **Open Studio** opens `/studio` and does not need a key.

`/scenario/new` is one workspace: conversation, evidence, inputs, sources, a 2D load-path diagram, beam-element diagrams, and an optional I-section preview. The preview is geometry only. The session lives on the API under `data/scenarios/` and the browser remembers the id in `drafty.scenario.v2`.

One orchestration handles understanding, research, assumptions, modeling, verification, and criticism. Physics is `evaluate_classroom` and, after the user runs it, `analyze_simply_supported_udl`. The model cannot replace those numbers.

## Offline, no Meta key

The page says **AI not connected**. A classroom note of 30 students does not become a load. NSR-10 Title B Table B.4.2.1-1, 2.0 kN/m², is applied only after the jurisdiction is Colombia, and it is marked assumed. The line load is `(q_dead + q_live) * tributary width + self-weight`. A simple-span elastic moment, reaction, and deflection are shown when the I-section is valid.

`Run beam elements` solves that confirmed simple span with Euler-Bernoulli Hermitian elements. Shear and moment come from the solved reactions by equilibrium. Deflection is the Hermitian interpolation. The run is accepted only when it matches the closed form within 1% on midspan deflection and moment, and the support reactions balance the load. `ready_for_3d_simulation` stays false. A numerical pass is not a certification. If the outer-fiber stress is above the typical yield stored for the material, the page says the elastic model is outside that range.

Changing the span and choosing **Compare this edit** stores a second solve without replacing the confirmed one. **Download report** returns the current beam-element record as JSON.

## With a Meta key

The turn calls `POST /v1/responses` on `muse-spark-1.3`, or `muse-wonder-1.0` when that model is requested. Each turn resends `instructions`, `tools: [{type: web_search}]`, and `text.format` for a JSON object with `message`, `questions`, and `observations`. It chains `previous_response_id`. A rejected previous id is retried once without that id. Images are `input_image` data URLs, at most eight, within a 4 MB cap. Stored citations are `url_citation` annotations with http or https URLs only. Duplicate URLs keep one entry. A reply that claims safety or a stress is dropped. The session stops at 8 model turns or 6000 output tokens. This path was contract-tested. It was not called with a live key in this batch.

Chat completions stay on `ask_clarification` and `propose_design`. They do not receive `web_search`.

## Not supported

- A distributed floor load or a simply supported I-beam inside CalculiX. The solid solver still accepts one fixed face and one load face.
- Turning the classroom case into the cantilever example.
- Timoshenko shear deformation, code combinations, strength, buckling, connections, bearing, vibration, or a certification.
- SAM 3.1.
- Supabase session sync and Modal solves.

Images are PNG, JPEG, or WebP, at most eight, 8 MB each, decoded before they are stored. They are not measured.
