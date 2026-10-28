import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthState {
  ready: boolean;
  session: Session | null;
  configured: boolean;
}

const AuthContext = createContext<AuthState>({ ready: false, session: null, configured: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(supabase === null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ ready, session, configured: supabase !== null }),
    [ready, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
