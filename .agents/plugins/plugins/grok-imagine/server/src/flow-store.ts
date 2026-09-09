import fs from "node:fs";
import path from "node:path";
import { defaultOutputDir, ensureDir } from "./paths.js";
import type { FlowEvent, FlowNode, FlowRun, ImagineFlow, NodeType, TemplateName } from "./flow-types.js";

function nid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function node(partial: Omit<FlowNode, "status" | "config"> & { config?: Record<string, unknown> }): FlowNode {
  return { status: "idle", config: {}, ...partial };
}

export function templateFlow(name: TemplateName): ImagineFlow {
  const now = new Date().toISOString();
  if (name === "image") {
    const a = node({
      id: "prompt",
      type: "prompt",
      x: 80,
      y: 180,
      name: "Prompt",
      config: { text: "A tiny red origami fox on a white background, simple product photo, no text" },
    });
    const b = node({
      id: "gen",
      type: "generate_image",
      x: 360,
      y: 160,
      name: "Tạo ảnh",
      config: { aspect_ratio: "1:1", quality: "auto" },
    });
    const c = node({ id: "out", type: "output", x: 660, y: 180, name: "Output" });
    return {
      id: "current",
      name: "Tạo ảnh",
      nodes: [a, b, c],
      edges: [
        { id: "e1", from: a.id, to: b.id },
        { id: "e2", from: b.id, to: c.id },
      ],
      updatedAt: now,
    };
  }
  if (name === "image-edit-video") {
    const p = node({
      id: "prompt",
      type: "prompt",
      x: 40,
      y: 200,
      name: "Prompt",
      config: { text: "A cinematic origami fox on a studio table, warm rim light, no text" },
    });
    const g = node({
      id: "gen",
      type: "generate_image",
      x: 300,
      y: 80,
      name: "Tạo ảnh",
      config: { aspect_ratio: "16:9", quality: "auto" },
    });
    const e = node({
      id: "edit",
      type: "edit_image",
      x: 560,
      y: 80,
      name: "Sửa ảnh",
      config: { prompt: "" },
    });
    const v = node({
      id: "vid",
      type: "generate_video",
      x: 560,
      y: 280,
      name: "Tạo video",
      config: { mode: "image", duration: 6, resolution: "720p" },
    });
    const o = node({ id: "out", type: "output", x: 840, y: 180, name: "Output" });
    return {
      id: "current",
      name: "Ảnh → sửa → video",
      nodes: [p, g, e, v, o],
      edges: [
        { id: "e1", from: p.id, to: g.id },
        { id: "e2", from: g.id, to: e.id },
        { id: "e3", from: e.id, to: v.id },
        { id: "e4", from: v.id, to: o.id },
      ],
      updatedAt: now,
    };
  }
  const p = node({
    id: "prompt",
    type: "prompt",
    x: 60,
    y: 200,
    name: "Prompt",
    config: { text: "A cinematic origami fox on a studio table, warm rim light, no text" },
  });
  const g = node({
    id: "gen",
    type: "generate_image",
    x: 340,
    y: 80,
    name: "Tạo ảnh (frame 1)",
    config: { aspect_ratio: "16:9", quality: "auto" },
  });
  const v = node({
    id: "vid",
    type: "generate_video",
    x: 340,
    y: 300,
    name: "Animate I2V",
    config: { mode: "image", duration: 6, resolution: "720p" },
  });
  const o = node({ id: "out", type: "output", x: 640, y: 190, name: "Output" });
  return {
    id: "current",
    name: "Ảnh → video",
    nodes: [p, g, v, o],
    edges: [
      { id: "e1", from: p.id, to: g.id },
      { id: "e2", from: g.id, to: v.id },
      { id: "e3", from: v.id, to: o.id },
    ],
    updatedAt: now,
  };
}

export function newNode(type: NodeType, x = 200, y = 200): FlowNode {
  const names: Record<NodeType, string> = {
    prompt: "Prompt",
    generate_image: "Tạo ảnh",
    edit_image: "Sửa ảnh",
    generate_video: "Tạo video",
    edit_video: "Sửa video",
    extend_video: "Nối video",
    output: "Output",
  };
  const config: Record<string, unknown> =
    type === "prompt"
      ? { text: "" }
      : type === "generate_image"
        ? { aspect_ratio: "1:1", quality: "auto" }
        : type === "generate_video"
          ? { mode: "image", duration: 6, resolution: "720p" }
          : type === "extend_video"
            ? { duration: 6 }
            : {};
  return {
    id: nid(type.slice(0, 3)),
    type,
    x,
    y,
    name: names[type],
    config,
    status: "idle",
  };
}

function flowsDir(): string {
  return ensureDir(path.join(defaultOutputDir(), "flows"));
}

export function flowPath(): string {
  return path.join(flowsDir(), "current.json");
}

let current: ImagineFlow = templateFlow("image-to-video");
let run: FlowRun | null = null;
const listeners = new Set<(ev: FlowEvent) => void>();

export function loadFlowFromDisk(): ImagineFlow {
  try {
    const p = flowPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as ImagineFlow;
      if (parsed?.nodes && parsed?.edges) {
        current = parsed;
        return current;
      }
    }
  } catch {
    /* keep default */
  }
  return current;
}

export function getFlow(): ImagineFlow {
  return current;
}

export function getRun(): FlowRun | null {
  return run;
}

export function setRun(next: FlowRun | null): void {
  run = next;
  emit({ type: "run", at: new Date().toISOString(), run });
}

export function saveFlow(flow: ImagineFlow, persist = true): ImagineFlow {
  current = {
    ...flow,
    id: flow.id || "current",
    updatedAt: new Date().toISOString(),
    nodes: flow.nodes.map((n) => ({ ...n })),
    edges: flow.edges.map((e) => ({ ...e })),
  };
  if (persist) {
    fs.writeFileSync(flowPath(), `${JSON.stringify(current, null, 2)}\n`, "utf8");
  }
  emit({ type: "flow", at: current.updatedAt, flow: current, run });
  return current;
}

export function applyTemplate(name: TemplateName): ImagineFlow {
  return saveFlow(templateFlow(name));
}

export function addNodeToFlow(type: NodeType, x: number, y: number): FlowNode {
  const n = newNode(type, x, y);
  current.nodes.push(n);
  saveFlow(current);
  return n;
}

export function updateNode(id: string, patch: Partial<FlowNode>): FlowNode | null {
  const idx = current.nodes.findIndex((n) => n.id === id);
  if (idx < 0) return null;
  const next = { ...current.nodes[idx], ...patch };
  current.nodes[idx] = next;
  emit({ type: "node", at: new Date().toISOString(), node: next, run });
  return next;
}

export function resetNodeStatuses(): void {
  current.nodes = current.nodes.map((n) => ({
    ...n,
    status: "idle",
    error: undefined,
    startedAt: undefined,
    finishedAt: undefined,
  }));
  emit({ type: "flow", at: new Date().toISOString(), flow: current, run });
}

export function subscribe(fn: (ev: FlowEvent) => void): () => void {
  listeners.add(fn);
  fn({ type: "hello", at: new Date().toISOString(), flow: current, run });
  return () => listeners.delete(fn);
}

export function emit(ev: FlowEvent): void {
  for (const fn of listeners) {
    try {
      fn(ev);
    } catch {
      /* ignore */
    }
  }
}

export function logFlow(message: string): void {
  emit({ type: "log", at: new Date().toISOString(), message, run });
}

loadFlowFromDisk();
