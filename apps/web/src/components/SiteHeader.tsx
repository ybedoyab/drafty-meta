import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Box, FolderOpen, LayoutDashboard, ListChecks, Plus, UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

export function SiteHeader({ trailing }: { trailing?: ReactNode }) {
  const { session } = useAuth();
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
        <Link to="/" className="block">
          <Logo still className="h-10 w-auto sm:h-12" />
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 text-sm font-medium">
          <Link to="/" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-blue-50 hover:text-blue-800">
            <LayoutDashboard className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
          <Link to="/scenario/new" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-blue-50 hover:text-blue-800">
            <Plus className="h-4 w-4" aria-hidden />
            New Problem
          </Link>
          <Link to="/studio" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-blue-50 hover:text-blue-800">
            <Box className="h-4 w-4" aria-hidden />
            Studio
          </Link>
          <Link to="/projects" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-blue-50 hover:text-blue-800">
            <FolderOpen className="h-4 w-4" aria-hidden />
            Projects
          </Link>
          <Link to="/capabilities" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-blue-50 hover:text-blue-800">
            <ListChecks className="h-4 w-4" aria-hidden />
            Capabilities
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-2">
        {session ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-slate-100"
            onClick={() => void supabase?.auth.signOut()}
          >
            <UserRound className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        ) : (
          <Link to="/login" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-blue-50 hover:text-blue-800">
            <UserRound className="h-4 w-4" aria-hidden />
            Sign in
          </Link>
        )}
        {trailing}
      </div>
    </header>
  );
}
