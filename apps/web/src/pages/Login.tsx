import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export function Login() {
  const { session, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  if (session) return <Navigate to="/projects" replace />;

  async function submit(event: FormEvent, mode: "sign-in" | "register") {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setMessage("");
    const result =
      mode === "register"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (mode === "register" && !result.data.session) {
      setMessage("Account created. Confirm the email, then sign in.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Email and password go to Supabase Auth. The browser only has the publishable key.
        </p>
        {!configured && (
          <p className="mt-4 text-sm text-amber-700">
            This build has no Supabase publishable key. Local mode keeps Problem and Studio open without an account.
          </p>
        )}
        {configured && (
          <form className="mt-6 space-y-3" onSubmit={(event) => submit(event, "sign-in")}>
            <label className="block text-sm">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Password
              <input
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
              >
                Sign in
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={(event) => submit(event, "register")}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
              >
                Create account
              </button>
            </div>
            {message && <p className="text-sm text-amber-700">{message}</p>}
          </form>
        )}
      </main>
    </div>
  );
}
