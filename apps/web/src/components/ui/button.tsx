import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
          : "border border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:bg-indigo-50",
        className,
      )}
      {...props}
    />
  );
}
