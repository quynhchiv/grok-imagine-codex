import path from "node:path";
import { API_BASE } from "./auth.js";
import { PluginError, redactSecrets } from "./errors.js";
import {
  decodeB64,
  downloadToFile,
  extFromMime,
  mcpImagePayload,
  resolveOutPath,
  toMediaUrl,
  writeBuffer,
} from "./media.js";
import { defaultOutputDir, slugFilename } from "./paths.js";

export const IMAGE_MODEL = "grok-imagine-image-2.0";
export const VIDEO_MODEL = "grok-imagine-video-1.5";

const VIDEO_POLL_MS = 3_000;
const VIDEO_TIMEOUT_MS = 10 * 60 * 1000;

export interface ImageResult {
  paths: string[];
  mimeType: string;
  model: string;
  moderationOk: boolean;
  preview?: { data: string; mimeType: string };
}

export interface VideoResult {
  path: string;
  url?: string;
  requestId: string;
  duration?: number;
  model: string;
  moderationOk: boolean;
  status: string;
}

async function apiJson(
  token: string,
  method: string,
  apiPath: string,
  body?: unknown,
  timeoutMs = 180_000,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const msg = redactSecrets(formatApiError(json, text));
      if (res.status === 401) {
        throw new PluginError("auth_unauthorized", `Imagine API 401. Call grok_login. ${msg}`, 401);
      }
      if (res.status === 403) {
        throw new PluginError(
          "auth_forbidden",
          `Imagine API 403 (no entitlement or billing). SuperGrok/X Premium+ session or XAI_API_KEY from console.x.ai. ${msg}`,
          403,
        );
      }
      throw new PluginError("imagine_http", `Imagine API ${res.status}: ${msg}`, res.status);
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function formatApiError(json: Record<string, unknown>, text: string): string {
  const err = json.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as { message?: string; code?: string };
    return [o.code, o.message].filter(Boolean).join(": ") || JSON.stringify(err);
  }
  return (json.message as string) || text.slice(0, 400) || "unknown error";
}

interface ImageItem {
  url?: string;
  b64_json?: string;
  mime_type?: string;
  respect_moderation?: boolean;
}

async function saveImageItems(
  token: string,
  items: ImageItem[],
  prompt: string,
  out?: string,
): Promise<ImageResult> {
  const dir = defaultOutputDir();
  const paths: string[] = [];
  let mimeType = "image/jpeg";
  let moderationOk = true;
  let preview: ImageResult["preview"];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.respect_moderation === false) moderationOk = false;
    mimeType = item.mime_type || mimeType;
    const ext = extFromMime(mimeType, "jpg");
    const filename = slugFilename(prompt, ext, items.length > 1 ? i : undefined);
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

export async function generateImage(
  token: string,
  opts: {
    prompt: string;
    aspectRatio?: string;
    resolution?: "1k" | "2k";
    quality?: "low" | "medium" | "auto";
    n?: number;
    out?: string;
    model?: string;
  },
): Promise<ImageResult> {
  const n = Math.min(10, Math.max(1, opts.n ?? 1));
  const model = opts.model || IMAGE_MODEL;
  const body: Record<string, unknown> = {
    model,
    prompt: opts.prompt,
    n,
    response_format: "b64_json",
  };
  if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
  if (opts.resolution) body.resolution = opts.resolution;
  if (opts.quality) body.quality = opts.quality;

  const { json } = await apiJson(token, "POST", "/images/generations", body);
  const data = (json.data as ImageItem[] | undefined) ?? [];
  if (data.length === 0) throw new PluginError("imagine_empty", "No images returned.");
  const result = await saveImageItems(token, data, opts.prompt, opts.out);
  result.model = (json.model as string) || model;
  return result;
}

export async function editImage(
  token: string,
  opts: {
    prompt: string;
    images: string[];
    aspectRatio?: string;
    quality?: "low" | "medium" | "auto";
    out?: string;
    model?: string;
  },
): Promise<ImageResult> {
  if (opts.images.length === 0) throw new PluginError("invalid_argument", "edit_image requires at least one source image.");
  if (opts.images.length > 5) throw new PluginError("invalid_argument", "edit_image supports at most 5 source images.");
  const urls = await Promise.all(opts.images.map((img) => toMediaUrl(img, "image")));
  const model = opts.model || IMAGE_MODEL;
  const body: Record<string, unknown> = {
    model,
    prompt: opts.prompt,
    n: 1,
    response_format: "b64_json",
  };
  if (opts.quality) body.quality = opts.quality;
  if (urls.length === 1) {
    body.image = { url: urls[0] };
  } else {
    body.images = urls.map((url) => ({ url }));
    body.aspect_ratio = opts.aspectRatio || "auto";
  }
  if (opts.aspectRatio && urls.length === 1) {
    // API ignores aspect_ratio on single-image edits; still pass if user set it.
    body.aspect_ratio = opts.aspectRatio;
  }

  const { json } = await apiJson(token, "POST", "/images/edits", body);
  const data = (json.data as ImageItem[] | undefined) ?? [];
  if (data.length === 0) throw new PluginError("imagine_empty", "No edited image returned.");
  const result = await saveImageItems(token, data, opts.prompt, opts.out);
  result.model = (json.model as string) || model;
  return result;
}

export type VideoMode = "text" | "image" | "reference";

