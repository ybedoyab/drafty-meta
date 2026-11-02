import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight, RotateCw, Shield, UserRound } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SiteHeader } from "@/components/SiteHeader";

const PIPELINE = [
  { step: "Inputs", detail: "Dimensions · material · one support · one load", meta: "you type these" },
  { step: "Solid", detail: "CadQuery builds the part and writes STEP", meta: "STEP file" },
  { step: "Mesh", detail: "Gmsh meshes that STEP file — quadratic tetrahedra by default", meta: "Gmsh" },
  { step: "Solve", detail: "CalculiX runs in its own process, with a timeout", meta: "ccx" },
  { step: "Results", detail: "Displacements and stresses read back into the 3D view", meta: ".dat · .frd" },
] as const;

const BY_HAND_LINE = "Brief → specs → geometry → STEP → mesh → .inp → ccx → parse";

const FLOW_STEPS = [
  {
    actor: "Meta AI",
    who: "ai",
    title: "Turns your words into a ready form",
    detail: "Asks what's missing, then proposes it.",
    pos: "lg:left-1/2 lg:top-0 lg:-translate-x-1/2",
  },
  {
    actor: "You",
    who: "you",
    title: "Approve the form",
    detail: "Nothing runs until you do.",
    pos: "lg:right-0 lg:top-1/2 lg:-translate-y-1/2",
  },
  {
    actor: "Solvers",
    who: "solver",
    title: "Run the solvers",
    detail: "von Mises · displacement · factor of safety, in the 3D view.",
    pos: "lg:bottom-0 lg:left-1/2 lg:-translate-x-1/2",
  },
  {
    actor: "You",
    who: "you",
    title: "Decide",
    detail: "Close it — or adjust and go round again.",
    pos: "lg:left-0 lg:top-1/2 lg:-translate-y-1/2",
  },
] as const;

const SOLVERS = ["CadQuery", "Gmsh", "CalculiX"] as const;

/** Real Meta glyph (Simple Icons, CC0), in Meta blue #0467DF. */
function MetaMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true" focusable="false">
      <path
        fill="#0467DF"
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
      />
    </svg>
  );
}

