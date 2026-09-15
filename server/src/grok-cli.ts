import { spawn, spawnSync } from "node:child_process";
import { PluginError } from "./errors.js";
import { resolveGrokBinary } from "./paths.js";

export interface LoginResult {
  command: string;
  mode: "oauth" | "device";
  exitCode: number | null;
  urls: string[];
  outputTail: string;
  timedOut: boolean;
}

const URL_RE = /https?:\/\/[^\s"'<>]+/g;

export function grokVersion(bin = resolveGrokBinary()): string | null {
  if (!bin) return null;
  try {
    const r = spawnSyncCapture(bin, ["--version"], 8_000);
    const text = `${r.stdout}\n${r.stderr}`.trim();
    return text.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function spawnSyncCapture(command: string, args: string[], timeoutMs: number): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    env: process.env,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status,
  };
}

export async function runGrokLogin(mode: "oauth" | "device", timeoutMs = 300_000): Promise<LoginResult> {
  const bin = resolveGrokBinary();
  if (!bin) {
    throw new PluginError(
      "grok_cli_missing",
      "Grok CLI not found. Install from https://x.ai/cli then retry. Windows: irm https://x.ai/cli/install.ps1 | iex",
    );
  }
  const args = mode === "device" ? ["login", "--device-auth"] : ["login", "--oauth"];
  const command = `${bin} ${args.join(" ")}`;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });
    let out = "";
    const onData = (buf: Buffer) => {
      out += buf.toString("utf8");
      if (out.length > 20_000) out = out.slice(-12_000);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const timer = setTimeout(() => {
      child.kill();
      resolve({
        command,
        mode,
        exitCode: null,
        urls: extractUrls(out),
        outputTail: tail(out),
        timedOut: true,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new PluginError("grok_cli_spawn_failed", `Failed to start Grok CLI: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command,
        mode,
        exitCode: code,
        urls: extractUrls(out),
        outputTail: tail(out),
        timedOut: false,
      });
    });
  });
}

export async function runGrokLogout(): Promise<{ command: string; exitCode: number | null; outputTail: string }> {
  const bin = resolveGrokBinary();
  if (!bin) {
    throw new PluginError("grok_cli_missing", "Grok CLI not found.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["logout"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    const onData = (buf: Buffer) => {
      out += buf.toString("utf8");
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => reject(new PluginError("grok_cli_spawn_failed", err.message)));
    child.on("close", (code) => {
      resolve({ command: `${bin} logout`, exitCode: code, outputTail: tail(out) });
    });
  });
}

function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_RE) ?? [])];
}

function tail(text: string, n = 1500): string {
  const t = text.trim();
  return t.length <= n ? t : t.slice(-n);
}
