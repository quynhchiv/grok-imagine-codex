#!/usr/bin/env node

// src/mcp-server.ts
import readline from "node:readline";
var McpServer = class {
  constructor(serverInfo, options = {}) {
    this.serverInfo = serverInfo;
    this.options = options;
  }
  tools = /* @__PURE__ */ new Map();
  tool(name, description, shape, handler) {
    const properties = {};
    const required = [];
    for (const [field, schema] of Object.entries(shape)) {
      properties[field] = serializeSchema(schema);
      if (!schema.isOptional) required.push(field);
    }
    this.tools.set(name, {
      name,
      description,
      shape,
      inputSchema: {
        type: "object",
        properties,
        additionalProperties: false,
        ...required.length ? { required } : {}
      },
      handler
    });
  }
  async start() {
    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.writeError(null, -32700, "Invalid JSON");
        continue;
      }
      await this.handle(message);
    }
  }
  async handle(message) {
    const id = message.id;
    if (!message.method) {
      if (id !== void 0) this.writeError(id, -32600, "Invalid request");
      return;
    }
    if (message.method.startsWith("notifications/")) return;
    try {
      switch (message.method) {
        case "initialize":
          this.writeResult(id, {
            protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: this.serverInfo,
            instructions: this.options.instructions
          });
          return;
        case "ping":
          this.writeResult(id, {});
          return;
        case "tools/list":
          this.writeResult(id, {
            tools: [...this.tools.values()].map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema
            }))
          });
          return;
        case "tools/call":
          await this.callTool(id, message.params);
          return;
        case "resources/list":
          this.writeResult(id, { resources: [] });
          return;
        case "prompts/list":
          this.writeResult(id, { prompts: [] });
          return;
        case "logging/setLevel":
          this.writeResult(id, {});
          return;
        default:
          this.writeError(id, -32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      this.writeError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }
  async callTool(id, params) {
    const tool = this.tools.get(params?.name);
    if (!tool) {
      this.writeError(id, -32602, "Unknown tool");
      return;
    }
    const args = params?.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      this.writeError(id, -32602, "Tool arguments must be an object");
      return;
    }
    for (const [field, schema] of Object.entries(tool.shape)) {
      const error = schema.validate(args[field], field);
      if (error) {
        this.writeResult(id, { content: [{ type: "text", text: error }], isError: true });
        return;
      }
    }
    this.writeResult(id, await tool.handler(args));
  }
  writeResult(id, result) {
    if (id === void 0) return;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }
  writeError(id, code, message) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }) + "\n");
  }
};
function serializeSchema(schema) {
  const json2 = {};
  for (const [key, value] of Object.entries(schema.json)) {
    json2[key] = value instanceof Object && "json" in value ? serializeSchema(value) : value;
  }
  return json2;
}

// src/schema.ts
var Schema = class _Schema {
  json;
  isOptional = false;
  constructor(json2) {
    this.json = json2;
  }
  optional() {
    this.isOptional = true;
    return this;
  }
  describe(description) {
    this.json.description = description;
    return this;
  }
  min(value) {
    if (this.json.type === "string") this.json.minLength = value;
    else if (this.json.type === "array") this.json.minItems = value;
    else this.json.minimum = value;
    return this;
  }
  max(value) {
    if (this.json.type === "string") this.json.maxLength = value;
    else if (this.json.type === "array") this.json.maxItems = value;
    else this.json.maximum = value;
    return this;
  }
  int() {
    this.json.type = "integer";
    return this;
  }
  validate(value, field) {
    if (value === void 0) return this.isOptional ? null : `${field} is required`;
    const type = this.json.type;
    if (type === "string" && typeof value !== "string") return `${field} must be a string`;
    if ((type === "number" || type === "integer") && typeof value !== "number") return `${field} must be a number`;
    if (type === "integer" && !Number.isInteger(value)) return `${field} must be an integer`;
    if (type === "boolean" && typeof value !== "boolean") return `${field} must be a boolean`;
    if (type === "array" && !Array.isArray(value)) return `${field} must be an array`;
    if (Array.isArray(this.json.enum) && !this.json.enum.includes(value)) return `${field} has an unsupported value`;
    if (typeof value === "string" && typeof this.json.minLength === "number" && value.length < this.json.minLength) {
      return `${field} is too short`;
    }
    if (Array.isArray(value)) {
      if (typeof this.json.minItems === "number" && value.length < this.json.minItems) return `${field} has too few items`;
      if (typeof this.json.maxItems === "number" && value.length > this.json.maxItems) return `${field} has too many items`;
      const item = this.json.items;
      if (item instanceof _Schema) {
        for (let i = 0; i < value.length; i += 1) {
          const error = item.validate(value[i], `${field}[${i}]`);
          if (error) return error;
        }
      }
    }
    if (typeof value === "number") {
      if (typeof this.json.minimum === "number" && value < this.json.minimum) return `${field} is below minimum`;
      if (typeof this.json.maximum === "number" && value > this.json.maximum) return `${field} is above maximum`;
    }
    return null;
  }
};
var z = {
  string: () => new Schema({ type: "string" }),
  boolean: () => new Schema({ type: "boolean" }),
  number: () => new Schema({ type: "number" }),
  enum: (values) => new Schema({ type: "string", enum: [...values] }),
  array: (item) => new Schema({ type: "array", items: item }),
  any: () => new Schema({})
};

// src/auth.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/errors.ts
var PluginError = class extends Error {
  code;
  status;
  constructor(code, message, status) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.status = status;
  }
};
function redactSecrets(text) {
  return text.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [redacted]").replace(/("?(?:key|access_token|refresh_token|api_key)"?\s*[:=]\s*")[^"]+"/gi, '$1[redacted]"').replace(/xai-[A-Za-z0-9]+/g, "xai-[redacted]");
}
function errorMessage(err) {
  if (err instanceof PluginError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return redactSecrets(err.message);
  return redactSecrets(String(err));
}

// src/paths.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function grokHome() {
  if (process.env.GROK_HOME && process.env.GROK_HOME.trim()) {
    return expandHome(process.env.GROK_HOME.trim());
  }
  return path.join(os.homedir(), ".grok");
}
function authJsonPath() {
  return path.join(grokHome(), "auth.json");
}
function defaultOutputDir() {
  if (process.env.GROK_IMAGINE_OUT && process.env.GROK_IMAGINE_OUT.trim()) {
    return path.resolve(expandHome(process.env.GROK_IMAGINE_OUT.trim()));
  }
  return path.join(os.homedir(), "grok-imagine-output");
}
function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
function resolveExistingFile(p) {
  const resolved = path.resolve(expandHome(p));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }
  return resolved;
}
function ensureDir(dir) {
  const resolved = path.resolve(expandHome(dir));
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
function slugFilename(prompt, ext, index) {
  const slug = prompt.normalize("NFKD").replace(/[^\w\s-]+/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const suffix = index != null ? `-${index + 1}` : "";
  const base = slug || "grok";
  const cleanExt = ext.replace(/^\./, "");
  return `${base}-${ts}${suffix}.${cleanExt}`;
}
function resolveGrokBinary() {
  if (process.env.GROK_BIN && process.env.GROK_BIN.trim()) {
    const p = expandHome(process.env.GROK_BIN.trim());
    if (fs.existsSync(p)) return p;
  }
  const homeBin = path.join(grokHome(), "bin", process.platform === "win32" ? "grok.exe" : "grok");
  if (fs.existsSync(homeBin)) return homeBin;
  return findOnPath("grok");
}
function resolveCodexBinary() {
  return findOnPath("codex");
}
function resolveClaudeBinary() {
  return findOnPath("claude");
}
function resolveHermesBinary() {
  return findOnPath("hermes");
}
function findOnPath(name) {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const parts = pathEnv.split(path.delimiter);
  const extra = process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of parts) {
    if (!dir) continue;
    const candidates = [path.join(dir, name), ...extra.map((ext) => path.join(dir, `${name}${ext.toLowerCase()}`)), ...extra.map((ext) => path.join(dir, `${name}${ext.toUpperCase()}`))];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch {
      }
    }
  }
  return null;
}

