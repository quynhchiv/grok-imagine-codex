#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let out = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  out += c;
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => {
  process.stderr.write(c);
});

function send(obj) {
  child.stdin.write(`${JSON.stringify(obj)}\n`);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.1" },
  },
});

setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
}, 200);

setTimeout(() => {
  child.kill();
  const lines = out.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    console.error("no stdout from MCP server");
    process.exit(1);
  }
  const parsed = lines.map((l) => JSON.parse(l));
  const init = parsed.find((m) => m.id === 1);
  const tools = parsed.find((m) => m.id === 2);
  if (!init?.result?.serverInfo) {
    console.error("initialize failed", init);
    process.exit(1);
  }
  const names = (tools?.result?.tools ?? []).map((t) => t.name).sort();
  console.log("server", init.result.serverInfo);
  console.log("tools", names.join(", "));
  const expected = [
    "edit_image",
    "edit_video",
    "extend_video",
    "generate_image",
    "generate_video",
    "get_video_job",
    "grok_auth_status",
    "grok_login",
    "grok_logout",
  ];
  for (const n of expected) {
    if (!names.includes(n)) {
      console.error("missing tool", n);
      process.exit(1);
    }
  }
  console.log("ok");
  process.exit(0);
}, 1500);
