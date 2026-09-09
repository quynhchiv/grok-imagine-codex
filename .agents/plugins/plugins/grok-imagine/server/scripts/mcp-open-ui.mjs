#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let buf = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  buf += c;
  pump();
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => process.stderr.write(c));

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
    clientInfo: { name: "ui-smoke", version: "0.0.1" },
  },
});

let called = false;
async function pump() {
  const lines = buf.split(/\r?\n/).filter(Boolean);
  const msgs = [];
  for (const line of lines) {
    try {
      msgs.push(JSON.parse(line));
    } catch {
      return;
    }
  }
  if (!called && msgs.some((m) => m.id === 1)) {
    called = true;
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "open_flow_ui",
        arguments: { template: "image-to-video", open_browser: false },
      },
    });
  }
  const call = msgs.find((m) => m.id === 2);
  if (!call) return;
  const text = call.result?.content?.find((c) => c.type === "text")?.text || "";
  console.log(text);
  const m = text.match(/http:\/\/127\.0\.0\.1:\d+\//);
  if (!m) {
    child.kill();
    process.exit(1);
  }
  const page = await fetch(m[0]);
  const html = await page.text();
  if (!html.includes("Imagine Flow") || !html.includes("Chạy flow")) {
    console.error("UI HTML missing expected chrome");
    child.kill();
    process.exit(1);
  }
  const st = await fetch(new URL("/api/state", m[0]));
  const state = await st.json();
  console.log("nodes", state.flow.nodes.map((n) => n.type).join(","));
  console.log("ok", m[0]);
  child.kill();
  process.exit(0);
}

setTimeout(() => {
  console.error("timeout");
  child.kill();
  process.exit(1);
}, 15000);