// src/auth.ts
var TOKEN_URL = "https://auth.x.ai/oauth2/token";
var EARLY_REFRESH_MS = 5 * 60 * 1e3;
var API_BASE = "https://api.x.ai/v1";
function parseExpiresAt(raw) {
  if (!raw) return null;
  const trimmed = raw.replace(/(\.\d{3})\d+/, "$1");
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isUsableEntry(entry) {
  const mode = (entry.auth_mode ?? "").toLowerCase();
  if (mode === "web_login" || mode === "api_key") return false;
  return Boolean(entry.key);
}
function pickEntry(file) {
  const usable = Object.entries(file).filter(([, e]) => isUsableEntry(e));
  if (usable.length === 0) return null;
  const ranked = usable.map(([scope, entry]) => {
    const exp = parseExpiresAt(entry.expires_at);
    const expired = exp ? exp.getTime() <= Date.now() : false;
    return { scope, entry, exp, expired };
  }).sort((a, b) => {
    if (a.expired !== b.expired) return a.expired ? 1 : -1;
    const at = a.exp?.getTime() ?? 0;
    const bt = b.exp?.getTime() ?? 0;
    return bt - at;
  });
  return { scope: ranked[0].scope, entry: ranked[0].entry };
}
function readAuthFile(filePath = authJsonPath()) {
  if (!fs2.existsSync(filePath)) return null;
  const raw = fs2.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}
function writeAuthFileAtomic(file, filePath = authJsonPath()) {
  const dir = path2.dirname(filePath);
  fs2.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs2.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}
`, { encoding: "utf8", mode: 384 });
  fs2.renameSync(tmp, filePath);
}
function sessionFromEntry(entry) {
  const exp = parseExpiresAt(entry.expires_at);
  const expired = exp ? exp.getTime() <= Date.now() : false;
  return {
    mode: "oidc",
    email: entry.email,
    expiresAt: entry.expires_at,
    expired,
    source: "grok-cli",
    issuer: entry.oidc_issuer
  };
}
function inspectSession(filePath = authJsonPath()) {
  const file = readAuthFile(filePath);
  if (!file) return null;
  const picked = pickEntry(file);
  if (!picked) return null;
  return sessionFromEntry(picked.entry);
}
async function refreshOidc(entry) {
  const refreshToken = entry.refresh_token;
  const clientId = entry.oidc_client_id;
  if (!refreshToken || !clientId) {
    throw new PluginError("auth_refresh_unavailable", "No refresh_token/client_id in Grok CLI session. Run grok login --oauth.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new PluginError("auth_refresh_failed", `OIDC refresh failed (${res.status}). Run grok_login.`, res.status);
  }
  const json2 = JSON.parse(text);
  if (!json2.access_token) {
    throw new PluginError("auth_refresh_failed", "OIDC refresh returned no access_token. Run grok_login.");
  }
  const next = { ...entry, key: json2.access_token };
  if (json2.refresh_token) next.refresh_token = json2.refresh_token;
  if (typeof json2.expires_in === "number") {
    next.expires_at = new Date(Date.now() + json2.expires_in * 1e3).toISOString();
  }
  return next;
}
function needsRefresh(entry) {
  const exp = parseExpiresAt(entry.expires_at);
  if (!exp) return false;
  return exp.getTime() - Date.now() <= EARLY_REFRESH_MS;
}
async function resolveAuth(filePath = authJsonPath()) {
  const file = readAuthFile(filePath);
  const picked = file ? pickEntry(file) : null;
  if (picked) {
    let entry = picked.entry;
    if (needsRefresh(entry) && entry.refresh_token) {
      try {
        entry = await refreshOidc(entry);
        const nextFile = { ...file, [picked.scope]: entry };
        writeAuthFileAtomic(nextFile, filePath);
      } catch (err) {
        const stillValid = parseExpiresAt(entry.expires_at);
        if (!stillValid || stillValid.getTime() <= Date.now()) {
          throw err;
        }
      }
    }
    if (!entry.key) {
      throw new PluginError("auth_missing", "Grok CLI session has no access token. Run grok_login.");
    }
    const info = sessionFromEntry(entry);
    if (info.expired) {
      throw new PluginError("auth_expired", "Grok CLI session expired. Call grok_login (grok login --oauth).");
    }
    return { token: entry.key, info };
  }
  throw new PluginError(
    "auth_missing",
    "No Grok CLI OAuth session found. Call grok_login or run `grok login --oauth`."
  );
}
async function probeApi(token) {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const json2 = await res.json();
  const ids = (json2.data ?? []).map((m) => m.id).filter((id) => Boolean(id));
  const mediaModels = ids.filter((id) => /imagine|image|video/i.test(id));
  return { ok: true, status: res.status, modelCount: ids.length, mediaModels };
}

// src/grok-cli.ts
import { spawn, spawnSync } from "node:child_process";
var URL_RE = /https?:\/\/[^\s"'<>]+/g;
function grokVersion(bin = resolveGrokBinary()) {
  if (!bin) return null;
  try {
    const r = spawnSyncCapture(bin, ["--version"], 8e3);
    const text = `${r.stdout}
${r.stderr}`.trim();
    return text.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}
function spawnSyncCapture(command, args, timeoutMs) {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    env: process.env
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status
  };
}
async function runGrokLogin(mode, timeoutMs = 3e5) {
  const bin = resolveGrokBinary();
  if (!bin) {
    throw new PluginError(
      "grok_cli_missing",
      "Grok CLI not found. Install from https://x.ai/cli then retry. Windows: irm https://x.ai/cli/install.ps1 | iex"
    );
  }
  const args = mode === "device" ? ["login", "--device-auth"] : ["login", "--oauth"];
  const command = `${bin} ${args.join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false
    });
    let out = "";
    const onData = (buf) => {
      out += buf.toString("utf8");
      if (out.length > 2e4) out = out.slice(-12e3);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        command,
        mode,
        exitCode: null,
        urls: extractUrls(out),
        outputTail: tail(out),
        timedOut: true
      });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new PluginError("grok_cli_spawn_failed", `Failed to start Grok CLI: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command,
        mode,
        exitCode: code,
        urls: extractUrls(out),
        outputTail: tail(out),
        timedOut: false
      });
    });
  });
}
async function runGrokLogout() {
  const bin = resolveGrokBinary();
  if (!bin) {
    throw new PluginError("grok_cli_missing", "Grok CLI not found.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["logout"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let out = "";
    const onData = (buf) => {
      out += buf.toString("utf8");
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => reject(new PluginError("grok_cli_spawn_failed", err.message)));
    child.on("close", (code) => {
      resolve({ command: `${bin} logout`, exitCode: code, outputTail: tail(out) });
    });
  });
}
function extractUrls(text) {
  return [...new Set(text.match(URL_RE) ?? [])];
}
function tail(text, n = 1500) {
  const t = text.trim();
  return t.length <= n ? t : t.slice(-n);
}

// src/imagine.ts
import path4 from "node:path";

// src/media.ts
import fs3 from "node:fs";
import path3 from "node:path";
var IMAGE_MAX_BYTES = 20 * 1024 * 1024;
var VIDEO_MAX_BYTES = 80 * 1024 * 1024;
var MCP_IMAGE_MAX_CHARS = 12e5;
var MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};
function mimeFromPath(filePath, fallback) {
  const ext = path3.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? fallback;
}
function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}
function isDataUrl(value) {
  return /^data:/i.test(value);
}
async function toMediaUrl(input, kind) {
  const trimmed = input.trim();
  if (isHttpUrl(trimmed) || isDataUrl(trimmed)) return trimmed;
  const filePath = resolveExistingFile(trimmed);
  const stat = fs3.statSync(filePath);
  const max = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (stat.size > max) {
    throw new PluginError(
      "file_too_large",
      `${kind} file is ${(stat.size / (1024 * 1024)).toFixed(1)} MB (max ${max / (1024 * 1024)} MB): ${filePath}`
    );
  }
  const mime = mimeFromPath(filePath, kind === "image" ? "image/jpeg" : "video/mp4");
  const b64 = fs3.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${b64}`;
}
async function downloadToFile(url, dest, token) {
  const headers = {};
  if (token && /(?:^|\.)x\.ai$/i.test(safeHost(url))) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = redactSecrets((await res.text()).slice(0, 400));
    throw new PluginError("download_failed", `Download failed (${res.status}): ${body}`, res.status);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = path3.dirname(dest);
  ensureDir(dir);
  fs3.writeFileSync(dest, buf);
  return dest;
}
function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
function writeBuffer(dest, data) {
  ensureDir(path3.dirname(dest));
  fs3.writeFileSync(dest, data);
  return dest;
}
function decodeB64(b64) {
  return Buffer.from(b64, "base64");
}
function mcpImagePayload(b64, mimeType) {
  if (!b64 || b64.length > MCP_IMAGE_MAX_CHARS) return null;
  return { type: "image", data: b64, mimeType };
}
function extFromMime(mime, fallback) {
  if (!mime) return fallback;
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return fallback;
}
function resolveOutPath(out, dir, filename) {
  if (out && out.trim()) {
    const p = path3.resolve(expandHome(out.trim()));
    const ext = path3.extname(p);
    if (!ext) {
      ensureDir(p);
      return path3.join(p, filename);
    }
    ensureDir(path3.dirname(p));
    return p;
  }
  ensureDir(dir);
  return path3.join(dir, filename);
}

