import fs from "node:fs";
import path from "node:path";
import { inspectSession, probeApi, resolveAuth } from "./auth.js";
import { errorMessage } from "./errors.js";
import { grokVersion } from "./grok-cli.js";
import {
  defaultOutputDir,
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveGrokBinary,
  resolveHermesBinary,
} from "./paths.js";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface DoctorReport {
  ready: boolean;
  version: string;
  platform: string;
  checks: DoctorCheck[];
}

function writableTarget(target: string): boolean {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    fs.accessSync(current, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(checkApi = true): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push(
    nodeMajor >= 20
      ? { name: "node", status: "pass", message: `Node.js ${process.versions.node}` }
      : {
          name: "node",
          status: "fail",
          message: `Node.js ${process.versions.node}; version 20+ is required`,
          fix: "Install Node.js 20 LTS or newer, then restart your agent host.",
        },
  );

  const hosts = [
    ["Codex", resolveCodexBinary()],
    ["Claude", resolveClaudeBinary()],
    ["Hermes", resolveHermesBinary()],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  checks.push(
    hosts.length
      ? { name: "agent_host", status: "pass", message: hosts.map(([name, bin]) => `${name}: ${bin}`).join("; ") }
      : {
          name: "agent_host",
          status: "warn",
          message: "Codex, Claude, and Hermes CLIs were not found on PATH. A desktop host may still run the plugin.",
          fix: "Install or update one supported agent host and restart the terminal.",
        },
  );

  const grok = resolveGrokBinary();
  checks.push(
    grok
      ? { name: "grok_cli", status: "pass", message: `${grokVersion(grok) ?? "Grok CLI"} (${grok})` }
      : {
          name: "grok_cli",
          status: "fail",
          message: "Grok CLI is not installed.",
          fix: "Install Grok CLI from https://x.ai/cli, then restart your agent host.",
        },
  );

  let session: ReturnType<typeof inspectSession> = null;
  let sessionReadError: string | null = null;
  try {
    session = inspectSession();
  } catch (err) {
    sessionReadError = errorMessage(err);
  }
  let auth: Awaited<ReturnType<typeof resolveAuth>> | null = null;
  try {
    auth = await resolveAuth();
    checks.push({
      name: "authentication",
      status: "pass",
      message: `Grok CLI OAuth session is usable${session?.email ? ` for ${session.email}` : ""}.`,
    });
  } catch (err) {
    checks.push({
      name: "authentication",
      status: "fail",
      message: sessionReadError ?? errorMessage(err),
      fix: sessionReadError
        ? "Allow the plugin to read the local Grok auth file, then restart your agent host."
        : "Run `grok login --oauth`, then retry.",
    });
  }

  if (auth && checkApi) {
    try {
      const api = await probeApi(auth.token);
      if (!api.ok) {
        checks.push({
          name: "xai_api",
          status: "fail",
          message: `xAI API connection returned HTTP ${api.status}.`,
          fix: "Check account/model access, then run `grok login --oauth` again.",
        });
      } else {
        const media = api.mediaModels ?? [];
        checks.push({
          name: "xai_api",
          status: media.length ? "pass" : "warn",
          message: media.length
            ? `Connected; media models: ${media.join(", ")}`
            : "Connected, but no image/video model was listed for this account.",
          ...(media.length ? {} : { fix: "Check xAI billing and Imagine model entitlement." }),
        });
      }
    } catch (err) {
      checks.push({
        name: "xai_api",
        status: "fail",
        message: `Could not reach the xAI API: ${errorMessage(err)}`,
        fix: "Check the network, proxy, or firewall, then retry. OAuth is already connected.",
      });
    }
  }

  const output = defaultOutputDir();
  checks.push(
    writableTarget(output)
      ? { name: "output", status: "pass", message: `Output location is writable: ${output}` }
      : {
          name: "output",
          status: "fail",
          message: `Output location is not writable: ${output}`,
          fix: "Set GROK_IMAGINE_OUT to a writable folder and restart your agent host.",
        },
  );

  return {
    ready: checks.every((check) => check.status !== "fail"),
    version: "0.3.1",
    platform: `${process.platform}-${process.arch}`,
    checks,
  };
}

export function formatDoctor(report: DoctorReport): string {
  const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;
  const lines = [
    `Grok Imagine doctor v${report.version} (${report.platform})`,
    ...report.checks.map((check) => {
      const fix = check.fix ? `\n  Fix: ${check.fix}` : "";
      return `[${icon[check.status]}] ${check.name}: ${check.message}${fix}`;
    }),
    report.ready ? "READY: setup can continue." : "NOT READY: fix the FAIL items, then run doctor again.",
    "This check does not generate media or consume an image/video generation request.",
  ];
  return lines.join("\n");
}
