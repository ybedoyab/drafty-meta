# References

These sources informed the product boundaries. None of them is evidence that this repository's calculations are validated.

| Source | Use here | Limit |
| --- | --- | --- |
| Berger et al. (2026), [Physics-in-the-Loop](https://ijcai.org/proceedings/2026/714) | A physics tool should check the model instead of trusting the language model. | Drafty does not implement that paper's architecture. |
| Liu et al. (2025), [LLM agent for structural analysis](https://arxiv.org/abs/2507.02938) | Standalone LLM arithmetic is not a structural solver. | No claim that Drafty matches their agent. |
| Geng et al. (2025), [multi-agent 2D frames](https://arxiv.org/abs/2510.05414) | Separate intake, loads, and checks. | Drafty uses one guided template plus the existing solver, not their frame agent. |
| Tian and Zhang, [multi-agent FEA reliability](https://arxiv.org/abs/2408.13406) | A critic and explicit state matter more than more agents. | No multi-agent FEA run is implemented. |
| [NSR-10 Title B, Table B.4.2.1-1](https://camacol.co/sites/default/files/descargables/T%C3%ADtulo%20B%20NSR-10%20del%20Decreto%20926%20del%2019032010.pdf) | Educational classrooms, 2.0 kN/m², used as an illustrative minimum when the user does not enter a live load. | Not a complete code check, not a combination, and not a certification. Confirm the official text and amendments before any code claim. |
| [NSR-10 Title F](https://www.uptc.edu.co/export/sites/default/facultades/f_ingenieria/pregrado/civil/documentos/NSR-10_Titulo_F.pdf) | Steel strength, buckling, and connections remain unchecked. | Not implemented. |
| [AISC 360](https://www.aisc.org/aisc/publications/current-standards/aisc-360/) | Relevant when the jurisdiction asks for it. | Not implemented. |
| [SteelConstruction.info floor vibration](https://steelconstruction.info/topics/floor-vibrations) | Frequency-only checks are not enough for a classroom floor. | No vibration analysis is implemented. |
| [Meta search grounding](https://dev.meta.ai/docs/search-grounding), [image understanding](https://dev.meta.ai/docs/image-understanding), [SAM](https://dev.meta.ai/docs/sam/overview), [Responses](https://dev.meta.ai/docs/protocols/responses), [models](https://dev.meta.ai/docs/models) | Web search belongs on the Responses API with `tools: [{type: web_search}]`. Chat completions do not provide that tool. | The adapter is contract-tested only. SAM stays unimplemented. |

The simply supported beam formulas used in `scenario.py` are the standard Euler-Bernoulli results `M = w L^2 / 8` and `δ = 5 w L^4 / (384 E I)`. They are preliminary elastic checks, not a finite-element solution and not a design approval.
