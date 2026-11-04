/**
 * Meta QA provider verification helpers (API-first, UI second).
 * Pure evaluation of scenario payloads — safe for vitest mocks and live QA.
 */
import type { Locator, Page } from "@playwright/test";

export type MetaSessionLike = {
  id?: string;
  name?: string;
  mode?: string | null;
  meta_turns?: number | null;
  previous_response_id?: string | null;
  usage?: Record<string, unknown> | null;
  output_tokens?: number | null;
  messages?: Array<{ role?: string; text?: string } | null> | null;
  inputs?: Record<string, unknown> | null;
};

export type MetaProviderVerdict = {
  ok: boolean;
  /** True when the backend fell back to the offline template (never a Meta PASS). */
  offlineFallback: boolean;
  reason: string;
  mode: string | null;
  meta_turns: number;
  previous_response_id: string | null;
  usage: Record<string, unknown> | null;
  assistantText: string | null;
};

const FABRICATED_CITATION =
  /https?:\/\/doi\.org|according to asce 7-22 section|asce\s*7[- ]?22\s+section/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numericInput(inputs: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!inputs) return null;
  for (const key of keys) {
    const raw = inputs[key];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function latestAssistantText(session: MetaSessionLike): string | null {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    if (entry?.role === "assistant" && typeof entry.text === "string" && entry.text.trim()) {
      return entry.text.trim();
    }
  }
  return null;
}

export function hasProviderUsage(session: MetaSessionLike): boolean {
  const usage = asRecord(session.usage);
  if (usage) {
    for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
      const n = Number(usage[key]);
      if (Number.isFinite(n) && n > 0) return true;
    }
  }
  const out = Number(session.output_tokens);
  return Number.isFinite(out) && out > 0;
}

/**
 * Authenticated API verdict for a Meta turn.
 * Offline-template is never ok. Requires mode=meta-responses, meta_turns>=1,
 * response id and/or usage, a real assistant message, and no invented span/loads/citations.
 */
export function evaluateMetaProviderSession(session: MetaSessionLike): MetaProviderVerdict {
  const mode = session.mode == null ? null : String(session.mode);
  const metaTurns = Number(session.meta_turns || 0);
  const previous =
    session.previous_response_id == null || session.previous_response_id === ""
      ? null
      : String(session.previous_response_id);
  const usage = asRecord(session.usage);
  const assistantText = latestAssistantText(session);

  if (mode === "offline-template") {
    return {
      ok: false,
      offlineFallback: true,
      reason: "offline-template fallback is not a Meta provider PASS",
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }

  if (mode !== "meta-responses") {
    return {
      ok: false,
      offlineFallback: false,
      reason: `expected mode=meta-responses, got ${mode ?? "null"}`,
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }

  if (!(metaTurns >= 1)) {
    return {
      ok: false,
      offlineFallback: false,
      reason: `meta_turns must be >= 1 (got ${metaTurns})`,
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }

  if (!previous && !hasProviderUsage(session)) {
    return {
      ok: false,
      offlineFallback: false,
      reason: "missing previous_response_id and provider usage metadata",
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }

  if (!assistantText) {
    return {
      ok: false,
      offlineFallback: false,
      reason: "no assistant message in scenario.messages",
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }

  if (FABRICATED_CITATION.test(assistantText)) {
    return {
      ok: false,
      offlineFallback: false,
      reason: "assistant text contains fabricated engineering citations",
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }

  const span = numericInput(session.inputs, ["span_m", "span", "length_m"]);
  const live = numericInput(session.inputs, ["live_load_kpa", "live_load", "q_live"]);
  const dead = numericInput(session.inputs, ["dead_load_kpa", "dead_load", "q_dead"]);
  if (span != null && span > 0) {
    return {
      ok: false,
      offlineFallback: false,
      reason: `invented span_m=${span} without user-provided span`,
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }
  if (live != null && live > 0) {
    return {
      ok: false,
      offlineFallback: false,
      reason: `invented live load=${live}`,
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }
  if (dead != null && dead > 0) {
    return {
      ok: false,
      offlineFallback: false,
      reason: `invented dead load=${dead}`,
      mode,
      meta_turns: metaTurns,
      previous_response_id: previous,
      usage,
      assistantText,
    };
  }

  return {
    ok: true,
    offlineFallback: false,
    reason: "meta-responses with provider evidence",
    mode,
    meta_turns: metaTurns,
    previous_response_id: previous,
    usage,
    assistantText,
  };
}

/**
 * Locator for the assistant chat article.
 * Scenario UI renders the role label as exact text "Drafty" (no colon).
 */
export function assistantMessageArticle(page: Page): Locator {
  return page.locator("article").filter({
    has: page.getByText("Drafty", { exact: true }),
  });
}

/** Role-label text that must match the live Scenario assistant markup. */
export function isAssistantRoleLabel(text: string): boolean {
  return text.trim() === "Drafty";
}
