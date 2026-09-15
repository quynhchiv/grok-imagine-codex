export const NODE_TYPES = [
  "prompt",
  "generate_image",
  "edit_image",
  "generate_video",
  "edit_video",
  "extend_video",
  "output",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export type NodeStatus = "idle" | "queued" | "running" | "success" | "error" | "skipped";

export interface FlowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  name?: string;
  config: Record<string, unknown>;
  status: NodeStatus;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  output?: NodeOutput;
}

export interface NodeOutput {
  prompt?: string;
  image?: string;
  video?: string;
  paths?: string[];
  mime?: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

export interface ImagineFlow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  updatedAt: string;
}

export interface FlowRun {
  id: string;
  flowId: string;
  status: "running" | "success" | "error" | "stopped";
  startedAt: string;
  finishedAt?: string;
  currentNodeId?: string;
  error?: string;
}

export interface FlowEvent {
  type: "hello" | "flow" | "run" | "node" | "log";
  at: string;
  flow?: ImagineFlow;
  run?: FlowRun | null;
  node?: FlowNode;
  message?: string;
}

export const TEMPLATES = ["image", "image-to-video", "image-edit-video"] as const;
export type TemplateName = (typeof TEMPLATES)[number];
