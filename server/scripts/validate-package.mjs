#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(serverRoot, "..");
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(pluginRoot, ...parts), "utf8"));

const portable = readJson("plugin.json");
const portableMcp = readJson("mcp.json");
const codex = readJson(".codex-plugin", "plugin.json");
const codexMarketplace = readJson(".agents", "plugins", "marketplace.json");
const claude = readJson(".claude-plugin", "plugin.json");
const claudeMarketplace = readJson(".claude-plugin", "marketplace.json");
const claudeMcp = readJson(".mcp.json");
const serverPackage = readJson("server", "package.json");
const indexSource = fs.readFileSync(path.join(serverRoot, "src", "index.ts"), "utf8");

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(portable.$schema === "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "portable plugin schema is invalid");
expect(portableMcp.$schema === "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "portable MCP schema is invalid");
expect(portableMcp.mcpServers?.["grok-imagine"]?.type === "stdio", "portable MCP transport must be stdio");
expect(portableMcp.mcpServers?.["grok-imagine"]?.args?.[0] === "${PLUGIN_ROOT}/server/dist/index.js", "portable MCP entry must use PLUGIN_ROOT");
expect(claudeMcp.mcpServers?.["grok-imagine"]?.args?.[0] === "${CLAUDE_PLUGIN_ROOT}/server/dist/index.js", "Claude MCP entry must use CLAUDE_PLUGIN_ROOT");

const manifests = [portable, codex, claude, serverPackage];
for (const manifest of manifests) {
  expect(manifest.name === (manifest === serverPackage ? "grok-imagine-mcp" : "grok-imagine"), `unexpected package name: ${manifest.name}`);
  expect(manifest.version === portable.version, `version mismatch: ${manifest.name} is ${manifest.version}`);
}
expect(indexSource.includes(`version: "${portable.version}"`), "MCP serverInfo version differs from plugin version");
expect(fs.existsSync(path.join(serverRoot, "dist", "index.js")), "prebuilt server/dist/index.js is missing");
expect(fs.existsSync(path.join(pluginRoot, "skills", "grok-imagine", "SKILL.md")), "main skill is missing");
expect(fs.existsSync(path.join(pluginRoot, "skills", "grok-imagine-setup", "SKILL.md")), "setup skill is missing");

const codexEntry = codexMarketplace.plugins?.find((entry) => entry.name === portable.name);
expect(Boolean(codexEntry), "plugin is missing from Codex marketplace");
if (codexEntry) {
  expect(path.resolve(pluginRoot, codexEntry.source?.path ?? "") === pluginRoot, "Codex marketplace source must resolve to repository root");
}

const claudeEntry = claudeMarketplace.plugins?.find((entry) => entry.name === portable.name);
expect(Boolean(claudeEntry), "plugin is missing from Claude marketplace");
if (claudeEntry) {
  expect(path.resolve(pluginRoot, claudeEntry.source ?? "") === pluginRoot, "Claude marketplace source must resolve to repository root");
  expect(claudeEntry.version === portable.version, "Claude marketplace version differs from plugin version");
}

const oauthOnlyFiles = [
  "README.md",
  "docs/SETUP_VI.md",
  "CONTRIBUTING.md",
  "skills/grok-imagine/SKILL.md",
  "skills/grok-imagine-setup/SKILL.md",
  "server/src/auth.ts",
  "server/src/doctor.ts",
  "server/src/index.ts",
  "server/src/tools.ts",
];
for (const relative of oauthOnlyFiles) {
  const body = fs.readFileSync(path.join(pluginRoot, relative), "utf8");
  expect(!body.includes("XAI_API_KEY"), `${relative} still advertises API-key authentication`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`Package validation passed: grok-imagine v${portable.version} (portable + Codex + Claude, OAuth-only)`);
