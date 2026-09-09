import { resolveAuth } from "./auth.js";
import { PluginError } from "./errors.js";
import {
  editImage,
  editVideo,
  extendVideo,
  generateImage,
  generateVideo,
} from "./imagine.js";
import { emit, getFlow, getRun, logFlow, resetNodeStatuses, saveFlow, setRun, updateNode } from "./flow-store.js";
import type { FlowNode, FlowRun, ImagineFlow, NodeOutput, NodeType } from "./flow-types.js";

const IMAGE_TYPES = new Set<NodeType>(["generate_image", "edit_image"]);
const VIDEO_TYPES = new Set<NodeType>(["generate_video", "edit_video", "extend_video"]);

export function topoSort(flow: ImagineFlow): string[] {
  const incoming = new Map<string, number>();
  const outs = new Map<string, string[]>();
  for (const n of flow.nodes) {
    incoming.set(n.id, 0);
    outs.set(n.id, []);
  }
  for (const e of flow.edges) {
    if (!incoming.has(e.to) || !outs.has(e.from)) {
      throw new PluginError("invalid_flow", `Edge ${e.id} points at a missing node.`);
    }
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    outs.get(e.from)!.push(e.to);
  }
  const q = [...flow.nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id)];
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
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

function parents(flow: ImagineFlow, id: string): FlowNode[] {
  const ids = flow.edges.filter((e) => e.to === id).map((e) => e.from);
  return flow.nodes.filter((n) => ids.includes(n.id));
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function gatherInputs(node: FlowNode, preds: FlowNode[]): { prompt: string; images: string[]; videos: string[] } {
  let prompt = str(node.config.prompt) || str(node.config.text);
  const images: string[] = [];
  const videos: string[] = [];
  for (const p of preds) {
    if (p.type === "prompt") {
      const t = str(p.output?.prompt) || str(p.config.text) || str(p.config.prompt);
      if (t && !prompt) prompt = t;
      else if (t && p.type === "prompt" && !str(node.config.prompt)) prompt = prompt || t;
    }
    if (p.output?.prompt && !str(node.config.prompt) && p.type === "prompt") prompt = p.output.prompt;
    if (p.output?.image) images.push(p.output.image);
    if (p.output?.paths) {
      for (const path of p.output.paths) {
        if (/\.(png|jpe?g|webp|gif)$/i.test(path)) images.push(path);
        if (/\.(mp4|webm|mov)$/i.test(path)) videos.push(path);
      }
    }
    if (p.output?.video) videos.push(p.output.video);
    if (IMAGE_TYPES.has(p.type) && p.output?.image) {
      /* already */
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

let abort: AbortController | null = null;

export function isRunning(): boolean {
  return abort != null && !abort.signal.aborted;
}

export function stopFlow(reason = "Stopped by user"): void {
  if (abort) abort.abort();
  const flow = getFlow();
  for (const n of flow.nodes) {
    if (n.status === "running" || n.status === "queued") {
      updateNode(n.id, { status: "skipped", error: reason, finishedAt: new Date().toISOString() });
    }
  }
  const run = {
    id: getRun()?.id || "run",
    flowId: flow.id,
    status: "stopped" as const,
    startedAt: getRun()?.startedAt || new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: reason,
  };
  setRun(run);
}

async function execNode(token: string, node: FlowNode, preds: FlowNode[], signal: AbortSignal): Promise<NodeOutput> {
  if (signal.aborted) throw new PluginError("stopped", "Run stopped.");
  const ins = gatherInputs(node, preds);
  switch (node.type) {
    case "prompt": {
      const prompt = str(node.config.text) || str(node.config.prompt) || ins.prompt;
      return { prompt };
    }
    case "output": {
      const last = preds[preds.length - 1]?.output ?? {};
      return { ...last, prompt: last.prompt || ins.prompt, image: last.image || ins.images[0], video: last.video || ins.videos[0] };
    }
    case "generate_image": {
      if (!ins.prompt) throw new PluginError("invalid_flow", `${node.name || node.id}: missing prompt.`);
      const r = await generateImage(token, {
        prompt: ins.prompt,
        aspectRatio: str(node.config.aspect_ratio) || undefined,
        resolution: (str(node.config.resolution) as "1k" | "2k") || undefined,
        quality: (str(node.config.quality) as "low" | "medium" | "auto") || undefined,
        n: typeof node.config.n === "number" ? node.config.n : 1,
        out: str(node.config.out) || undefined,
      });
      return { prompt: ins.prompt, image: r.paths[0], paths: r.paths, mime: r.mimeType };
    }
    case "edit_image": {
      const images = ins.images.length ? ins.images : str(node.config.image) ? [str(node.config.image)] : [];
      if (!images.length) throw new PluginError("invalid_flow", `${node.name || node.id}: connect an image node.`);
      const prompt = ins.prompt || "Refine this image, keep the subject.";
      const r = await editImage(token, {
        prompt,
        images,
        aspectRatio: str(node.config.aspect_ratio) || undefined,
        quality: (str(node.config.quality) as "low" | "medium" | "auto") || undefined,
        out: str(node.config.out) || undefined,
      });
      return { prompt, image: r.paths[0], paths: r.paths, mime: r.mimeType };
    }
    case "generate_video": {
      const mode = (str(node.config.mode) || (ins.images.length ? "image" : "text")) as "text" | "image" | "reference";
      const prompt = ins.prompt || "Gentle camera push-in, cinematic lighting.";
      if (mode === "image" && !ins.images[0] && !str(node.config.image)) {
        throw new PluginError("invalid_flow", `${node.name || node.id}: I2V needs an image input.`);
      }
      const r = await generateVideo(token, {
        prompt,
        mode,
        image: mode === "image" ? ins.images[0] || str(node.config.image) : undefined,
        referenceImages: mode === "reference" ? ins.images : undefined,
        duration: typeof node.config.duration === "number" ? node.config.duration : 6,
        aspectRatio: str(node.config.aspect_ratio) || undefined,
        resolution: (str(node.config.resolution) as "480p" | "720p" | "1080p") || undefined,
        out: str(node.config.out) || undefined,
      });
      return { prompt, image: ins.images[0], video: r.path, paths: [r.path], mime: "video/mp4" };
    }
    case "edit_video": {
      const video = ins.videos[0] || str(node.config.video);
      if (!video) throw new PluginError("invalid_flow", `${node.name || node.id}: connect a video node.`);
      const prompt = ins.prompt || "Edit this video.";
      const r = await editVideo(token, { prompt, video, out: str(node.config.out) || undefined });
      return { prompt, video: r.path, paths: [r.path], mime: "video/mp4" };
    }
    case "extend_video": {
      const video = ins.videos[0] || str(node.config.video);
      if (!video) throw new PluginError("invalid_flow", `${node.name || node.id}: connect a video node.`);
      const prompt = ins.prompt || "Continue the motion.";
      const r = await extendVideo(token, {
        prompt,
        video,
        duration: typeof node.config.duration === "number" ? node.config.duration : 6,
        out: str(node.config.out) || undefined,
      });
      return { prompt, video: r.path, paths: [r.path], mime: "video/mp4" };
    }
    default:
      throw new PluginError("invalid_flow", `Unknown node type ${(node as FlowNode).type}`);
  }
}

export async function runFlow(): Promise<{ run: FlowRun; flow: ImagineFlow }> {
  if (isRunning()) throw new PluginError("run_busy", "A flow is already running. Stop it first.");
  const flow = getFlow();
  const order = topoSort(flow);
  abort = new AbortController();
  const run: FlowRun = {
    id: `run-${Date.now()}`,
    flowId: flow.id,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  setRun(run);
  resetNodeStatuses();
  for (const id of order) updateNode(id, { status: "queued" });
  logFlow(`Run ${run.id} started (${order.length} nodes).`);

  try {
    const { token } = await resolveAuth();
    const byId = () => new Map(getFlow().nodes.map((n) => [n.id, n]));
    for (const id of order) {
      if (abort.signal.aborted) {
        run.status = "stopped";
        run.finishedAt = new Date().toISOString();
        run.error = "Stopped";
        setRun(run);
        return { run, flow: getFlow() };
      }
      const node = byId().get(id);
      if (!node) continue;
      updateNode(id, { status: "running", error: undefined, startedAt: new Date().toISOString() });
      run.currentNodeId = id;
      setRun(run);
      logFlow(`▶ ${node.name || node.type}`);
      try {
        const preds = parents(getFlow(), id);
        const output = await execNode(token, { ...byId().get(id)! }, preds, abort.signal);
        updateNode(id, { status: "success", output, finishedAt: new Date().toISOString() });
        logFlow(`✓ ${node.name || node.type}${output.image || output.video ? ` → ${output.image || output.video}` : ""}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateNode(id, { status: "error", error: message, finishedAt: new Date().toISOString() });
        for (const rest of order.slice(order.indexOf(id) + 1)) {
          updateNode(rest, { status: "skipped", error: "Upstream failed" });
        }
        run.status = "error";
        run.error = message;
        run.finishedAt = new Date().toISOString();
        setRun(run);
        logFlow(`✗ ${node.name || node.type}: ${message}`);
        saveFlow(getFlow());
        return { run, flow: getFlow() };
      }
    }
    run.status = "success";
    run.finishedAt = new Date().toISOString();
    run.currentNodeId = undefined;
    setRun(run);
    logFlow("Run finished.");
    saveFlow(getFlow());
    emit({ type: "flow", at: new Date().toISOString(), flow: getFlow(), run });
    return { run, flow: getFlow() };
  } finally {
    abort = null;
  }
}

export function summarizeFlow(flow: ImagineFlow, run: FlowRun | null): string {
  const lines = [
    `Flow: ${flow.name} (${flow.nodes.length} nodes, ${flow.edges.length} edges)`,
    run ? `Run: ${run.status}${run.currentNodeId ? ` @ ${run.currentNodeId}` : ""}${run.error ? ` — ${run.error}` : ""}` : "Run: idle",
    ...flow.nodes.map((n) => {
      const art = n.output?.image || n.output?.video || "";
      return `- [${n.status}] ${n.name || n.id} (${n.type})${art ? ` ${art}` : ""}${n.error ? ` ERR ${n.error}` : ""}`;
    }),
  ];
  return lines.join("\n");
}
