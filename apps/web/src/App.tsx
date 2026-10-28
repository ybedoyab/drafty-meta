import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Workstation } from "@/components/Workstation";
import { Landing } from "@/pages/Landing";
import { Scenario } from "@/pages/Scenario";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/scenario/new" element={<Scenario />} />
          <Route
            path="/studio"
            element={
              <div className="h-screen">
                <Workstation />
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
