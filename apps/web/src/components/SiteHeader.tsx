import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Box, FolderOpen, LayoutDashboard, Plus, UserRound } from "lucide-react";
import logo from "@/assets/logo.png";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export function SiteHeader({ trailing }: { trailing?: ReactNode }) {
  const { session } = useAuth();
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
        <Link to="/" className="block">
          <img src={logo} alt="Drafty" className="h-10 w-auto sm:h-12" />
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 text-sm font-medium">
          <Link to="/" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            <LayoutDashboard className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
          <Link to="/scenario/new" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            <Plus className="h-4 w-4" aria-hidden />
            New Problem
          </Link>
          <Link to="/studio" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            <Box className="h-4 w-4" aria-hidden />
            Studio
          </Link>
          <Link to="/projects" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            <FolderOpen className="h-4 w-4" aria-hidden />
            Projects
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
          <Link to="/login" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            <UserRound className="h-4 w-4" aria-hidden />
            Sign in
          </Link>
        )}
        {trailing}
      </div>
    </header>
  );
}
