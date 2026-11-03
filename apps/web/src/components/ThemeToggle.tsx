import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Icon button that opens a menu to pick System, Light, or Dark. */
export function ThemeToggle() {
  const preference = useThemePreference();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    items.current[OPTIONS.indexOf(current)]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
    // Focus the selected item only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function onMenuKey(event: KeyboardEvent) {
    const index = items.current.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      items.current[(to + OPTIONS.length) % OPTIONS.length]?.focus();
    };
    if (event.key === "Escape") close();
    else if (event.key === "Tab") setOpen(false);
    else if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(OPTIONS.length - 1);
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Color theme: ${current.label}`}
        title="Color theme"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 ${open ? "bg-slate-100" : ""}`}
      >
        <current.Icon className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Color theme"
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-2 w-44 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          {OPTIONS.map(({ value, label, Icon }, index) => {
            const active = value === preference;
            return (
              <button
                key={value}
                ref={(element) => {
                  items.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setThemePreference(value);
                  close();
                }}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-slate-800 outline-none hover:bg-slate-100 focus-visible:bg-slate-100 ${active ? "bg-slate-100" : ""}`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="flex-1">{label}</span>
                {active && <Check className="h-4 w-4 text-slate-600" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
