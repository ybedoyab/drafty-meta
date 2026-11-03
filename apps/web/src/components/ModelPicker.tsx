import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { metaModel, type MetaModel } from "@/lib/scenario";
import { cn } from "@/lib/utils";

export function ModelPicker({
  models,
  value,
  onChange,
  disabled = false,
  configured = true,
}: {
  models: MetaModel[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  configured?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = metaModel(models, value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${selected.name}. Change model`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>{selected.short_name}</span>
        <ChevronDown className={cn("h-4 w-4 text-slate-500 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Meta AI model"
          className="absolute bottom-full right-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          {models.map((model) => {
            const isSelected = model.id === selected.id;
            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition",
                  isSelected ? "bg-slate-100" : "hover:bg-slate-50",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{model.name}</span>
                    {model.default && (
                      <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        Default
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-600">{model.description}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-500">{model.detail}</span>
                </span>
                {isSelected && <Check className="mt-1 h-4 w-4 shrink-0 text-blue-700" aria-hidden />}
              </button>
            );
          })}
          <p className="border-t border-slate-100 px-3 py-2 text-xs leading-5 text-slate-500">
            {configured
              ? "Applies to the next message. Switching starts a new Meta conversation; saved inputs are kept."
              : "AI is not connected. Your choice is saved and applies once Meta is configured."}
          </p>
        </div>
      )}
    </div>
  );
}