export function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        {/* ── Hero (kept) ──────────────────────────────────── */}
        <div className="grid gap-10 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:items-start lg:py-16">
          <div>
            {/* Animated wordmark; Logo serves the still image to reduced-motion viewers. */}
            <Logo className="mb-8 h-12 w-auto" />
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">
              Preliminary engineering assistant
            </p>
            <h1 className="mt-3 max-w-xl text-4xl font-semibold leading-tight text-slate-950">
              Describe the problem, or open the studio and run the solver yourself.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-7 text-slate-600">
              Drafty keeps evidence, assumptions, and calculations separate. A picture does not become a dimension, and a
              completed study is not a certified design.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/scenario/new"
                className="inline-flex items-center gap-2 rounded-md bg-blue-800 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Start with AI
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                to="/studio"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                Open Studio
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            <nav aria-label="On this page" className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-5 text-sm">
              <a href="#flow" className="font-medium text-slate-700 underline-offset-4 hover:text-blue-800 hover:underline">
                The Drafty flow
              </a>
            </nav>
          </div>

          {/* Pipeline diagram — the flow every 3D solve follows */}
          <figure className="rounded-lg border border-slate-200 bg-white p-6" aria-labelledby="pipeline-title">
            <figcaption id="pipeline-title" className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-slate-950">From dimensions to a solver result</span>
              <span className="font-mono text-xs text-slate-400">Fig. 1</span>
            </figcaption>
            <ol className="mt-5">
              {PIPELINE.map((node, i) => (
                <li key={node.step} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < PIPELINE.length - 1 && (
                    <span className="absolute left-[15px] top-9 h-[calc(100%-28px)] w-px bg-slate-200" aria-hidden />
                  )}
                  <span
                    className={
                      i === PIPELINE.length - 1
                        ? "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-800 font-mono text-xs font-semibold text-white"
                        : "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white font-mono text-xs font-semibold text-slate-700"
                    }
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 pt-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-semibold text-slate-950">{node.step}</span>
                      <span className="font-mono text-xs text-slate-400">{node.meta}</span>
                    </p>
                    <p className="mt-0.5 text-sm leading-6 text-slate-600">{node.detail}</p>
                    {i < PIPELINE.length - 1 && (
                      <ArrowDown className="mt-1 h-3.5 w-3.5 text-slate-300 lg:hidden" aria-hidden />
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-slate-100 pt-4 font-mono text-xs leading-5 text-slate-500">
              Internal units: m · N · Pa — shown in the interface as mm · N · MPa.
            </p>
          </figure>
        </div>

        {/* ── Merged: Why Drafty + the Drafty flow ─────────── */}
        <section id="flow" aria-labelledby="flow-title" className="scroll-mt-24 border-t border-slate-200 py-10">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            {/* Text column — everything to read, on the left */}
            <div>
              <h2 id="flow-title" className="text-2xl font-semibold leading-snug text-slate-950">
                AI does the hand work. The solver does the math.
              </h2>
              <p className="mt-3 text-base leading-7 text-slate-600">
                Start with the problem, end with a checked result — without turning a brief into specs, chasing inputs,
                or passing files between tools yourself.
              </p>

              <p className="mt-6 text-sm leading-6">
                <span className="font-semibold text-slate-950">By hand: </span>
                <span className="font-mono text-xs text-slate-500">{BY_HAND_LINE}</span>
              </p>
              <p className="mt-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">8 handoffs, all yours</span>
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/scenario/new"
                  className="inline-flex items-center gap-2 rounded-md bg-blue-800 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Start with AI
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  to="/studio"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  Open Studio
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>

              <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600" aria-label="Limits">
                <Shield className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                <span className="font-mono text-xs font-semibold text-slate-950">Image ≠ dimension</span>
                <span aria-hidden>·</span>
                <span className="font-mono text-xs font-semibold text-slate-950">Study ≠ certification</span>
                <span aria-hidden>·</span>
                <span>Safety stays with the responsible engineer.</span>
              </p>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                The wordmark is the 2025 Drafty asset. Reuse still needs organizer confirmation.
              </p>
            </div>

            {/* Diagram column — the cycle, on the right */}
            <figure className="rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="flow-fig-title">
              <figcaption id="flow-fig-title" className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-slate-950">Where the hand work goes</span>
                <span className="font-mono text-xs text-slate-400">Fig. 2</span>
              </figcaption>

            <div className="relative mt-6 border-t border-slate-100 pt-5">
              {/* Clockwise track — desktop only; the list order carries the cycle on small screens */}
              <svg
                className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 lg:block"
                viewBox="0 0 100 100"
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <marker id="cycle-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path className="fill-slate-400" d="M0 0 L6 3 L0 6 Z" />
                  </marker>
                </defs>
                <path className="stroke-slate-300" d="M54 9 A42 42 0 0 1 91 46" fill="none" strokeWidth="0.8" markerEnd="url(#cycle-arrow)" />
                <path className="stroke-slate-300" d="M91 54 A42 42 0 0 1 54 91" fill="none" strokeWidth="0.8" markerEnd="url(#cycle-arrow)" />
                <path className="stroke-slate-300" d="M46 91 A42 42 0 0 1 9 54" fill="none" strokeWidth="0.8" markerEnd="url(#cycle-arrow)" />
                <path className="stroke-slate-300" d="M9 46 A42 42 0 0 1 46 9" fill="none" strokeWidth="0.8" markerEnd="url(#cycle-arrow)" />
              </svg>
              <div className="pointer-events-none absolute left-1/2 top-1/2 hidden w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center lg:flex">
                <RotateCw className="h-5 w-5 text-blue-800" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-slate-950">Iterative</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">Decide feeds the next round</p>
              </div>

              <ol className="relative flex flex-col gap-4 lg:mx-auto lg:h-[450px] lg:max-w-[560px]" aria-label="The Drafty cycle. Start at step 1, Meta AI, and follow it round.">
                {FLOW_STEPS.map((step, i) => (
                  <li key={`${step.actor}-${step.title}`} className={`relative lg:absolute lg:w-44 ${step.pos}`}>
                    {i === 0 && (
                      <span className="absolute -top-3 left-4 z-10 rounded-full bg-blue-800 px-2 py-0.5 text-xs font-semibold text-white">
                        Start here
                      </span>
                    )}
                    <article
                      className={
                        step.who === "ai"
                          ? "flex h-full w-full flex-col rounded-lg border-2 border-blue-800 bg-blue-50 p-4"
                          : "flex h-full w-full flex-col rounded-lg border border-slate-200 bg-white p-4"
                      }
                    >
                      <div className="flex min-h-10 items-center">
                        {step.who === "ai" ? (
                          <MetaMark />
                        ) : step.who === "solver" ? (
                          <span className="flex flex-wrap gap-1">
                            {SOLVERS.map((name) => (
                              <span key={name} className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                                {name}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white">
                            <UserRound className="h-5 w-5 text-slate-700" />
                          </span>
                        )}
                      </div>
                      <p className="mt-3 font-mono text-xs text-slate-500">
                        Step {i + 1} · {step.actor}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold leading-5 text-slate-950">{step.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{step.detail}</p>
                    </article>
                  </li>
                ))}
              </ol>
            </div>
            </figure>
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-200 px-6 py-4 text-sm text-slate-500">
        <p className="mx-auto w-full max-w-6xl">
          3D solves: cantilever, plate, L-bracket, perforated plate. A classroom floor beam stays a preliminary line-load study.
        </p>
      </footer>
    </div>
  );
}
