import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Workstation } from "@/components/Workstation";
import { getHealth } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { Projects } from "@/pages/Projects";
import { Scenario } from "@/pages/Scenario";

const queryClient = new QueryClient();

function Guard({ children }: { children: ReactNode }) {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const { ready, session } = useAuth();
  useEffect(() => {
    if (health.data?.auth === "supabase" && !session) {
      queryClient.removeQueries({ queryKey: ["scenarios"] });
    }
  }, [health.data?.auth, session]);
  if (!ready || health.isLoading) {
    return <p className="p-6 text-sm text-slate-500">Loading the session…</p>;
  }
  if (health.data?.auth === "supabase" && !session) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/projects"
              element={
                <Guard>
                  <Projects />
                </Guard>
              }
            />
            <Route
              path="/scenario/new"
              element={
                <Guard>
                  <Scenario />
                </Guard>
              }
            />
            <Route
              path="/studio"
              element={
                <Guard>
                  <div className="h-screen">
                    <Workstation />
                  </div>
                </Guard>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
