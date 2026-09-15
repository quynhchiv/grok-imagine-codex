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
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "grok_auth_status", arguments: {} },
  });
}, 200);

setTimeout(() => {
  child.kill();
  const lines = out.split(/\r?\n/).filter(Boolean);
  const msg = lines.map((l) => JSON.parse(l)).find((m) => m.id === 2);
  const text = msg?.result?.content?.[0]?.text ?? JSON.stringify(msg);
  if (/Bearer |super-secret|refresh_token|xai-[A-Za-z0-9]{10,}/i.test(text)) {
    console.error("possible secret in output");
    process.exit(1);
  }
  console.log(text);
  if (!msg?.result) process.exit(1);
}, 8000);