export async function generateVideo(
  token: string,
  opts: {
    prompt: string;
    mode?: VideoMode;
    image?: string;
    referenceImages?: string[];
    voices?: string[];
    duration?: number;
    aspectRatio?: string;
    resolution?: "480p" | "720p" | "1080p";
    generateAudio?: boolean;
    out?: string;
    model?: string;
    requestIdOnly?: boolean;
  },
): Promise<VideoResult> {
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

  const mode: VideoMode = opts.mode || (opts.image ? "image" : refCount || opts.voices?.length ? "reference" : "text");
  const model = opts.model || VIDEO_MODEL;
  const duration = opts.duration ?? 6;
  if (duration < 1 || duration > 15) {
    throw new PluginError("invalid_argument", "duration must be 1–15 seconds.");
  }

  const resolution = opts.resolution || "480p";
  if (mode === "reference" && resolution === "1080p") {
    throw new PluginError("invalid_argument", "reference-to-video is capped at 720p.");
  }

  const body: Record<string, unknown> = {
    model,
    prompt: opts.prompt,
    duration,
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
        opts.referenceImages.map(async (img) => ({ url: await toMediaUrl(img, "image") })),
      );
    }
    if (opts.voices?.length) {
      body.reference_audios = opts.voices.map((voice_id) => ({ voice_id }));
    }
    if (!opts.referenceImages?.length && !opts.voices?.length) {
      throw new PluginError("invalid_argument", "reference mode needs reference_images and/or voices.");
    }
  }

  const { json } = await apiJson(token, "POST", "/videos/generations", body, 60_000);
  const requestId = String(json.request_id ?? "");
  if (!requestId) throw new PluginError("imagine_empty", "Video start returned no request_id.");
  if (opts.requestIdOnly) {
    return { path: "", requestId, model, moderationOk: true, status: "pending" };
  }
  return pollAndSaveVideo(token, requestId, opts.prompt, opts.out, model);
}

export async function editVideo(
  token: string,
  opts: { prompt: string; video: string; out?: string; model?: string },
): Promise<VideoResult> {
  const model = opts.model || VIDEO_MODEL;
  const body = {
    model,
    prompt: opts.prompt,
    video: { url: await toMediaUrl(opts.video, "video") },
  };
  const { json } = await apiJson(token, "POST", "/videos/edits", body, 60_000);
  const requestId = String(json.request_id ?? "");
  if (!requestId) throw new PluginError("imagine_empty", "Video edit returned no request_id.");
  return pollAndSaveVideo(token, requestId, opts.prompt, opts.out, model);
}

export async function extendVideo(
  token: string,
  opts: { prompt: string; video: string; duration?: number; out?: string; model?: string },
): Promise<VideoResult> {
  const duration = opts.duration ?? 6;
  if (duration < 2 || duration > 10) {
    throw new PluginError("invalid_argument", "extend duration must be 2–10 seconds.");
  }
  const model = opts.model || VIDEO_MODEL;
  const body = {
    model,
    prompt: opts.prompt,
    duration,
    video: { url: await toMediaUrl(opts.video, "video") },
  };
  const { json } = await apiJson(token, "POST", "/videos/extensions", body, 60_000);
  const requestId = String(json.request_id ?? "");
  if (!requestId) throw new PluginError("imagine_empty", "Video extend returned no request_id.");
  return pollAndSaveVideo(token, requestId, opts.prompt, opts.out, model);
}

export async function getVideoJob(token: string, requestId: string, prompt = "video", out?: string): Promise<VideoResult> {
  return pollAndSaveVideo(token, requestId, prompt, out, VIDEO_MODEL, 1);
}

async function pollAndSaveVideo(
  token: string,
  requestId: string,
  prompt: string,
  out: string | undefined,
  model: string,
  maxWaitMs = VIDEO_TIMEOUT_MS,
): Promise<VideoResult> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const { json } = await apiJson(token, "GET", `/videos/${encodeURIComponent(requestId)}`, undefined, 30_000);
    const status = String(json.status ?? "pending");
    if (status === "done") {
      const video = (json.video as { url?: string; duration?: number; respect_moderation?: boolean } | undefined) ?? {};
      if (!video.url) throw new PluginError("imagine_empty", "Video done but no url.");
      const filename = slugFilename(prompt, "mp4");
      const dest = resolveOutPath(out, defaultOutputDir(), filename);
      const saved = await downloadToFile(video.url, dest, token);
      return {
        path: saved,
        url: video.url,
        requestId,
        duration: video.duration,
        model: (json.model as string) || model,
        moderationOk: video.respect_moderation !== false,
        status,
      };
    }
    if (status === "failed" || status === "expired") {
      const err = json.error as { code?: string; message?: string } | undefined;
      throw new PluginError(
        err?.code || "video_failed",
        err?.message || `Video job ${status} (${requestId}).`,
      );
    }
    await sleep(VIDEO_POLL_MS);
  }
  throw new PluginError(
    "video_timeout",
    `Video still pending after ${Math.round(maxWaitMs / 1000)}s. request_id=${requestId}. Call get_video_job later.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function describeImageResult(result: ImageResult): string {
  const lines = [
    `Saved ${result.paths.length} image(s) with ${result.model}.`,
    ...result.paths.map((p) => `- ${path.resolve(p)}`),
  ];
  if (!result.moderationOk) lines.push("Warning: moderation flagged this result.");
  return lines.join("\n");
}

export function describeVideoResult(result: VideoResult): string {
  const lines = [
    `Video ${result.status} (${result.model}).`,
    result.path ? `File: ${path.resolve(result.path)}` : "No local file yet.",
    `request_id: ${result.requestId}`,
  ];
  if (result.duration != null) lines.push(`Duration: ${result.duration}s`);
  if (!result.moderationOk) lines.push("Warning: moderation flagged this result.");
  return lines.join("\n");
}
