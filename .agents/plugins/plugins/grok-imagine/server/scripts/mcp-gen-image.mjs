#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(os.homedir(), "grok-imagine-output", "mcp-e2e-fox.jpg");
const child = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let buf = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  buf += c;
  tryComplete();
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
    clientInfo: { name: "e2e", version: "0.0.1" },
  },
});

let sentCall = false;
function tryComplete() {
  const lines = buf.split(/\r?\n/).filter(Boolean);
  const msgs = [];
  for (const line of lines) {
    try {
      msgs.push(JSON.parse(line));
    } catch {
      return;
    }
  }
  if (!sentCall && msgs.some((m) => m.id === 1)) {
    sentCall = true;
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "generate_image",
        arguments: {
          prompt: "A tiny red origami fox on white, product photo, no text",
          aspect_ratio: "1:1",
          quality: "low",
          out,
        },
      },
    });
  }
  const call = msgs.find((m) => m.id === 2);
  if (call) {
    child.kill();
    const text = call.result?.content?.find((c) => c.type === "text")?.text ?? JSON.stringify(call);
    console.log(text);
    if (call.result?.isError) process.exit(1);
    process.exit(0);
  }
}

setTimeout(() => {
  console.error("timeout");
  child.kill();
  process.exit(1);
}, 120000);
