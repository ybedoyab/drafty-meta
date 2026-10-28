import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";

export function SiteHeader({ trailing }: { trailing?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
      <div className="flex items-center gap-8">
        <Link to="/" className="block">
          <img src={logo} alt="Drafty" className="h-10 w-auto" />
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium">
          <Link to="/" className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600">
            Home
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
