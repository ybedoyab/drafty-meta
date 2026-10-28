import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";
import { SiteHeader } from "@/components/SiteHeader";

const steps = [
  {
    title: "Start from an example",
    description: "Open the cantilever beam. The dimensions, material, support, and load are already filled in.",
  },
  {
    title: "Adjust the part",
    description: "Change the size in millimeters, pick a material, and set where it is held and where the load acts.",
  },
  {
    title: "Preview the solid",
    description: "The viewer shows the exact CadQuery solid. A picture is only context; it never supplies the dimensions.",
  },
  {
    title: "Run the analysis",
    description: "CalculiX returns displacement, von Mises stress, and the factor of safety. The example does not need an AI key.",
  },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-slate-100">
      <SiteHeader />
      <div className="mx-auto flex min-h-[70vh] max-w-5xl flex-col items-center justify-center px-4 py-16">
        <div className="flex w-full flex-col items-center rounded-3xl border border-indigo-100 bg-white/95 px-8 py-12 text-center shadow-2xl">
          <img src={logo} alt="Drafty" className="mb-6 h-20 w-auto" />
          <h1 className="max-w-3xl text-4xl font-bold text-gray-900">
            Drafty turns a mechanical part into a <span className="text-indigo-600">checked design</span>
          </h1>
          <p className="mt-4 max-w-2xl text-xl text-gray-700">
            <span className="font-semibold text-purple-600">Real finite element analysis</span> for the solid you describe.
          </p>
          <p className="mt-3 max-w-2xl text-lg text-gray-600">
            Enter the dimensions, material, support, and load. Drafty builds the solid and CalculiX reports the stress.
          </p>
          <Link
            to="/studio"
            className="mt-8 inline-flex items-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-10 py-4 text-lg font-bold text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
          >
            Open the studio
          </Link>
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <h2 className="mb-10 text-center text-3xl font-bold text-gray-900">How it works</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <article key={step.title} className="rounded-2xl bg-white p-6 text-center shadow-lg">
              <p className="text-sm font-semibold text-indigo-600">Step {index + 1}</p>
              <h3 className="mt-2 text-xl font-semibold text-gray-900">{step.title}</h3>
              <p className="mt-2 text-gray-600">{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-500">
        <p>
          © 2026 <span className="font-semibold text-indigo-600">Drafty</span> · Meta Global AI Developer Hackathon
        </p>
        <a
          className="mt-1 inline-block text-indigo-500 hover:text-indigo-700 hover:underline"
          href="https://github.com/ybedoyab/drafty-meta"
          target="_blank"
          rel="noreferrer"
        >
          View project on GitHub
        </a>
      </footer>
    </div>
  );
}
