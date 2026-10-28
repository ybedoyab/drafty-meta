import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { SiteHeader } from "@/components/SiteHeader";
import { getHealth, listScenarios } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rememberScenarioId } from "@/lib/scenario";
import { supabase } from "@/lib/supabase";

export function Projects() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const { session } = useAuth();
  const scenarios = useQuery({
    queryKey: ["scenarios", session?.user.id ?? "local"],
    queryFn: listScenarios,
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader
        trailing={
          session ? (
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              onClick={() => supabase?.auth.signOut()}
            >
              Sign out
            </button>
          ) : null
        }
      />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <Link to="/scenario/new" className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
            New scenario
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Solver: {health.data?.compute ?? "…"}.{" "}
          {health.data?.modal ? "Modal is selected." : "CalculiX runs on the local worker."}{" "}
          {health.data?.auth === "supabase" ? "Rows are stored for this account." : "This browser is in local mode."}
        </p>
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {(scenarios.data ?? []).map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-slate-500">
                  {item.domain ?? "unclassified"} · {item.workflow ?? "understand"} · version {item.version}
                  {item.studio_approval ? ` · CAD ${item.studio_approval}` : ""}
                </p>
              </div>
              <Link
                to="/scenario/new"
                className="text-indigo-700 hover:underline"
                onClick={() => rememberScenarioId(localStorage, item.id)}
              >
                Open
              </Link>
            </li>
          ))}
          {scenarios.data && scenarios.data.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-500">No saved scenarios yet.</li>
          )}
        </ul>
      </main>
    </div>
  );
}
