import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PluginError } from "./errors.js";
import { runFlow, stopFlow } from "./flow-engine.js";
import { addNodeToFlow, applyTemplate, getFlow, getRun, saveFlow, subscribe } from "./flow-store.js";
import type { ImagineFlow, NodeType, TemplateName } from "./flow-types.js";
import { defaultOutputDir } from "./paths.js";
import uiHtml from "./ui/index.html";

type ServerInfo = { url: string; port: number; server: http.Server };

let started: ServerInfo | null = null;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function allowedMediaRoots(): string[] {
  return [path.resolve(defaultOutputDir()), path.resolve(os.homedir(), "Desktop")];
}

function isAllowedFile(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return allowedMediaRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return "application/octet-stream";
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(uiHtml);
    return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    json(res, 200, { flow: getFlow(), run: getRun() });
    return;
  }

  if (method === "PUT" && url.pathname === "/api/flow") {
    const body = JSON.parse((await readBody(req)) || "{}") as ImagineFlow;
    json(res, 200, { flow: saveFlow(body) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/template") {
    const body = JSON.parse((await readBody(req)) || "{}") as { name?: TemplateName };
    const name = body.name || "image-to-video";
    json(res, 200, { flow: applyTemplate(name) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/node") {
    const body = JSON.parse((await readBody(req)) || "{}") as { type?: NodeType; x?: number; y?: number };
    if (!body.type) {
      json(res, 400, { error: "type required" });
      return;
    }
    const node = addNodeToFlow(body.type, body.x ?? 240, body.y ?? 160);
    json(res, 200, { flow: getFlow(), node });
    return;
  }

  if (method === "POST" && url.pathname === "/api/run") {
    void runFlow().catch((err) => {
      process.stderr.write(`[grok-imagine-ui] run failed: ${err instanceof Error ? err.message : err}\n`);
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
      Connection: "keep-alive",
    });
    const send = (ev: unknown) => {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    const unsub = subscribe(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      unsub();
    });
    return;
  }

  if (method === "GET" && url.pathname === "/media") {
    const filePath = url.searchParams.get("p") || "";
    if (!filePath || !isAllowedFile(filePath) || !fs.existsSync(filePath)) {
      json(res, 404, { error: "not found" });
      return;
    }
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mimeFor(filePath), "Cache-Control": "no-store" });
    res.end(buf);
    return;
  }

  json(res, 404, { error: "not found" });
}

export async function ensureUiServer(preferredPort?: number): Promise<ServerInfo> {
  if (started) return started;
  const port0 = preferredPort ?? Number(process.env.GROK_IMAGINE_UI_PORT || 3847);
  for (let port = port0; port < port0 + 20; port++) {
    const server = await tryListen(port);
    if (!server) continue;
    server.on("request", (req, res) => {
      handle(req, res).catch((err) => {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
    });
    const url = `http://127.0.0.1:${port}/`;
    started = { url, port, server };
    process.stderr.write(`[grok-imagine-ui] ${url}\n`);
    return started;
  }
  throw new PluginError("ui_bind_failed", "Could not bind local flow UI port.");
}

function tryListen(port: number): Promise<http.Server | null> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

export function uiUrl(): string | null {
  return started?.url ?? null;
}
