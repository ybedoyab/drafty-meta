import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";
import { SiteHeader } from "@/components/SiteHeader";

export function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-6xl flex-1 content-center gap-10 px-6 py-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:items-center">
        <div>
          <img src={logo} alt="Drafty" className="mb-8 h-12 w-auto" />
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Preliminary engineering assistant</p>
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
              className="rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Start with AI
            </Link>
            <Link
              to="/studio"
              className="rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Open Studio
            </Link>
          </div>
          <p className="mt-6 max-w-xl text-xs leading-5 text-slate-500">
            The wordmark is the 2025 Drafty asset. Reuse still needs organizer confirmation. Structural safety stays
            with the responsible engineer.
          </p>
        </div>
        <aside className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-950">Two ways in</h2>
          <ol className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
            <li>
              <span className="font-medium text-slate-950">Problem.</span> A guided classroom beam asks for the span and
              the tributary width, cites NSR-10 as a minimum live load, and stops before a 3D solve it cannot represent.
            </li>
            <li>
              <span className="font-medium text-slate-950">Studio.</span> The cantilever, plate, bracket, and perforated
              plate still go to CadQuery, Gmsh, and CalculiX without an AI key.
            </li>
          </ol>
        </aside>
      </main>
      <footer className="border-t border-slate-200 px-6 py-4 text-sm text-slate-500">
        3D solves: cantilever, plate, L-bracket, perforated plate. A classroom floor beam stays a preliminary line-load study.
      </footer>
    </div>
  );
}
