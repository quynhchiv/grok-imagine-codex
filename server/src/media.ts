import fs from "node:fs";
import path from "node:path";
import { PluginError, redactSecrets } from "./errors.js";
import { ensureDir, expandHome, resolveExistingFile } from "./paths.js";

const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 80 * 1024 * 1024;
const MCP_IMAGE_MAX_CHARS = 1_200_000;

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export function mimeFromPath(filePath: string, fallback: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? fallback;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isDataUrl(value: string): boolean {
  return /^data:/i.test(value);
}

export async function toMediaUrl(input: string, kind: "image" | "video"): Promise<string> {
  const trimmed = input.trim();
  if (isHttpUrl(trimmed) || isDataUrl(trimmed)) return trimmed;
  const filePath = resolveExistingFile(trimmed);
  const stat = fs.statSync(filePath);
  const max = kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  if (stat.size > max) {
    throw new PluginError(
      "file_too_large",
      `${kind} file is ${(stat.size / (1024 * 1024)).toFixed(1)} MB (max ${max / (1024 * 1024)} MB): ${filePath}`,
    );
  }
  const mime = mimeFromPath(filePath, kind === "image" ? "image/jpeg" : "video/mp4");
  const b64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${b64}`;
}

export async function downloadToFile(url: string, dest: string, token?: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (token && /(?:^|\.)x\.ai$/i.test(safeHost(url))) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = redactSecrets((await res.text()).slice(0, 400));
    throw new PluginError("download_failed", `Download failed (${res.status}): ${body}`, res.status);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(dest);
  ensureDir(dir);
  fs.writeFileSync(dest, buf);
  return dest;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function writeBuffer(dest: string, data: Buffer): string {
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, data);
  return dest;
}

export function decodeB64(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

export function mcpImagePayload(b64: string, mimeType: string): { type: "image"; data: string; mimeType: string } | null {
  if (!b64 || b64.length > MCP_IMAGE_MAX_CHARS) return null;
  return { type: "image", data: b64, mimeType };
}

export function extFromMime(mime: string | undefined, fallback: string): string {
  if (!mime) return fallback;
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return fallback;
}

export function resolveOutPath(out: string | undefined, dir: string, filename: string): string {
  if (out && out.trim()) {
    const p = path.resolve(expandHome(out.trim()));
    const ext = path.extname(p);
    if (!ext) {
      ensureDir(p);
      return path.join(p, filename);
    }
    ensureDir(path.dirname(p));
    return p;
  }
  ensureDir(dir);
  return path.join(dir, filename);
}
