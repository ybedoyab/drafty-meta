/**
 * Secure QA environment loader for Playwright.
 * Loads repository-root .env without printing secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../../..");
export const WEB_ROOT = path.resolve(here, "../..");
export const QA_PREFIX = "DRAFTY_QA_";
export const SCREENSHOT_DIR = path.join(REPO_ROOT, "docs", "qa", "screenshots");

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value;
    }
    out[key] = value;
  }
  return out;
}

parseEnvFile(path.join(REPO_ROOT, ".env"));
parseEnvFile(path.join(REPO_ROOT, ".env.local"));

function flag(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] || "").trim().toLowerCase());
}

function requiredPresent(...names: string[]): boolean {
  return names.every((name) => Boolean((process.env[name] || "").trim()));
}

export const qaEnv = {
  email: (process.env.DRAFTY_QA_EMAIL || "").trim(),
  password: (process.env.DRAFTY_QA_PASSWORD || "").trim(),
  email2: (process.env.DRAFTY_QA_EMAIL_2 || "").trim(),
  password2: (process.env.DRAFTY_QA_PASSWORD_2 || "").trim(),
  runLiveModal: flag("DRAFTY_QA_RUN_LIVE_MODAL"),
  runLiveMeta: flag("DRAFTY_QA_RUN_LIVE_META"),
  runProduction: flag("DRAFTY_QA_RUN_PRODUCTION"),
  localWeb: (process.env.DRAFTY_QA_LOCAL_WEB || "http://127.0.0.1:5173").trim(),
  localApi: (process.env.DRAFTY_QA_LOCAL_API || "http://127.0.0.1:8000").trim(),
  productionWeb: (process.env.DRAFTY_QA_PRODUCTION_WEB || "https://drafty-web-umber.vercel.app").trim(),
  productionApi: (process.env.DRAFTY_QA_PRODUCTION_API || "https://drafty-api.vercel.app").trim(),
};

export function hasPrimaryCredentials(): boolean {
  return requiredPresent("DRAFTY_QA_EMAIL", "DRAFTY_QA_PASSWORD");
}

export function hasSecondaryCredentials(): boolean {
  return requiredPresent("DRAFTY_QA_EMAIL_2", "DRAFTY_QA_PASSWORD_2");
}

export function targetFromProject(name: string | undefined): {
  kind: "local" | "production";
  web: string;
  api: string;
} {
  if (name === "qa-production") {
    return { kind: "production", web: qaEnv.productionWeb, api: qaEnv.productionApi };
  }
  return { kind: "local", web: qaEnv.localWeb, api: qaEnv.localApi };
}

/** Redact secrets from strings before logging or attaching to reports. */
export function redact(text: string): string {
  let out = text;
  for (const secret of [qaEnv.password, qaEnv.password2, process.env.SUPABASE_SECRET_KEY, process.env.MODEL_API_KEY, process.env.MODAL_TOKEN_SECRET]) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, "[REDACTED_JWT]");
  return out;
}

export function ensureScreenshotDir(): void {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}
