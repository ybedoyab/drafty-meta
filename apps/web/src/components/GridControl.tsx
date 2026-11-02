import { useState } from "react";
import { Ruler } from "lucide-react";
import { GRID_STEPS_MM, gridStepLabel } from "@/lib/grid";

/** Small toolbar button with a popup for the measured-grid scale. */
export function GridControl({
  visible,
  stepMm,
  onVisibleChange,
  onStepChange,
}: {
  visible: boolean;
  stepMm: number;
  onVisibleChange: (visible: boolean) => void;
  onStepChange: (stepMm: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        title="Measured grid"
        aria-label="Measured grid settings"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 shadow-sm"
      >
        <Ruler size={12} />
        {visible ? gridStepLabel(stepMm) : "Off"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-7 z-20 w-40 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
            <label className="flex cursor-pointer items-center justify-between px-1 py-1 text-[11px] font-medium text-gray-700">
              Grid
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => onVisibleChange(event.target.checked)}
              />
            </label>
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Cell
            </p>
            <div className="grid grid-cols-3 gap-1">
              {GRID_STEPS_MM.map((step) => {
                const active = visible && stepMm === step;
                return (
                  <button
                    key={step}
                    type="button"
                    onClick={() => {
                      onStepChange(step);
                      onVisibleChange(true);
                    }}
                    className={`rounded border px-1 py-1 text-[11px] ${
                      active
                        ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700"
                        : "border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    {gridStepLabel(step)}
                  </button>
                );
              })}
            </div>
            <p className="px-1 pt-1 text-[10px] leading-3 text-gray-400">One square = one cell</p>
          </div>
        </>
      )}
    </div>
  );
}
