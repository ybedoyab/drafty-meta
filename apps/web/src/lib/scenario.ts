export const CLASSROOM_LIVE_N_PER_M2 = 2000;

export const NSR10_CLASSROOM = {
  title: "NSR-10 Title B, Table B.4.2.1-1",
  section: "Educational classrooms",
  value: "2.0 kN/m² minimum live load",
  status: "verified reference" as const,
  url: "https://camacol.co/sites/default/files/descargables/T%C3%ADtulo%20B%20NSR-10%20del%20Decreto%20926%20del%2019032010.pdf",
  limit: "This citation is an illustrative published minimum. It is not a design combination or an approval.",
};

export interface LineLoad {
  qLineNPerM: number;
  liveNPerM2: number;
  liveStatus: "assumed" | "confirmed";
  formula: string;
}

export function classroomLineLoad(
  deadNPerM2: number,
  tributaryWidthM: number | null,
  selfWeightNPerM = 0,
  liveNPerM2: number | null = null,
): LineLoad {
  if (tributaryWidthM == null || !Number.isFinite(tributaryWidthM) || !(tributaryWidthM > 0)) {
    throw new Error("Tributary width is required. A headcount is not a floor load.");
  }
  if (!Number.isFinite(deadNPerM2) || !Number.isFinite(selfWeightNPerM) || deadNPerM2 < 0 || selfWeightNPerM < 0) {
    throw new Error("Dead load and self-weight cannot be negative.");
  }
  const live = liveNPerM2 == null ? CLASSROOM_LIVE_N_PER_M2 : liveNPerM2;
  if (live < 0) throw new Error("Live load cannot be negative.");
  return {
    qLineNPerM: (deadNPerM2 + live) * tributaryWidthM + selfWeightNPerM,
    liveNPerM2: live,
    liveStatus: liveNPerM2 == null ? "assumed" : "confirmed",
    formula: "q = (q_dead + q_live) × tributary width + beam self-weight",
  };
}

export interface ScenarioDraft {
  version: 1;
  goal: string;
  domain: "mechanical" | "structural" | "other";
  jurisdiction: string;
  template: "classroom-beam" | "custom";
  spanM: string;
  tributaryM: string;
  deadKPa: string;
  selfWeightNPerM: string;
  evidence: { id: string; name: string; role: string }[];
}

export const emptyDraft = (): ScenarioDraft => ({
  version: 1,
  goal: "",
  domain: "structural",
  jurisdiction: "",
  template: "custom",
  spanM: "",
  tributaryM: "",
  deadKPa: "",
  selfWeightNPerM: "0",
  evidence: [],
});

const KEY = "drafty.scenario.v1";

export function loadDraft(): ScenarioDraft {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as ScenarioDraft;
    if (parsed.version !== 1) return emptyDraft();
    return { ...emptyDraft(), ...parsed, evidence: parsed.evidence ?? [] };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft: ScenarioDraft) {
  localStorage.setItem(KEY, JSON.stringify(draft));
}