// src/imagine.ts
var IMAGE_MODEL = "grok-imagine-image-2.0";
var VIDEO_MODEL = "grok-imagine-video-1.5";
var VIDEO_POLL_MS = 3e3;
var VIDEO_TIMEOUT_MS = 10 * 60 * 1e3;
async function apiJson(token, method, apiPath, body, timeoutMs = 18e4) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...body !== void 0 ? { "Content-Type": "application/json" } : {}
      },
      body: body !== void 0 ? JSON.stringify(body) : void 0,
      signal: ctrl.signal
    });
    const text = await res.text();
    let json2 = {};
    try {
      json2 = text ? JSON.parse(text) : {};
    } catch {
      json2 = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const msg = redactSecrets(formatApiError(json2, text));
      if (res.status === 401) {
        throw new PluginError("auth_unauthorized", `Imagine API 401. Call grok_login. ${msg}`, 401);
      }
      if (res.status === 403) {
        throw new PluginError(
          "auth_forbidden",
          `Imagine API 403 (the connected Grok account may not have Imagine entitlement or billing). ${msg}`,
          403
        );
      }
      throw new PluginError("imagine_http", `Imagine API ${res.status}: ${msg}`, res.status);
    }
    return { status: res.status, json: json2 };
  } finally {
    clearTimeout(t);
  }
}
function formatApiError(json2, text) {
  const err = json2.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err;
    return [o.code, o.message].filter(Boolean).join(": ") || JSON.stringify(err);
  }
  return json2.message || text.slice(0, 400) || "unknown error";
}
async function saveImageItems(token, items, prompt, out) {
  const dir = defaultOutputDir();
  const paths = [];
  let mimeType = "image/jpeg";
  let moderationOk = true;
  let preview;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.respect_moderation === false) moderationOk = false;
    mimeType = item.mime_type || mimeType;
    const ext = extFromMime(mimeType, "jpg");
    const filename = slugFilename(prompt, ext, items.length > 1 ? i : void 0);
    const dest = resolveOutPath(out, dir, filename);
    if (item.b64_json) {
      writeBuffer(dest, decodeB64(item.b64_json));
      if (!preview) {
        const mcp = mcpImagePayload(item.b64_json, mimeType);
        if (mcp) preview = { data: mcp.data, mimeType: mcp.mimeType };
      }
    } else if (item.url) {
      const downloaded = await downloadToFile(item.url, dest, token);
      paths.push(downloaded);
      continue;
    } else {
      throw new PluginError("imagine_empty", "Image response had neither b64_json nor url.");
    }
    paths.push(dest);
  }
  return { paths, mimeType, model: IMAGE_MODEL, moderationOk, preview };
}
async function generateImage(token, opts) {
  const n = Math.min(10, Math.max(1, opts.n ?? 1));
  const model = opts.model || IMAGE_MODEL;
  const body = {
    model,
    prompt: opts.prompt,
    n,
    response_format: "b64_json"
  };
  if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
  if (opts.resolution) body.resolution = opts.resolution;
  if (opts.quality) body.quality = opts.quality;
  const { json: json2 } = await apiJson(token, "POST", "/images/generations", body);
  const data = json2.data ?? [];
  if (data.length === 0) throw new PluginError("imagine_empty", "No images returned.");
  const result = await saveImageItems(token, data, opts.prompt, opts.out);
  result.model = json2.model || model;
  return result;
}
async function editImage(token, opts) {
  if (opts.images.length === 0) throw new PluginError("invalid_argument", "edit_image requires at least one source image.");
  if (opts.images.length > 5) throw new PluginError("invalid_argument", "edit_image supports at most 5 source images.");
  const urls = await Promise.all(opts.images.map((img) => toMediaUrl(img, "image")));
  const model = opts.model || IMAGE_MODEL;
  const body = {
    model,
    prompt: opts.prompt,
    n: 1,
    response_format: "b64_json"
  };
  if (opts.quality) body.quality = opts.quality;
  if (urls.length === 1) {
    body.image = { url: urls[0] };
  } else {
    body.images = urls.map((url) => ({ url }));
    body.aspect_ratio = opts.aspectRatio || "auto";
  }
  if (opts.aspectRatio && urls.length === 1) {
    body.aspect_ratio = opts.aspectRatio;
  }
  const { json: json2 } = await apiJson(token, "POST", "/images/edits", body);
  const data = json2.data ?? [];
  if (data.length === 0) throw new PluginError("imagine_empty", "No edited image returned.");
  const result = await saveImageItems(token, data, opts.prompt, opts.out);
  result.model = json2.model || model;
  return result;
}
async function generateVideo(token, opts) {
  const imageCount = opts.image ? 1 : 0;
  const refCount = opts.referenceImages?.length ?? 0;
  if (imageCount && refCount) {
    throw new PluginError("invalid_argument", "Do not mix image (I2V first frame) with reference_images (R2V). Use one mode.");
  }
  if ((opts.referenceImages?.length ?? 0) > 7) {
    throw new PluginError("invalid_argument", "reference_images supports at most 7 images.");
  }
  if ((opts.voices?.length ?? 0) > 3) {
    throw new PluginError("invalid_argument", "voices supports at most 3 preset voice ids.");
  }
  const mode = opts.mode || (opts.image ? "image" : refCount || opts.voices?.length ? "reference" : "text");
  const model = opts.model || VIDEO_MODEL;
  const duration = opts.duration ?? 6;
  if (duration < 1 || duration > 15) {
    throw new PluginError("invalid_argument", "duration must be 1–15 seconds.");
  }
  const resolution = opts.resolution || "480p";
  if (mode === "reference" && resolution === "1080p") {
    throw new PluginError("invalid_argument", "reference-to-video is capped at 720p.");
  }
  const body = {
    model,
    prompt: opts.prompt,
    duration
  };
  if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
  if (resolution) body.resolution = resolution;
  if (opts.generateAudio === false) body.generate_audio = false;
  if (mode === "image") {
    if (!opts.image) throw new PluginError("invalid_argument", "image mode requires `image` (first frame).");
    body.image = { url: await toMediaUrl(opts.image, "image") };
  } else if (mode === "reference") {
    if (opts.referenceImages?.length) {
      body.reference_images = await Promise.all(
        opts.referenceImages.map(async (img) => ({ url: await toMediaUrl(img, "image") }))
      );
    }
    if (opts.voices?.length) {
      body.reference_audios = opts.voices.map((voice_id) => ({ voice_id }));
    }
    if (!opts.referenceImages?.length && !opts.voices?.length) {
      throw new PluginError("invalid_argument", "reference mode needs reference_images and/or voices.");
    }
  }
  const { json: json2 } = await apiJson(token, "POST", "/videos/generations", body, 6e4);
  const requestId = String(json2.request_id ?? "");
  if (!requestId) throw new PluginError("imagine_empty", "Video start returned no request_id.");
  if (opts.requestIdOnly) {
    return { path: "", requestId, model, moderationOk: true, status: "pending" };
  }
  return pollAndSaveVideo(token, requestId, opts.prompt, opts.out, model);
}
async function editVideo(token, opts) {
  const model = opts.model || VIDEO_MODEL;
  const body = {
    model,
    prompt: opts.prompt,
    video: { url: await toMediaUrl(opts.video, "video") }
  };
  const { json: json2 } = await apiJson(token, "POST", "/videos/edits", body, 6e4);
  const requestId = String(json2.request_id ?? "");
  if (!requestId) throw new PluginError("imagine_empty", "Video edit returned no request_id.");
  return pollAndSaveVideo(token, requestId, opts.prompt, opts.out, model);
}
async function extendVideo(token, opts) {
  const duration = opts.duration ?? 6;
  if (duration < 2 || duration > 10) {
    throw new PluginError("invalid_argument", "extend duration must be 2–10 seconds.");
  }
  const model = opts.model || VIDEO_MODEL;
  const body = {
    model,
    prompt: opts.prompt,
    duration,
    video: { url: await toMediaUrl(opts.video, "video") }
  };
  const { json: json2 } = await apiJson(token, "POST", "/videos/extensions", body, 6e4);
  const requestId = String(json2.request_id ?? "");
  if (!requestId) throw new PluginError("imagine_empty", "Video extend returned no request_id.");
  return pollAndSaveVideo(token, requestId, opts.prompt, opts.out, model);
}
async function getVideoJob(token, requestId, prompt = "video", out) {
  return pollAndSaveVideo(token, requestId, prompt, out, VIDEO_MODEL, 1);
}
async function pollAndSaveVideo(token, requestId, prompt, out, model, maxWaitMs = VIDEO_TIMEOUT_MS) {
  const started2 = Date.now();
  while (Date.now() - started2 < maxWaitMs) {
    const { json: json2 } = await apiJson(token, "GET", `/videos/${encodeURIComponent(requestId)}`, void 0, 3e4);
    const status = String(json2.status ?? "pending");
    if (status === "done") {
      const video = json2.video ?? {};
      if (!video.url) throw new PluginError("imagine_empty", "Video done but no url.");
      const filename = slugFilename(prompt, "mp4");
      const dest = resolveOutPath(out, defaultOutputDir(), filename);
      const saved = await downloadToFile(video.url, dest, token);
      return {
        path: saved,
        url: video.url,
        requestId,
        duration: video.duration,
        model: json2.model || model,
        moderationOk: video.respect_moderation !== false,
        status
      };
    }
    if (status === "failed" || status === "expired") {
      const err = json2.error;
      throw new PluginError(
        err?.code || "video_failed",
        err?.message || `Video job ${status} (${requestId}).`
      );
    }
    await sleep(VIDEO_POLL_MS);
  }
  throw new PluginError(
    "video_timeout",
    `Video still pending after ${Math.round(maxWaitMs / 1e3)}s. request_id=${requestId}. Call get_video_job later.`
  );
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function describeImageResult(result) {
  const lines = [
    `Saved ${result.paths.length} image(s) with ${result.model}.`,
    ...result.paths.map((p) => `- ${path4.resolve(p)}`)
  ];
  if (!result.moderationOk) lines.push("Warning: moderation flagged this result.");
  return lines.join("\n");
}
function describeVideoResult(result) {
  const lines = [
    `Video ${result.status} (${result.model}).`,
    result.path ? `File: ${path4.resolve(result.path)}` : "No local file yet.",
    `request_id: ${result.requestId}`
  ];
  if (result.duration != null) lines.push(`Duration: ${result.duration}s`);
  if (!result.moderationOk) lines.push("Warning: moderation flagged this result.");
  return lines.join("\n");
}

// src/flow-store.ts
import fs4 from "node:fs";
import path5 from "node:path";
function nid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
function node(partial) {
  return { status: "idle", config: {}, ...partial };
}
function templateFlow(name) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (name === "image") {
    const a = node({
      id: "prompt",
      type: "prompt",
      x: 80,
      y: 180,
      name: "Prompt",
      config: { text: "A tiny red origami fox on a white background, simple product photo, no text" }
    });
    const b = node({
      id: "gen",
      type: "generate_image",
      x: 360,
      y: 160,
      name: "Tạo ảnh",
      config: { aspect_ratio: "1:1", quality: "auto" }
    });
    const c = node({ id: "out", type: "output", x: 660, y: 180, name: "Output" });
    return {
      id: "current",
      name: "Tạo ảnh",
      nodes: [a, b, c],
      edges: [
        { id: "e1", from: a.id, to: b.id },
        { id: "e2", from: b.id, to: c.id }
      ],
      updatedAt: now
    };
  }
  if (name === "image-edit-video") {
    const p2 = node({
      id: "prompt",
      type: "prompt",
      x: 40,
      y: 200,
      name: "Prompt",
      config: { text: "A cinematic origami fox on a studio table, warm rim light, no text" }
    });
    const g2 = node({
      id: "gen",
      type: "generate_image",
      x: 300,
      y: 80,
      name: "Tạo ảnh",
      config: { aspect_ratio: "16:9", quality: "auto" }
    });
    const e = node({
      id: "edit",
      type: "edit_image",
      x: 560,
      y: 80,
      name: "Sửa ảnh",
      config: { prompt: "" }
    });
    const v2 = node({
      id: "vid",
      type: "generate_video",
      x: 560,
      y: 280,
      name: "Tạo video",
      config: { mode: "image", duration: 6, resolution: "720p" }
    });
    const o2 = node({ id: "out", type: "output", x: 840, y: 180, name: "Output" });
    return {
      id: "current",
      name: "Ảnh → sửa → video",
      nodes: [p2, g2, e, v2, o2],
      edges: [
        { id: "e1", from: p2.id, to: g2.id },
        { id: "e2", from: g2.id, to: e.id },
        { id: "e3", from: e.id, to: v2.id },
        { id: "e4", from: v2.id, to: o2.id }
      ],
      updatedAt: now
    };
  }
  const p = node({
    id: "prompt",
    type: "prompt",
    x: 60,
    y: 200,
    name: "Prompt",
    config: { text: "A cinematic origami fox on a studio table, warm rim light, no text" }
  });
  const g = node({
    id: "gen",
    type: "generate_image",
    x: 340,
    y: 80,
    name: "Tạo ảnh (frame 1)",
    config: { aspect_ratio: "16:9", quality: "auto" }
  });
  const v = node({
    id: "vid",
    type: "generate_video",
    x: 340,
    y: 300,
    name: "Animate I2V",
    config: { mode: "image", duration: 6, resolution: "720p" }
  });
  const o = node({ id: "out", type: "output", x: 640, y: 190, name: "Output" });
  return {
    id: "current",
    name: "Ảnh → video",
    nodes: [p, g, v, o],
    edges: [
      { id: "e1", from: p.id, to: g.id },
      { id: "e2", from: g.id, to: v.id },
      { id: "e3", from: v.id, to: o.id }
    ],
    updatedAt: now
  };
}
function newNode(type, x = 200, y = 200) {
  const names = {
    prompt: "Prompt",
    generate_image: "Tạo ảnh",
    edit_image: "Sửa ảnh",
    generate_video: "Tạo video",
    edit_video: "Sửa video",
    extend_video: "Nối video",
    output: "Output"
  };
  const config = type === "prompt" ? { text: "" } : type === "generate_image" ? { aspect_ratio: "1:1", quality: "auto" } : type === "generate_video" ? { mode: "image", duration: 6, resolution: "720p" } : type === "extend_video" ? { duration: 6 } : {};
  return {
    id: nid(type.slice(0, 3)),
    type,
    x,
    y,
    name: names[type],
    config,
    status: "idle"
  };
}
function flowsDir() {
  return ensureDir(path5.join(defaultOutputDir(), "flows"));
}
function flowPath() {
  return path5.join(flowsDir(), "current.json");
}
var current = templateFlow("image-to-video");
var run = null;
var listeners = /* @__PURE__ */ new Set();
function loadFlowFromDisk() {
  try {
    const p = flowPath();
    if (fs4.existsSync(p)) {
      const parsed = JSON.parse(fs4.readFileSync(p, "utf8"));
      if (parsed?.nodes && parsed?.edges) {
        current = parsed;
        return current;
      }
    }
  } catch {
  }
  return current;
}
function getFlow() {
  return current;
}
function getRun() {
  return run;
}
function setRun(next) {
  run = next;
  emit({ type: "run", at: (/* @__PURE__ */ new Date()).toISOString(), run });
}
function saveFlow(flow, persist = true) {
  current = {
    ...flow,
    id: flow.id || "current",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    nodes: flow.nodes.map((n) => ({ ...n })),
    edges: flow.edges.map((e) => ({ ...e }))
  };
  if (persist) {
    fs4.writeFileSync(flowPath(), `${JSON.stringify(current, null, 2)}
`, "utf8");
  }
  emit({ type: "flow", at: current.updatedAt, flow: current, run });
  return current;
}
function applyTemplate(name) {
  return saveFlow(templateFlow(name));
}
function addNodeToFlow(type, x, y) {
  const n = newNode(type, x, y);
  current.nodes.push(n);
  saveFlow(current);
  return n;
}
function updateNode(id, patch) {
  const idx = current.nodes.findIndex((n) => n.id === id);
  if (idx < 0) return null;
  const next = { ...current.nodes[idx], ...patch };
  current.nodes[idx] = next;
  emit({ type: "node", at: (/* @__PURE__ */ new Date()).toISOString(), node: next, run });
  return next;
}
function resetNodeStatuses() {
  current.nodes = current.nodes.map((n) => ({
    ...n,
    status: "idle",
    error: void 0,
    startedAt: void 0,
    finishedAt: void 0
  }));
  emit({ type: "flow", at: (/* @__PURE__ */ new Date()).toISOString(), flow: current, run });
}
function subscribe(fn) {
  listeners.add(fn);
  fn({ type: "hello", at: (/* @__PURE__ */ new Date()).toISOString(), flow: current, run });
  return () => listeners.delete(fn);
}
function emit(ev) {
  for (const fn of listeners) {
    try {
      fn(ev);
    } catch {
    }
  }
}
function logFlow(message) {
  emit({ type: "log", at: (/* @__PURE__ */ new Date()).toISOString(), message, run });
}
loadFlowFromDisk();

