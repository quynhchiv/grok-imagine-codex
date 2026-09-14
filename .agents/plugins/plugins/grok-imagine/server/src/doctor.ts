import fs from "node:fs";
import path from "node:path";
import { inspectSession, probeApi, resolveAuth } from "./auth.js";
import { errorMessage } from "./errors.js";
import { grokVersion } from "./grok-cli.js";
import { defaultOutputDir, resolveCodexBinary, resolveGrokBinary } from "./paths.js";

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
          fix: "Install Node.js 20 LTS or newer, then restart Codex.",
        },
  );

  const codex = resolveCodexBinary();
  checks.push(
    codex
      ? { name: "codex", status: "pass", message: `Codex CLI found: ${codex}` }
      : {
          name: "codex",
          status: "warn",
          message: "Codex CLI was not found on PATH. The desktop host may still run the plugin.",
          fix: "If CLI commands fail, install/update Codex and restart the terminal.",
        },
  );

  const grok = resolveGrokBinary();
  const hasApiKey = Boolean(process.env.XAI_API_KEY?.trim());
  checks.push(
    grok
      ? { name: "grok_cli", status: "pass", message: `${grokVersion(grok) ?? "Grok CLI"} (${grok})` }
      : hasApiKey
        ? {
            name: "grok_cli",
            status: "warn",
            message: "Grok CLI is not installed; XAI_API_KEY authentication is available.",
          }
        : {
            name: "grok_cli",
            status: "fail",
            message: "Grok CLI is not installed and XAI_API_KEY is not set.",
            fix: "Install Grok CLI from https://x.ai/cli or set XAI_API_KEY, then restart Codex.",
          },
  );

  let session: ReturnType<typeof inspectSession> = null;
  let sessionReadError: string | null = null;
  try {
    session = inspectSession();
  } catch (err) {
    sessionReadError = errorMessage(err);
  }
  try {
    const auth = await resolveAuth();
    checks.push({
      name: "authentication",
      status: "pass",
      message:
        auth.info.source === "xai-api-key"
          ? "XAI_API_KEY is configured (value hidden)."
          : `Grok CLI session is usable${session?.email ? ` for ${session.email}` : ""}.`,
    });
    if (checkApi) {
      const api = await probeApi(auth.token);
      if (!api.ok) {
        checks.push({
          name: "xai_api",
          status: "fail",
          message: `xAI API connection returned HTTP ${api.status}.`,
          fix: "Check billing/model access, then reconnect or replace XAI_API_KEY.",
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
    }
  } catch (err) {
    checks.push({
      name: "authentication",
      status: "fail",
      message: sessionReadError ?? errorMessage(err),
      fix: sessionReadError
        ? "Allow the plugin to read the local Grok auth file, or set XAI_API_KEY and restart Codex."
        : "Set XAI_API_KEY (recommended) or run `grok login --oauth`, then retry.",
    });
  }

  const output = defaultOutputDir();
  checks.push(
    writableTarget(output)
      ? { name: "output", status: "pass", message: `Output location is writable: ${output}` }
      : {
          name: "output",
          status: "fail",
          message: `Output location is not writable: ${output}`,
          fix: "Set GROK_IMAGINE_OUT to a writable folder and restart Codex.",
        },
  );

  return {
    ready: checks.every((check) => check.status !== "fail"),
    version: "0.2.2",
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
