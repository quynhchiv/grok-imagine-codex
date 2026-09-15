import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function grokHome(): string {
  if (process.env.GROK_HOME && process.env.GROK_HOME.trim()) {
    return expandHome(process.env.GROK_HOME.trim());
  }
  return path.join(os.homedir(), ".grok");
}

export function authJsonPath(): string {
  return path.join(grokHome(), "auth.json");
}

export function defaultOutputDir(): string {
  if (process.env.GROK_IMAGINE_OUT && process.env.GROK_IMAGINE_OUT.trim()) {
    return path.resolve(expandHome(process.env.GROK_IMAGINE_OUT.trim()));
  }
  return path.join(os.homedir(), "grok-imagine-output");
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function resolveExistingFile(p: string): string {
  const resolved = path.resolve(expandHome(p));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }
  return resolved;
}

export function ensureDir(dir: string): string {
  const resolved = path.resolve(expandHome(dir));
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function slugFilename(prompt: string, ext: string, index?: number): string {
  const slug = prompt
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = index != null ? `-${index + 1}` : "";
  const base = slug || "grok";
  const cleanExt = ext.replace(/^\./, "");
  return `${base}-${ts}${suffix}.${cleanExt}`;
}

export function resolveGrokBinary(): string | null {
  if (process.env.GROK_BIN && process.env.GROK_BIN.trim()) {
    const p = expandHome(process.env.GROK_BIN.trim());
    if (fs.existsSync(p)) return p;
  }
  const homeBin = path.join(grokHome(), "bin", process.platform === "win32" ? "grok.exe" : "grok");
  if (fs.existsSync(homeBin)) return homeBin;
  return findOnPath("grok");
}

export function resolveCodexBinary(): string | null {
  return findOnPath("codex");
}

export function resolveClaudeBinary(): string | null {
  return findOnPath("claude");
}

export function resolveHermesBinary(): string | null {
  return findOnPath("hermes");
}

function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const parts = pathEnv.split(path.delimiter);
  const extra = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of parts) {
    if (!dir) continue;
    const candidates = [path.join(dir, name), ...extra.map((ext) => path.join(dir, `${name}${ext.toLowerCase()}`)), ...extra.map((ext) => path.join(dir, `${name}${ext.toUpperCase()}`))];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
