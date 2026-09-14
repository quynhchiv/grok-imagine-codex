#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(serverRoot, "..");
const repositoryRoot = path.resolve(pluginRoot, "..", "..", "..", "..");
const legacyManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const portableManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
const serverPackage = JSON.parse(fs.readFileSync(path.join(serverRoot, "package.json"), "utf8"));
const marketplace = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, ".agents", "plugins", "marketplace.json"), "utf8"),
);
const indexSource = fs.readFileSync(path.join(serverRoot, "src", "index.ts"), "utf8");

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(legacyManifest.name === "grok-imagine", "legacy manifest name must be grok-imagine");
expect(portableManifest.name === legacyManifest.name, "portable and legacy manifest names differ");
expect(portableManifest.version === legacyManifest.version, "portable and legacy manifest versions differ");
expect(serverPackage.version === legacyManifest.version, "server and plugin versions differ");
expect(indexSource.includes(`version: "${serverPackage.version}"`), "MCP serverInfo version differs from package version");
expect(fs.existsSync(path.join(pluginRoot, ".mcp.json")), "legacy .mcp.json is missing");
expect(fs.existsSync(path.join(pluginRoot, "mcp.json")), "portable mcp.json is missing");
expect(fs.existsSync(path.join(serverRoot, "dist", "index.js")), "prebuilt dist/index.js is missing");
const marketplaceEntry = marketplace.plugins?.find((entry) => entry.name === legacyManifest.name);
expect(Boolean(marketplaceEntry), "plugin is missing from marketplace.json");
if (marketplaceEntry) {
  const sourcePath = path.resolve(repositoryRoot, marketplaceEntry.source?.path ?? "");
  expect(sourcePath === pluginRoot, `marketplace source resolves to the wrong path: ${sourcePath}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`Package validation passed: grok-imagine v${serverPackage.version}`);
