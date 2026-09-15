#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [path.join(root, "dist", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
});

let buffer = "";
let initialized = false;
const finish = (code) => {
  child.kill();
  process.exit(code);
};

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines.filter(Boolean)) {
    const message = JSON.parse(line);
    if (message.id === 1 && !initialized) {
      initialized = true;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "grok_imagine_doctor", arguments: { check_api: true } },
        })}\n`,
      );
    }
    if (message.id === 2) {
      const text = message.result?.content?.find((item) => item.type === "text")?.text;
      if (text) console.log(text);
      finish(message.result?.isError || text?.includes("NOT READY:") ? 1 : 0);
    }
  }
});

child.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "doctor", version: "0.3.1" },
    },
  })}\n`,
);

setTimeout(() => {
  console.error("Doctor timed out after 30 seconds.");
  finish(1);
}, 30_000).unref();
