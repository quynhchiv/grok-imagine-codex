#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(serverRoot, "dist", "index.js");
const packageJson = JSON.parse(fs.readFileSync(path.join(serverRoot, "package.json"), "utf8"));
const bundle = fs.readFileSync(bundlePath, "utf8");
const failures = [];

if (fs.statSync(bundlePath).size > 200 * 1024) failures.push("runtime bundle exceeds 200 KB");
if (Object.keys(packageJson.dependencies ?? {}).length) failures.push("runtime dependencies must stay empty");

const suspicious = [
  ["JavaScript base64 decoder", /\batob\s*\(|\bbtoa\s*\(/],
  ["character-code construction", /String\.fromCharCode|charCodeAt/],
  ["dynamic evaluation", /\beval\s*\(|new Function\s*\(/],
  ["encoded Unicode chain", /\\u[0-9a-fA-F]{4}.*\\u[0-9a-fA-F]{4}.*\\u[0-9a-fA-F]{4}/],
];
for (const [label, pattern] of suspicious) {
  if (pattern.test(bundle)) failures.push(`bundle contains ${label}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`Bundle audit passed: ${Math.ceil(fs.statSync(bundlePath).size / 1024)} KB, dependency-free, readable UTF-8`);
