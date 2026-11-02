import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { SiteHeader } from "@/components/SiteHeader";
import { deleteScenario, getHealth, listScenarios, renameScenario } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { forgetScenarioId, rememberScenarioId } from "@/lib/scenario";

export function Projects() {
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const removal = useMutation({
    mutationFn: (id: string) => deleteScenario(id),
    onSuccess: (_, id) => {
      forgetScenarioId(localStorage, id);
      setConfirmId(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["scenarios"] });
    },
    onError: (reason) => {
      setActionError(reason instanceof Error ? reason.message : "The scenario could not be deleted.");
    },
  });
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renaming = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameScenario(id, name),
    onSuccess: () => {
      setRenameId(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["scenarios"] });
    },
    onError: (reason) => {
      setActionError(reason instanceof Error ? reason.message : "The scenario could not be renamed.");
    },
  });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const { session } = useAuth();
  const scenarios = useQuery({
    queryKey: ["scenarios", session?.user.id ?? "local"],
    queryFn: listScenarios,
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <Link to="/scenario/new" className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
            New scenario
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Solver: {health.data?.compute ?? "…"}.{" "}
          {health.data?.modal_available
            ? "Modal Cloud CalculiX can be selected in Studio."
            : "CalculiX runs on the local worker."}{" "}
          {health.data?.auth === "supabase" ? "Rows are stored for this account." : "This browser is in local mode."}
        </p>
        {actionError && <p className="mt-4 text-sm text-red-700">{actionError}</p>}
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {(scenarios.data ?? []).map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                {renameId === item.id ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      renaming.mutate({ id: item.id, name: renameValue });
                    }}
                  >
                    <input
                      className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      value={renameValue}
                      maxLength={120}
                      autoFocus
                      onChange={(event) => setRenameValue(event.target.value)}
                    />
                    <button
                      type="submit"
                      className="text-blue-800 hover:underline disabled:opacity-50"
                      disabled={renaming.isPending}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="text-slate-500 hover:underline"
                      disabled={renaming.isPending}
                      onClick={() => setRenameId(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <p className="flex items-center gap-2 font-medium">
                    {item.name}
                    <button
                      type="button"
                      aria-label={`Rename ${item.name}`}
                      title="Rename"
                      className="font-normal text-slate-500 hover:text-slate-800"
                      onClick={() => {
                        setRenameValue(item.name);
                        setRenameId(item.id);
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                  </p>
                )}
                <p className="text-slate-500">
                  {item.domain ?? "unclassified"} · {item.workflow ?? "understand"} · version {item.version}
                  {item.studio_approval ? ` · CAD ${item.studio_approval}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  to="/scenario/new"
                  className="text-blue-800 hover:underline"
                  onClick={() => rememberScenarioId(localStorage, item.id)}
              >
                  Open
                </Link>
                {confirmId === item.id ? (
                  <>
                    <button
                      type="button"
                      className="text-red-700 hover:underline disabled:opacity-50"
                      disabled={removal.isPending}
                      onClick={() => removal.mutate(item.id)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="text-slate-500 hover:underline"
                      disabled={removal.isPending}
                      onClick={() => setConfirmId(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => setConfirmId(item.id)}>
                    Delete
                  </button>
                )}
              </div>
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
