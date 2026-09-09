import fs from "node:fs";
import path from "node:path";
import { PluginError } from "./errors.js";
import { authJsonPath } from "./paths.js";

const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const EARLY_REFRESH_MS = 5 * 60 * 1000;
const API_BASE = "https://api.x.ai/v1";

export type AuthMode = "oidc" | "api_key";

export interface SessionInfo {
  mode: AuthMode;
  email?: string;
  expiresAt?: string;
  expired: boolean;
  source: "grok-cli" | "xai-api-key";
  issuer?: string;
}

export interface ResolvedAuth {
  token: string;
  info: SessionInfo;
}

interface GrokAuthEntry {
  key?: string;
  auth_mode?: string;
  refresh_token?: string;
  expires_at?: string;
  oidc_issuer?: string;
  oidc_client_id?: string;
  email?: string;
  [k: string]: unknown;
}

interface AuthFile {
  [scope: string]: GrokAuthEntry;
}

export function parseExpiresAt(raw?: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.replace(/(\.\d{3})\d+/, "$1");
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isUsableEntry(entry: GrokAuthEntry): boolean {
  const mode = (entry.auth_mode ?? "").toLowerCase();
  if (mode === "web_login") return false;
  return Boolean(entry.key);
}

function pickEntry(file: AuthFile): { scope: string; entry: GrokAuthEntry } | null {
  const usable = Object.entries(file).filter(([, e]) => isUsableEntry(e));
  if (usable.length === 0) return null;
  const ranked = usable
    .map(([scope, entry]) => {
      const exp = parseExpiresAt(entry.expires_at);
      const expired = exp ? exp.getTime() <= Date.now() : false;
      return { scope, entry, exp, expired };
    })
    .sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? 1 : -1;
      const at = a.exp?.getTime() ?? 0;
      const bt = b.exp?.getTime() ?? 0;
      return bt - at;
    });
  return { scope: ranked[0].scope, entry: ranked[0].entry };
}

export function readAuthFile(filePath = authJsonPath()): AuthFile | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as AuthFile;
}

function writeAuthFileAtomic(file: AuthFile, filePath = authJsonPath()): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function sessionFromEntry(entry: GrokAuthEntry): SessionInfo {
  const exp = parseExpiresAt(entry.expires_at);
  const expired = exp ? exp.getTime() <= Date.now() : false;
  const mode = (entry.auth_mode ?? "oidc").toLowerCase() === "api_key" ? "api_key" : "oidc";
  return {
    mode,
    email: entry.email,
    expiresAt: entry.expires_at,
    expired,
    source: "grok-cli",
    issuer: entry.oidc_issuer,
  };
}

export function inspectSession(filePath = authJsonPath()): SessionInfo | null {
  const file = readAuthFile(filePath);
  if (!file) return null;
  const picked = pickEntry(file);
  if (!picked) return null;
  return sessionFromEntry(picked.entry);
}

function envApiKey(): string | undefined {
  const key = process.env.XAI_API_KEY?.trim();
  return key || undefined;
}

async function refreshOidc(entry: GrokAuthEntry): Promise<GrokAuthEntry> {
  const refreshToken = entry.refresh_token;
  const clientId = entry.oidc_client_id;
  if (!refreshToken || !clientId) {
    throw new PluginError("auth_refresh_unavailable", "No refresh_token/client_id in Grok CLI session. Run grok login --oauth.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new PluginError("auth_refresh_failed", `OIDC refresh failed (${res.status}). Run grok_login.`, res.status);
  }
  const json = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new PluginError("auth_refresh_failed", "OIDC refresh returned no access_token. Run grok_login.");
  }
  const next: GrokAuthEntry = { ...entry, key: json.access_token };
  if (json.refresh_token) next.refresh_token = json.refresh_token;
  if (typeof json.expires_in === "number") {
    next.expires_at = new Date(Date.now() + json.expires_in * 1000).toISOString();
  }
  return next;
}

function needsRefresh(entry: GrokAuthEntry): boolean {
  const exp = parseExpiresAt(entry.expires_at);
  if (!exp) return false;
  return exp.getTime() - Date.now() <= EARLY_REFRESH_MS;
}

export async function resolveAuth(filePath = authJsonPath()): Promise<ResolvedAuth> {
  const file = readAuthFile(filePath);
  const picked = file ? pickEntry(file) : null;
  const apiKey = envApiKey();

  if (picked) {
    let entry = picked.entry;
    if (needsRefresh(entry) && entry.refresh_token) {
      try {
        entry = await refreshOidc(entry);
        const nextFile = { ...file!, [picked.scope]: entry };
        writeAuthFileAtomic(nextFile, filePath);
      } catch (err) {
        const stillValid = parseExpiresAt(entry.expires_at);
        if (!stillValid || stillValid.getTime() <= Date.now()) {
          if (apiKey) {
            return {
              token: apiKey,
              info: { mode: "api_key", expired: false, source: "xai-api-key" },
            };
          }
          throw err;
        }
      }
    }
    if (!entry.key) {
      throw new PluginError("auth_missing", "Grok CLI session has no access token. Run grok_login.");
    }
    const info = sessionFromEntry(entry);
    if (info.expired && apiKey) {
      return { token: apiKey, info: { mode: "api_key", expired: false, source: "xai-api-key" } };
    }
    if (info.expired) {
      throw new PluginError("auth_expired", "Grok CLI session expired. Call grok_login (grok login --oauth).");
    }
    return { token: entry.key, info };
  }

  if (apiKey) {
    return { token: apiKey, info: { mode: "api_key", expired: false, source: "xai-api-key" } };
  }

  throw new PluginError(
    "auth_missing",
    "Not signed in to Grok. Call grok_login, or run `grok login --oauth` in a terminal. Optional fallback: set XAI_API_KEY.",
  );
}

export async function probeApi(token: string): Promise<{ ok: boolean; status: number; modelCount?: number; mediaModels?: string[] }> {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  const mediaModels = ids.filter((id) => /imagine|image|video/i.test(id));
  return { ok: true, status: res.status, modelCount: ids.length, mediaModels };
}

export { API_BASE };