// src/flow-engine.ts
var IMAGE_TYPES = /* @__PURE__ */ new Set(["generate_image", "edit_image"]);
function topoSort(flow) {
  const incoming = /* @__PURE__ */ new Map();
  const outs = /* @__PURE__ */ new Map();
  for (const n of flow.nodes) {
    incoming.set(n.id, 0);
    outs.set(n.id, []);
  }
  for (const e of flow.edges) {
    if (!incoming.has(e.to) || !outs.has(e.from)) {
      throw new PluginError("invalid_flow", `Edge ${e.id} points at a missing node.`);
    }
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    outs.get(e.from).push(e.to);
  }
  const q = [...flow.nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id)];
  const order = [];
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const nxt of outs.get(id) ?? []) {
      const left = (incoming.get(nxt) ?? 1) - 1;
      incoming.set(nxt, left);
      if (left === 0) q.push(nxt);
    }
  }
  if (order.length !== flow.nodes.length) {
    throw new PluginError("invalid_flow", "Flow has a cycle. Disconnect a loop before running.");
  }
  return order;
}
function parents(flow, id) {
  const ids = flow.edges.filter((e) => e.to === id).map((e) => e.from);
  return flow.nodes.filter((n) => ids.includes(n.id));
}
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function gatherInputs(node2, preds) {
  let prompt = str(node2.config.prompt) || str(node2.config.text);
  const images = [];
  const videos = [];
  for (const p of preds) {
    if (p.type === "prompt") {
      const t = str(p.output?.prompt) || str(p.config.text) || str(p.config.prompt);
      if (t && !prompt) prompt = t;
      else if (t && p.type === "prompt" && !str(node2.config.prompt)) prompt = prompt || t;
    }
    if (p.output?.prompt && !str(node2.config.prompt) && p.type === "prompt") prompt = p.output.prompt;
    if (p.output?.image) images.push(p.output.image);
    if (p.output?.paths) {
      for (const path8 of p.output.paths) {
        if (/\.(png|jpe?g|webp|gif)$/i.test(path8)) images.push(path8);
        if (/\.(mp4|webm|mov)$/i.test(path8)) videos.push(path8);
      }
    }
    if (p.output?.video) videos.push(p.output.video);
    if (IMAGE_TYPES.has(p.type) && p.output?.image) {
    }
  }
  if (!prompt) {
    for (const p of preds) {
      const t = str(p.output?.prompt);
      if (t) {
        prompt = t;
        break;
      }
    }
  }
  return { prompt, images: [...new Set(images)], videos: [...new Set(videos)] };
}
var abort = null;
function isRunning() {
  return abort != null && !abort.signal.aborted;
}
function stopFlow(reason = "Stopped by user") {
  if (abort) abort.abort();
  const flow = getFlow();
  for (const n of flow.nodes) {
    if (n.status === "running" || n.status === "queued") {
      updateNode(n.id, { status: "skipped", error: reason, finishedAt: (/* @__PURE__ */ new Date()).toISOString() });
    }
  }
  const run2 = {
    id: getRun()?.id || "run",
    flowId: flow.id,
    status: "stopped",
    startedAt: getRun()?.startedAt || (/* @__PURE__ */ new Date()).toISOString(),
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    error: reason
  };
  setRun(run2);
}
async function execNode(token, node2, preds, signal) {
  if (signal.aborted) throw new PluginError("stopped", "Run stopped.");
  const ins = gatherInputs(node2, preds);
  switch (node2.type) {
    case "prompt": {
      const prompt = str(node2.config.text) || str(node2.config.prompt) || ins.prompt;
      return { prompt };
    }
    case "output": {
      const last = preds[preds.length - 1]?.output ?? {};
      return { ...last, prompt: last.prompt || ins.prompt, image: last.image || ins.images[0], video: last.video || ins.videos[0] };
    }
    case "generate_image": {
      if (!ins.prompt) throw new PluginError("invalid_flow", `${node2.name || node2.id}: missing prompt.`);
      const r = await generateImage(token, {
        prompt: ins.prompt,
        aspectRatio: str(node2.config.aspect_ratio) || void 0,
        resolution: str(node2.config.resolution) || void 0,
        quality: str(node2.config.quality) || void 0,
        n: typeof node2.config.n === "number" ? node2.config.n : 1,
        out: str(node2.config.out) || void 0
      });
      return { prompt: ins.prompt, image: r.paths[0], paths: r.paths, mime: r.mimeType };
    }
    case "edit_image": {
      const images = ins.images.length ? ins.images : str(node2.config.image) ? [str(node2.config.image)] : [];
      if (!images.length) throw new PluginError("invalid_flow", `${node2.name || node2.id}: connect an image node.`);
      const prompt = ins.prompt || "Refine this image, keep the subject.";
      const r = await editImage(token, {
        prompt,
        images,
        aspectRatio: str(node2.config.aspect_ratio) || void 0,
        quality: str(node2.config.quality) || void 0,
        out: str(node2.config.out) || void 0
      });
      return { prompt, image: r.paths[0], paths: r.paths, mime: r.mimeType };
    }
    case "generate_video": {
      const mode = str(node2.config.mode) || (ins.images.length ? "image" : "text");
      const prompt = ins.prompt || "Gentle camera push-in, cinematic lighting.";
      if (mode === "image" && !ins.images[0] && !str(node2.config.image)) {
        throw new PluginError("invalid_flow", `${node2.name || node2.id}: I2V needs an image input.`);
      }
      const r = await generateVideo(token, {
        prompt,
        mode,
        image: mode === "image" ? ins.images[0] || str(node2.config.image) : void 0,
        referenceImages: mode === "reference" ? ins.images : void 0,
        duration: typeof node2.config.duration === "number" ? node2.config.duration : 6,
        aspectRatio: str(node2.config.aspect_ratio) || void 0,
        resolution: str(node2.config.resolution) || void 0,
        out: str(node2.config.out) || void 0
      });
      return { prompt, image: ins.images[0], video: r.path, paths: [r.path], mime: "video/mp4" };
    }
    case "edit_video": {
      const video = ins.videos[0] || str(node2.config.video);
      if (!video) throw new PluginError("invalid_flow", `${node2.name || node2.id}: connect a video node.`);
      const prompt = ins.prompt || "Edit this video.";
      const r = await editVideo(token, { prompt, video, out: str(node2.config.out) || void 0 });
      return { prompt, video: r.path, paths: [r.path], mime: "video/mp4" };
    }
    case "extend_video": {
      const video = ins.videos[0] || str(node2.config.video);
      if (!video) throw new PluginError("invalid_flow", `${node2.name || node2.id}: connect a video node.`);
      const prompt = ins.prompt || "Continue the motion.";
      const r = await extendVideo(token, {
        prompt,
        video,
        duration: typeof node2.config.duration === "number" ? node2.config.duration : 6,
        out: str(node2.config.out) || void 0
      });
      return { prompt, video: r.path, paths: [r.path], mime: "video/mp4" };
    }
    default:
      throw new PluginError("invalid_flow", `Unknown node type ${node2.type}`);
  }
}
async function runFlow() {
  if (isRunning()) throw new PluginError("run_busy", "A flow is already running. Stop it first.");
  const flow = getFlow();
  const order = topoSort(flow);
  abort = new AbortController();
  const run2 = {
    id: `run-${Date.now()}`,
    flowId: flow.id,
    status: "running",
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  setRun(run2);
  resetNodeStatuses();
  for (const id of order) updateNode(id, { status: "queued" });
  logFlow(`Run ${run2.id} started (${order.length} nodes).`);
  try {
    const { token } = await resolveAuth();
    const byId = () => new Map(getFlow().nodes.map((n) => [n.id, n]));
    for (const id of order) {
      if (abort.signal.aborted) {
        run2.status = "stopped";
        run2.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
        run2.error = "Stopped";
        setRun(run2);
        return { run: run2, flow: getFlow() };
      }
      const node2 = byId().get(id);
      if (!node2) continue;
      updateNode(id, { status: "running", error: void 0, startedAt: (/* @__PURE__ */ new Date()).toISOString() });
      run2.currentNodeId = id;
      setRun(run2);
      logFlow(`▶ ${node2.name || node2.type}`);
      try {
        const preds = parents(getFlow(), id);
        const output = await execNode(token, { ...byId().get(id) }, preds, abort.signal);
        updateNode(id, { status: "success", output, finishedAt: (/* @__PURE__ */ new Date()).toISOString() });
        logFlow(`✓ ${node2.name || node2.type}${output.image || output.video ? ` → ${output.image || output.video}` : ""}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateNode(id, { status: "error", error: message, finishedAt: (/* @__PURE__ */ new Date()).toISOString() });
        for (const rest of order.slice(order.indexOf(id) + 1)) {
          updateNode(rest, { status: "skipped", error: "Upstream failed" });
        }
        run2.status = "error";
        run2.error = message;
        run2.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
        setRun(run2);
        logFlow(`✗ ${node2.name || node2.type}: ${message}`);
        saveFlow(getFlow());
        return { run: run2, flow: getFlow() };
      }
    }
    run2.status = "success";
    run2.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    run2.currentNodeId = void 0;
    setRun(run2);
    logFlow("Run finished.");
    saveFlow(getFlow());
    emit({ type: "flow", at: (/* @__PURE__ */ new Date()).toISOString(), flow: getFlow(), run: run2 });
    return { run: run2, flow: getFlow() };
  } finally {
    abort = null;
  }
}
function summarizeFlow(flow, run2) {
  const lines = [
    `Flow: ${flow.name} (${flow.nodes.length} nodes, ${flow.edges.length} edges)`,
    run2 ? `Run: ${run2.status}${run2.currentNodeId ? ` @ ${run2.currentNodeId}` : ""}${run2.error ? ` — ${run2.error}` : ""}` : "Run: idle",
    ...flow.nodes.map((n) => {
      const art = n.output?.image || n.output?.video || "";
      return `- [${n.status}] ${n.name || n.id} (${n.type})${art ? ` ${art}` : ""}${n.error ? ` ERR ${n.error}` : ""}`;
    })
  ];
  return lines.join("\n");
}

// src/browser.ts
import { spawn as spawn2 } from "node:child_process";
function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    spawn2("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (platform === "darwin") {
    spawn2("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn2("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

// src/ui-server.ts
import fs5 from "node:fs";
import http from "node:http";
import os2 from "node:os";
import path6 from "node:path";

// src/ui/index.html
var ui_default = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grok Imagine Flow</title>
  <style>
    :root {
      --bg: #14141a;
      --bg2: #1c1c24;
      --panel: #22222c;
      --node: #2b2b36;
      --line: #3d3d4a;
      --text: #ececf1;
      --muted: #9a9aab;
      --accent: #ff6d5a;
      --run: #22c55e;
      --warn: #f59e0b;
      --err: #ef4444;
      --cyan: #2ac9d8;
      --purple: #a78bfa;
      --orange: #fb923c;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 13px/1.4 "Segoe UI", Inter, system-ui, sans-serif; overflow: hidden; }
    #app { display: grid; grid-template-rows: 52px 1fr 140px; height: 100%; }
    header {
      display: flex; align-items: center; gap: 12px; padding: 0 14px;
      background: var(--bg2); border-bottom: 1px solid var(--line);
    }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: .02em; }
    .logo { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); display: grid; place-items: center; font-size: 12px; color: #1a1a1a; font-weight: 800; }
    .name { background: transparent; border: 0; color: var(--text); font: inherit; font-weight: 650; min-width: 160px; }
    .spacer { flex: 1; }
    button, select {
      background: #32323e; color: var(--text); border: 1px solid var(--line);
      border-radius: 8px; padding: 7px 12px; cursor: pointer; font: inherit;
    }
    button:hover { filter: brightness(1.08); }
    button.primary { background: var(--run); color: #052e12; border-color: #16a34a; font-weight: 700; }
    button.danger { background: #3a1d1d; color: #fecaca; border-color: #7f1d1d; }
    .pill { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: #2a2a36; color: var(--muted); }
    .pill.run { background: #14532d; color: #bbf7d0; }
    .pill.err { background: #7f1d1d; color: #fecaca; }
    main { display: grid; grid-template-columns: 220px 1fr 280px; min-height: 0; }
    .palette, .inspector {
      background: var(--panel); border-right: 1px solid var(--line); padding: 12px; overflow: auto;
    }
    .inspector { border-right: 0; border-left: 1px solid var(--line); }
    h3 { margin: 0 0 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .p-item {
      display: flex; gap: 8px; align-items: center; padding: 8px; border-radius: 8px;
      background: var(--node); margin-bottom: 6px; cursor: grab; border: 1px solid transparent;
    }
    .p-item:hover { border-color: var(--accent); }
    .sw { width: 8px; height: 28px; border-radius: 4px; }
    .canvas-wrap { position: relative; overflow: hidden; background:
      radial-gradient(circle, #2a2a35 1px, transparent 1px) 0 0 / 18px 18px var(--bg);
    }
    svg.wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .node {
      position: absolute; width: 220px; background: var(--node); border: 1px solid #3a3a48;
      border-radius: 10px; box-shadow: 0 8px 24px #0006; user-select: none;
    }
    .node.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .node.running { border-color: var(--run); animation: pulse 1.1s ease-in-out infinite; }
    .node.error { border-color: var(--err); }
    .node.success { border-color: #16a34a; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 4px #22c55e33; } }
    .n-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #3a3a48; }
    .n-body { padding: 8px 10px 12px; color: var(--muted); font-size: 12px; min-height: 42px; }
    .n-body img, .n-body video { width: 100%; border-radius: 6px; margin-top: 6px; background: #000; max-height: 110px; object-fit: cover; }
    .port { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: #9ca3af; border: 2px solid #111; }
    .port.in { left: -7px; top: 22px; }
    .port.out { right: -7px; top: 22px; background: var(--accent); }
    .status { margin-left: auto; font-size: 10px; text-transform: uppercase; }
    label { display: block; color: var(--muted); margin: 8px 0 4px; font-size: 11px; }
    input, textarea, select.field {
      width: 100%; background: #1a1a22; color: var(--text); border: 1px solid var(--line);
      border-radius: 6px; padding: 7px 8px; font: inherit;
    }
    textarea { min-height: 90px; resize: vertical; }
    #log {
      background: #0f0f14; border-top: 1px solid var(--line); padding: 8px 12px;
      font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #c4c4d4; overflow: auto;
    }
    .hint { color: var(--muted); font-size: 11px; margin-top: 10px; }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <div class="brand"><div class="logo">G</div> Imagine Flow</div>
      <input class="name" id="flowName" />
      <span class="pill" id="runPill">idle</span>
      <div class="spacer"></div>
      <select id="template">
        <option value="">Mẫu…</option>
        <option value="image">Tạo ảnh</option>
        <option value="image-to-video">Ảnh → video</option>
        <option value="image-edit-video">Ảnh → sửa → video</option>
      </select>
      <button id="btnSave">Lưu</button>
      <button id="btnStop" class="danger">Dừng</button>
      <button id="btnRun" class="primary">Chạy flow</button>
    </header>
    <main>
      <aside class="palette">
        <h3>Nodes</h3>
        <div class="p-item" data-type="prompt"><div class="sw" style="background:var(--purple)"></div>Prompt</div>
        <div class="p-item" data-type="generate_image"><div class="sw" style="background:var(--cyan)"></div>Tạo ảnh</div>
        <div class="p-item" data-type="edit_image"><div class="sw" style="background:#38bdf8"></div>Sửa ảnh</div>
        <div class="p-item" data-type="generate_video"><div class="sw" style="background:var(--orange)"></div>Tạo video</div>
        <div class="p-item" data-type="edit_video"><div class="sw" style="background:#f97316"></div>Sửa video</div>
        <div class="p-item" data-type="extend_video"><div class="sw" style="background:#fb7185"></div>Nối video</div>
        <div class="p-item" data-type="output"><div class="sw" style="background:#64748b"></div>Output</div>
        <p class="hint">Kéo node vào canvas. Nối chấm phải → chấm trái. Chạy để xem node sáng theo realtime.</p>
      </aside>
      <div class="canvas-wrap" id="canvas">
        <svg class="wires" id="wires"></svg>
      </div>
      <aside class="inspector" id="inspector">
        <h3>Chi tiết</h3>
        <div id="insp">Chọn một node</div>
      </aside>
    </main>
    <div id="log"></div>
  </div>
  <script>
    const COLORS = {
      prompt: getComputedStyle(document.documentElement).getPropertyValue("--purple").trim() || "#a78bfa",
      generate_image: "#2ac9d8",
      edit_image: "#38bdf8",
      generate_video: "#fb923c",
      edit_video: "#f97316",
      extend_video: "#fb7185",
      output: "#64748b",
    };
    const LABELS = {
      prompt: "Prompt", generate_image: "Tạo ảnh", edit_image: "Sửa ảnh",
      generate_video: "Tạo video", edit_video: "Sửa video", extend_video: "Nối video", output: "Output",
    };
    let flow = { id: "current", name: "Flow", nodes: [], edges: [], updatedAt: "" };
    let selected = null;
    let connecting = null;
    let drag = null;
    const logEl = document.getElementById("log");
    const canvas = document.getElementById("canvas");
    const wires = document.getElementById("wires");

    function log(msg) {
      const t = new Date().toLocaleTimeString();
      logEl.textContent += \`[\${t}] \${msg}\\n\`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    async function api(path, opts) {
      const res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    function nodeEl(n) {
      let el = document.getElementById("node-" + n.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "node";
        el.id = "node-" + n.id;
        el.innerHTML = '<div class="port in" data-port="in"></div><div class="n-head"><div class="sw" style="width:8px;height:18px;border-radius:3px"></div><span class="title"></span><span class="status"></span></div><div class="n-body"></div><div class="port out" data-port="out"></div>';
        canvas.appendChild(el);
        el.addEventListener("mousedown", (ev) => {
          if (ev.target.classList.contains("port")) return;
          selected = n.id;
          const rect = canvas.getBoundingClientRect();
          const cur = flow.nodes.find((x) => x.id === n.id) || n;
          drag = { id: n.id, ox: ev.clientX - rect.left - cur.x, oy: ev.clientY - rect.top - cur.y };
          render();
        });
        el.querySelector(".port.out").addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          connecting = { from: n.id };
        });
        el.querySelector(".port.in").addEventListener("mouseup", (ev) => {
          ev.stopPropagation();
          if (connecting && connecting.from !== n.id) {
            flow.edges.push({ id: "e" + Math.random().toString(36).slice(2, 7), from: connecting.from, to: n.id });
            connecting = null;
            saveSilent();
            render();
          }
        });
      }
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      el.classList.toggle("selected", selected === n.id);
      el.classList.toggle("running", n.status === "running");
      el.classList.toggle("error", n.status === "error");
      el.classList.toggle("success", n.status === "success");
      el.querySelector(".sw").style.background = COLORS[n.type] || "#888";
      el.querySelector(".title").textContent = n.name || LABELS[n.type] || n.type;
      el.querySelector(".status").textContent = n.status || "idle";
      const body = el.querySelector(".n-body");
      const excerpt = (n.config && (n.config.text || n.config.prompt || n.config.mode)) || "";
      let media = "";
      if (n.output && n.output.image) media = '<img src="/media?p=' + encodeURIComponent(n.output.image) + '" />';
      else if (n.output && n.output.video) media = '<video src="/media?p=' + encodeURIComponent(n.output.video) + '" muted controls></video>';
      body.innerHTML = (excerpt ? String(excerpt).slice(0, 90) : "<i>chưa cấu hình</i>") + (n.error ? '<div style="color:#fecaca;margin-top:4px">' + n.error + "</div>" : "") + media;
      return el;
    }

    function drawWires() {
      const r = canvas.getBoundingClientRect();
      wires.setAttribute("viewBox", "0 0 " + r.width + " " + r.height);
      wires.innerHTML = "";
      for (const e of flow.edges) {
        const a = flow.nodes.find((n) => n.id === e.from);
        const b = flow.nodes.find((n) => n.id === e.to);
        if (!a || !b) continue;
        const x1 = a.x + 220, y1 = a.y + 28;
        const x2 = b.x, y2 = b.y + 28;
        const d = "M " + x1 + " " + y1 + " C " + (x1 + 60) + " " + y1 + ", " + (x2 - 60) + " " + y2 + ", " + x2 + " " + y2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#ff6d5a");
        path.setAttribute("stroke-width", "2.2");
        path.setAttribute("opacity", "0.85");
        wires.appendChild(path);
      }
    }

    function inspector() {
      const n = flow.nodes.find((x) => x.id === selected);
      const box = document.getElementById("insp");
      if (!n) { box.innerHTML = "Chọn một node"; return; }
      const cfg = n.config || {};
      let fields = "";
      if (n.type === "prompt") fields += field("text", "Prompt", cfg.text || "", true);
      if (n.type === "generate_image" || n.type === "edit_image" || n.type === "generate_video" || n.type === "edit_video" || n.type === "extend_video") {
        if (n.type !== "generate_image") fields += field("prompt", "Prompt (ghi đè)", cfg.prompt || "", true);
        if (n.type === "generate_image" || n.type === "edit_image") {
          fields += field("aspect_ratio", "Tỉ lệ", cfg.aspect_ratio || "auto");
          fields += field("quality", "Quality", cfg.quality || "auto");
        }
        if (n.type === "generate_video") {
          fields += field("mode", "Mode (text|image|reference)", cfg.mode || "image");
          fields += field("duration", "Duration (s)", cfg.duration || 6);
          fields += field("resolution", "Resolution", cfg.resolution || "720p");
        }
        if (n.type === "extend_video") fields += field("duration", "Duration (s)", cfg.duration || 6);
      }
      box.innerHTML = "<div style='font-weight:650;margin-bottom:6px'>" + (n.name || n.type) + "</div>" +
        field("name", "Tên", n.name || "") + fields +
        "<button id='delNode' class='danger' style='margin-top:12px;width:100%'>Xóa node</button>";
      box.querySelectorAll("[data-k]").forEach((el) => {
        el.addEventListener("input", () => {
          const k = el.getAttribute("data-k");
          if (k === "name") n.name = el.value;
          else {
            n.config = n.config || {};
            const v = el.value;
            n.config[k] = k === "duration" || k === "n" ? Number(v) : v;
          }
        });
        el.addEventListener("change", saveSilent);
      });
      document.getElementById("delNode").onclick = () => {
        flow.nodes = flow.nodes.filter((x) => x.id !== n.id);
        flow.edges = flow.edges.filter((e) => e.from !== n.id && e.to !== n.id);
        selected = null;
        saveSilent();
        render();
      };
    }

    function field(k, label, val, area) {
      if (area) return "<label>" + label + "</label><textarea data-k='" + k + "'>" + String(val) + "</textarea>";
      return "<label>" + label + "</label><input data-k='" + k + "' value='" + String(val).replace(/"/g, "&quot;") + "' />";
    }

    function render() {
      document.getElementById("flowName").value = flow.name || "";
      const ids = new Set(flow.nodes.map((n) => n.id));
      [...canvas.querySelectorAll(".node")].forEach((el) => {
        if (!ids.has(el.id.slice(5))) el.remove();
      });
      flow.nodes.forEach(nodeEl);
      drawWires();
      inspector();
    }

    canvas.addEventListener("mousemove", (ev) => {
      if (!drag) return;
      const n = flow.nodes.find((x) => x.id === drag.id);
      if (!n) return;
      const rect = canvas.getBoundingClientRect();
      n.x = Math.max(16, ev.clientX - rect.left - drag.ox);
      n.y = Math.max(16, ev.clientY - rect.top - drag.oy);
      nodeEl(n);
      drawWires();
    });
    window.addEventListener("mouseup", () => {
      if (drag) saveSilent();
      drag = null;
      connecting = null;
    });

    document.querySelectorAll(".p-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const type = el.getAttribute("data-type");
        const data = await api("/api/node", { method: "POST", body: JSON.stringify({ type, x: 280 + Math.random() * 80, y: 120 + Math.random() * 80 }) });
        flow = data.flow;
        selected = data.node.id;
        render();
      });
    });

    document.getElementById("flowName").addEventListener("change", () => {
      flow.name = document.getElementById("flowName").value;
      saveSilent();
    });
    document.getElementById("btnSave").onclick = () => saveSilent(true);
    document.getElementById("btnRun").onclick = async () => {
      await saveSilent();
      try { await api("/api/run", { method: "POST", body: "{}" }); log("Đang chạy…"); }
      catch (e) { log("Lỗi: " + e.message); }
    };
    document.getElementById("btnStop").onclick = async () => {
      await api("/api/stop", { method: "POST", body: "{}" });
    };
    document.getElementById("template").onchange = async (ev) => {
      const name = ev.target.value;
      if (!name) return;
      const data = await api("/api/template", { method: "POST", body: JSON.stringify({ name }) });
      flow = data.flow;
      ev.target.value = "";
      selected = null;
      render();
      log("Đã áp mẫu " + data.flow.name);
    };

    async function saveSilent(toast) {
      const data = await api("/api/flow", { method: "PUT", body: JSON.stringify(flow) });
      flow = data.flow;
      if (toast) log("Đã lưu flow.");
    }

    function applyState(s) {
      if (s.flow) flow = s.flow;
      const pill = document.getElementById("runPill");
      const st = (s.run && s.run.status) || "idle";
      pill.textContent = st;
      pill.className = "pill" + (st === "running" ? " run" : st === "error" ? " err" : "");
      render();
    }

    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "log" && msg.message) log(msg.message);
      if (msg.flow) flow = msg.flow;
      if (msg.node) {
        const i = flow.nodes.findIndex((n) => n.id === msg.node.id);
        if (i >= 0) flow.nodes[i] = msg.node;
      }
      applyState(msg);
    };

    api("/api/state").then(applyState).catch((e) => log(e.message));
  </script>
</body>
</html>
`;

// src/ui-server.ts
var started = null;
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function allowedMediaRoots() {
  return [path6.resolve(defaultOutputDir()), path6.resolve(os2.homedir(), "Desktop")];
}
function isAllowedFile(filePath) {
  const resolved = path6.resolve(filePath);
  return allowedMediaRoots().some((root) => resolved === root || resolved.startsWith(root + path6.sep));
}
function mimeFor(filePath) {
  const ext = path6.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return "application/octet-stream";
}
async function handle(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const method = req.method || "GET";
  if (method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ui_default);
    return;
  }
  if (method === "GET" && url.pathname === "/api/state") {
    json(res, 200, { flow: getFlow(), run: getRun() });
    return;
  }
  if (method === "PUT" && url.pathname === "/api/flow") {
    const body = JSON.parse(await readBody(req) || "{}");
    json(res, 200, { flow: saveFlow(body) });
    return;
  }
  if (method === "POST" && url.pathname === "/api/template") {
    const body = JSON.parse(await readBody(req) || "{}");
    const name = body.name || "image-to-video";
    json(res, 200, { flow: applyTemplate(name) });
    return;
  }
  if (method === "POST" && url.pathname === "/api/node") {
    const body = JSON.parse(await readBody(req) || "{}");
    if (!body.type) {
      json(res, 400, { error: "type required" });
      return;
    }
    const node2 = addNodeToFlow(body.type, body.x ?? 240, body.y ?? 160);
    json(res, 200, { flow: getFlow(), node: node2 });
    return;
  }
  if (method === "POST" && url.pathname === "/api/run") {
    void runFlow().catch((err) => {
      process.stderr.write(`[grok-imagine-ui] run failed: ${err instanceof Error ? err.message : err}
`);
    });
    json(res, 202, { ok: true, run: getRun(), flow: getFlow() });
    return;
  }
  if (method === "POST" && url.pathname === "/api/stop") {
    stopFlow();
    json(res, 200, { ok: true, run: getRun(), flow: getFlow() });
    return;
  }
  if (method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const send = (ev) => {
      res.write(`data: ${JSON.stringify(ev)}

`);
    };
    const unsub = subscribe(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15e3);
    req.on("close", () => {
      clearInterval(ping);
      unsub();
    });
    return;
  }
  if (method === "GET" && url.pathname === "/media") {
    const filePath = url.searchParams.get("p") || "";
    if (!filePath || !isAllowedFile(filePath) || !fs5.existsSync(filePath)) {
      json(res, 404, { error: "not found" });
      return;
    }
    const buf = fs5.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mimeFor(filePath), "Cache-Control": "no-store" });
    res.end(buf);
    return;
  }
  json(res, 404, { error: "not found" });
}
async function ensureUiServer(preferredPort) {
  if (started) return started;
  const port0 = preferredPort ?? Number(process.env.GROK_IMAGINE_UI_PORT || 3847);
  for (let port = port0; port < port0 + 20; port++) {
    const server2 = await tryListen(port);
    if (!server2) continue;
    server2.on("request", (req, res) => {
      handle(req, res).catch((err) => {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
    });
    const url = `http://127.0.0.1:${port}/`;
    started = { url, port, server: server2 };
    process.stderr.write(`[grok-imagine-ui] ${url}
`);
    return started;
  }
  throw new PluginError("ui_bind_failed", "Could not bind local flow UI port.");
}
function tryListen(port) {
  return new Promise((resolve) => {
    const server2 = http.createServer();
    server2.once("error", () => resolve(null));
    server2.listen(port, "127.0.0.1", () => resolve(server2));
  });
}
function uiUrl() {
  return started?.url ?? null;
}

// src/doctor.ts
import fs6 from "node:fs";
import path7 from "node:path";
function writableTarget(target) {
  let current2 = path7.resolve(target);
  while (!fs6.existsSync(current2)) {
    const parent = path7.dirname(current2);
    if (parent === current2) return false;
    current2 = parent;
  }
  try {
    fs6.accessSync(current2, fs6.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
async function runDoctor(checkApi = true) {
  const checks = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push(
    nodeMajor >= 20 ? { name: "node", status: "pass", message: `Node.js ${process.versions.node}` } : {
      name: "node",
      status: "fail",
      message: `Node.js ${process.versions.node}; version 20+ is required`,
      fix: "Install Node.js 20 LTS or newer, then restart your agent host."
    }
  );
  const hosts = [
    ["Codex", resolveCodexBinary()],
    ["Claude", resolveClaudeBinary()],
    ["Hermes", resolveHermesBinary()]
  ].filter((entry) => Boolean(entry[1]));
  checks.push(
    hosts.length ? { name: "agent_host", status: "pass", message: hosts.map(([name, bin]) => `${name}: ${bin}`).join("; ") } : {
      name: "agent_host",
      status: "warn",
      message: "Codex, Claude, and Hermes CLIs were not found on PATH. A desktop host may still run the plugin.",
      fix: "Install or update one supported agent host and restart the terminal."
    }
  );
  const grok = resolveGrokBinary();
  checks.push(
    grok ? { name: "grok_cli", status: "pass", message: `${grokVersion(grok) ?? "Grok CLI"} (${grok})` } : {
      name: "grok_cli",
      status: "fail",
      message: "Grok CLI is not installed.",
      fix: "Install Grok CLI from https://x.ai/cli, then restart your agent host."
    }
  );
  let session = null;
  let sessionReadError = null;
  try {
    session = inspectSession();
  } catch (err) {
    sessionReadError = errorMessage(err);
  }
  let auth = null;
  try {
    auth = await resolveAuth();
    checks.push({
      name: "authentication",
      status: "pass",
      message: `Grok CLI OAuth session is usable${session?.email ? ` for ${session.email}` : ""}.`
    });
  } catch (err) {
    checks.push({
      name: "authentication",
      status: "fail",
      message: sessionReadError ?? errorMessage(err),
      fix: sessionReadError ? "Allow the plugin to read the local Grok auth file, then restart your agent host." : "Run `grok login --oauth`, then retry."
    });
  }
  if (auth && checkApi) {
    try {
      const api = await probeApi(auth.token);
      if (!api.ok) {
        checks.push({
          name: "xai_api",
          status: "fail",
          message: `xAI API connection returned HTTP ${api.status}.`,
          fix: "Check account/model access, then run `grok login --oauth` again."
        });
      } else {
        const media = api.mediaModels ?? [];
        checks.push({
          name: "xai_api",
          status: media.length ? "pass" : "warn",
          message: media.length ? `Connected; media models: ${media.join(", ")}` : "Connected, but no image/video model was listed for this account.",
          ...media.length ? {} : { fix: "Check xAI billing and Imagine model entitlement." }
        });
      }
    } catch (err) {
      checks.push({
        name: "xai_api",
        status: "fail",
        message: `Could not reach the xAI API: ${errorMessage(err)}`,
        fix: "Check the network, proxy, or firewall, then retry. OAuth is already connected."
      });
    }
  }
  const output = defaultOutputDir();
  checks.push(
    writableTarget(output) ? { name: "output", status: "pass", message: `Output location is writable: ${output}` } : {
      name: "output",
      status: "fail",
      message: `Output location is not writable: ${output}`,
      fix: "Set GROK_IMAGINE_OUT to a writable folder and restart your agent host."
    }
  );
  return {
    ready: checks.every((check) => check.status !== "fail"),
    version: "0.3.1",
    platform: `${process.platform}-${process.arch}`,
    checks
  };
}
function formatDoctor(report) {
  const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const lines = [
    `Grok Imagine doctor v${report.version} (${report.platform})`,
    ...report.checks.map((check) => {
      const fix = check.fix ? `
  Fix: ${check.fix}` : "";
      return `[${icon[check.status]}] ${check.name}: ${check.message}${fix}`;
    }),
    report.ready ? "READY: setup can continue." : "NOT READY: fix the FAIL items, then run doctor again.",
    "This check does not generate media or consume an image/video generation request."
  ];
  return lines.join("\n");
}

// src/tools.ts
function ok(text, extra) {
  return { content: [{ type: "text", text }, ...extra ?? []] };
}
function fail(err) {
  const extra = err instanceof PluginError && (err.code === "auth_missing" || err.code === "auth_expired" || err.code === "auth_unauthorized") ? " Call grok_login, or run `grok login --oauth` in a terminal." : "";
  return { content: [{ type: "text", text: errorMessage(err) + extra }], isError: true };
}
async function withToken(fn) {
  const auth = await resolveAuth();
  return fn(auth.token);
}
function registerTools(server2) {
  server2.tool(
    "grok_imagine_doctor",
    "Run a safe setup check for Node.js, the current agent host, Grok CLI OAuth, xAI model access, and output storage. Does not generate media.",
    {
      check_api: z.boolean().optional().describe("Call the read-only xAI models endpoint. Default true.")
    },
    async ({ check_api }) => {
      try {
        return ok(formatDoctor(await runDoctor(check_api !== false)));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "grok_auth_status",
    "Check Grok CLI OAuth session (~/.grok/auth.json), Grok binary, and whether the token can call api.x.ai. Never returns secrets.",
    {},
    async () => {
      try {
        const bin = resolveGrokBinary();
        const version = grokVersion(bin ?? void 0);
        const session = inspectSession();
        let probe;
        let resolveNote = "";
        try {
          const auth = await resolveAuth();
          probe = await probeApi(auth.token);
          resolveNote = `Using ${auth.info.source} (${auth.info.mode}).`;
        } catch (err) {
          resolveNote = errorMessage(err);
        }
        const body = {
          grok_cli: bin ? { path: bin, version } : { path: null, version: null },
          session: session ? {
            source: session.source,
            mode: session.mode,
            email: session.email ?? null,
            expires_at: session.expiresAt ?? null,
            expired: session.expired,
            issuer: session.issuer ?? null
          } : null,
          api: probe ?? null,
          note: resolveNote
        };
        return ok(JSON.stringify(body, null, 2));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "grok_login",
    "Sign in to Grok with official CLI OAuth (browser) or device-code. Reuses grok login --oauth. After success, tokens live in ~/.grok/auth.json.",
    {
      mode: z.enum(["oauth", "device"]).optional().describe("oauth opens a browser (default). device prints a URL+code for headless/SSH.")
    },
    async ({ mode }) => {
      try {
        const result = await runGrokLogin(mode ?? "oauth");
        const session = inspectSession();
        const lines = [
          `Ran: ${result.command}`,
          `exit: ${result.exitCode ?? "killed"}`,
          result.timedOut ? "Timed out waiting for login. Finish in the browser, then call grok_auth_status." : null,
          result.urls.length ? `URLs:
${result.urls.map((u) => `- ${u}`).join("\n")}` : null,
          session ? `Session now: ${session.email ?? "(no email)"} expired=${session.expired} expires_at=${session.expiresAt ?? "?"}` : "No session file yet. If the browser is still open, complete it and retry grok_auth_status.",
          "If the MCP host cannot open a browser, run this in your own terminal:",
          "`grok login --oauth`",
          result.outputTail ? `CLI output (tail):
${result.outputTail}` : null
        ].filter(Boolean);
        return ok(lines.join("\n"));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "grok_logout",
    "Sign out of Grok CLI (grok logout) and clear ~/.grok/auth.json.",
    {
      confirm: z.boolean().describe("Must be true to actually log out.")
    },
    async ({ confirm }) => {
      try {
        if (!confirm) return ok("Pass confirm=true to log out of Grok CLI.");
        const result = await runGrokLogout();
        return ok(`Logged out (exit ${result.exitCode}). ${result.outputTail}`.trim());
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "generate_image",
    "Generate an image with Grok Imagine (grok-imagine-image-2.0) using Grok CLI OAuth. This may consume paid quota; saves a local file and returns the path.",
    {
      prompt: z.string().min(1).describe("Full image description. Lead with subject, then setting, style, lighting."),
      aspect_ratio: z.string().optional().describe("e.g. 1:1, 16:9, 9:16, 4:3, 3:4, auto. Default auto."),
      resolution: z.enum(["1k", "2k"]).optional().describe("1k default, 2k for extra detail."),
      quality: z.enum(["low", "medium", "auto"]).optional(),
      n: z.number().int().min(1).max(10).optional().describe("How many variations, 1-10."),
      out: z.string().optional().describe("Absolute file path or directory to save. Prefer the user workspace.")
    },
    async (args) => {
      try {
        const result = await withToken(
          (token) => generateImage(token, {
            prompt: args.prompt,
            aspectRatio: args.aspect_ratio,
            resolution: args.resolution,
            quality: args.quality,
            n: args.n,
            out: args.out
          })
        );
        const extra = [];
        if (result.preview) extra.push({ type: "image", data: result.preview.data, mimeType: result.preview.mimeType });
        return ok(describeImageResult(result), extra);
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "edit_image",
    "Edit one to five local images or URLs with Grok Imagine. Single source uses image; multiple uses images[]. Tag extras in the prompt as <IMAGE_0>, <IMAGE_1>, ...",
    {
      prompt: z.string().min(1).describe("Describe the desired result and what must stay the same."),
      images: z.array(z.string()).min(1).max(5).describe("Local file paths, https URLs, or data URIs."),
      aspect_ratio: z.string().optional().describe("Used for multi-image edits. Single-image edits keep the source ratio."),
      quality: z.enum(["low", "medium", "auto"]).optional(),
      out: z.string().optional().describe("Absolute file path or directory to save.")
    },
    async (args) => {
      try {
        const result = await withToken(
          (token) => editImage(token, {
            prompt: args.prompt,
            images: args.images,
            aspectRatio: args.aspect_ratio,
            quality: args.quality,
            out: args.out
          })
        );
        const extra = [];
        if (result.preview) extra.push({ type: "image", data: result.preview.data, mimeType: result.preview.mimeType });
        return ok(describeImageResult(result), extra);
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "generate_video",
    "Generate a Grok Imagine video (grok-imagine-video-1.5). Modes: text (T2V), image (I2V first frame), reference (R2V, up to 7 images and/or 3 voices). Do not mix image and reference_images. Polls until done (up to ~10 min) and saves an MP4.",
    {
      prompt: z.string().min(1).describe("One short present-tense shot. For R2V tag <IMAGE_0> and <AUDIO_0>."),
      mode: z.enum(["text", "image", "reference"]).optional(),
      image: z.string().optional().describe("I2V first-frame path or URL. Mutually exclusive with reference_images."),
      reference_images: z.array(z.string()).max(7).optional().describe("R2V style/content references."),
      voices: z.array(z.string()).max(3).optional().describe("Preset voice ids e.g. eve, leo, ara, rex."),
      duration: z.number().int().min(1).max(15).optional().describe("Seconds, 1-15. Default 6."),
      aspect_ratio: z.string().optional(),
      resolution: z.enum(["480p", "720p", "1080p"]).optional().describe("1080p only for text/image, not reference."),
      generate_audio: z.boolean().optional(),
      out: z.string().optional().describe("Absolute MP4 path or directory.")
    },
    async (args) => {
      try {
        const result = await withToken(
          (token) => generateVideo(token, {
            prompt: args.prompt,
            mode: args.mode,
            image: args.image,
            referenceImages: args.reference_images,
            voices: args.voices,
            duration: args.duration,
            aspectRatio: args.aspect_ratio,
            resolution: args.resolution,
            generateAudio: args.generate_audio,
            out: args.out
          })
        );
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "edit_video",
    "Edit an existing video with Grok Imagine. Output keeps the source duration (capped). Provide a local MP4 path or URL.",
    {
      prompt: z.string().min(1),
      video: z.string().describe("Local video path or https URL."),
      out: z.string().optional()
    },
    async (args) => {
      try {
        const result = await withToken((token) => editVideo(token, { prompt: args.prompt, video: args.video, out: args.out }));
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "extend_video",
    "Extend an existing video from its last frame (2-10 extra seconds).",
    {
      prompt: z.string().min(1),
      video: z.string().describe("Local video path or https URL."),
      duration: z.number().int().min(2).max(10).optional(),
      out: z.string().optional()
    },
    async (args) => {
      try {
        const result = await withToken(
          (token) => extendVideo(token, { prompt: args.prompt, video: args.video, duration: args.duration, out: args.out })
        );
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "get_video_job",
    "Poll a previous video request_id and download the MP4 when done.",
    {
      request_id: z.string().min(1),
      prompt: z.string().optional().describe("Used only to name the saved file."),
      out: z.string().optional()
    },
    async (args) => {
      try {
        const result = await withToken((token) => getVideoJob(token, args.request_id, args.prompt, args.out));
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "open_flow_ui",
    "Open the n8n-style Grok Imagine flow canvas in a local browser (http://127.0.0.1). Use when the user wants a visual workflow, to control/run image→video pipelines, or says giao diện flow / n8n / canvas.",
    {
      template: z.enum(["image", "image-to-video", "image-edit-video"]).optional().describe("Optional starter graph."),
      open_browser: z.boolean().optional().describe("Open the system browser. Default true.")
    },
    async ({ template, open_browser }) => {
      try {
        if (template) applyTemplate(template);
        const info = await ensureUiServer();
        if (open_browser !== false) openBrowser(info.url);
        return ok(
          [
            `Flow UI: ${info.url}`,
            `Flow: ${getFlow().name}`,
            open_browser === false ? "Browser not opened." : "Opened in the default browser (127.0.0.1 only).",
            "User can drag nodes, connect ports, edit prompts, then press Chạy flow. Live node status streams over SSE.",
            summarizeFlow(getFlow(), getRun())
          ].join("\n")
        );
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "apply_flow_template",
    "Replace the current Imagine flow with a template: image | image-to-video | image-edit-video.",
    {
      template: z.enum(["image", "image-to-video", "image-edit-video"])
    },
    async ({ template }) => {
      try {
        await ensureUiServer();
        const flow = applyTemplate(template);
        return ok(summarizeFlow(flow, getRun()));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "save_flow",
    "Save/replace the Imagine flow graph (nodes + edges). Use after the user described a pipeline, or to set prompt text on the prompt node.",
    {
      flow: z.any().describe("Full flow object { name, nodes, edges }. Nodes need id, type, x, y, config.")
    },
    async ({ flow }) => {
      try {
        const saved = saveFlow(flow);
        await ensureUiServer();
        return ok(summarizeFlow(saved, getRun()));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "get_flow_status",
    "Return the current flow graph, per-node status, and latest run (idle/running/success/error/stopped).",
    {},
    async () => {
      try {
        const url = uiUrl();
        return ok(`${url ? `UI: ${url}
` : ""}${summarizeFlow(getFlow(), getRun())}`);
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "run_flow",
    "Execute the current Imagine flow DAG (prompt → image → video, etc.) with live UI updates. Long-running; video nodes can take minutes.",
    {},
    async () => {
      try {
        await ensureUiServer();
        const { run: run2, flow } = await runFlow();
        return ok(summarizeFlow(flow, run2));
      } catch (err) {
        return fail(err);
      }
    }
  );
  server2.tool(
    "stop_flow",
    "Stop the in-progress Imagine flow run.",
    {},
    async () => {
      try {
        stopFlow();
        return ok(summarizeFlow(getFlow(), getRun()));
      } catch (err) {
        return fail(err);
      }
    }
  );
}

// src/index.ts
var server = new McpServer(
  {
    name: "grok-imagine",
    version: "0.3.1"
  },
  {
    instructions: "Grok Imagine for agent hosts. Run grok_imagine_doctor for a no-generation setup check. Authentication is only through Grok CLI OAuth. For a visual pipeline, call open_flow_ui. Never print access tokens."
  }
);
registerTools(server);
await server.start();
