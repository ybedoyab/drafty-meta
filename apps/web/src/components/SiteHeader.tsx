import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";

export function SiteHeader({ trailing }: { trailing?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
        <Link to="/" className="block">
          <img src={logo} alt="Drafty" className="h-8 w-auto sm:h-10" />
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium">
          <Link to="/" className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            Home
          </Link>
          <Link to="/projects" className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            Projects
          </Link>
          <Link to="/scenario/new" className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            Problem
          </Link>
          <Link to="/login" className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            Sign in
          </Link>
          <Link to="/studio" className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            Studio
          </Link>
        </nav>
      </div>
      {trailing}
    </header>
  );
}
