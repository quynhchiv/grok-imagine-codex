#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(root, ".tmp-test", "tests");
const files = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(testsDir, name));

if (!files.length) {
  console.error(`No compiled tests found in ${testsDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
