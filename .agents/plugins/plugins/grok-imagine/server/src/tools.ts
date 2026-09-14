import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inspectSession, probeApi, resolveAuth } from "./auth.js";
import { errorMessage, PluginError } from "./errors.js";
import { grokVersion, runGrokLogin, runGrokLogout } from "./grok-cli.js";
import {
  describeImageResult,
  describeVideoResult,
  editImage,
  editVideo,
  extendVideo,
  generateImage,
  generateVideo,
  getVideoJob,
} from "./imagine.js";
import { applyTemplate, getFlow, getRun, saveFlow } from "./flow-store.js";
import { runFlow, stopFlow, summarizeFlow } from "./flow-engine.js";
import type { ImagineFlow, TemplateName } from "./flow-types.js";
import { resolveGrokBinary } from "./paths.js";
import { openBrowser } from "./browser.js";
import { ensureUiServer, uiUrl } from "./ui-server.js";
import { formatDoctor, runDoctor } from "./doctor.js";

type Content = Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
>;

function ok(text: string, extra?: Content): { content: Content } {
  return { content: [{ type: "text", text }, ...(extra ?? [])] };
}

function fail(err: unknown): { content: Content; isError: true } {
  const extra =
    err instanceof PluginError && (err.code === "auth_missing" || err.code === "auth_expired" || err.code === "auth_unauthorized")
      ? " Call grok_login, or run `grok login --oauth` in a terminal."
      : "";
  return { content: [{ type: "text", text: errorMessage(err) + extra }], isError: true };
}

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const auth = await resolveAuth();
  return fn(auth.token);
}

export function registerTools(server: McpServer): void {
  server.tool(
    "grok_imagine_doctor",
    "Run a safe setup check for Node.js, Codex/Grok CLI, authentication, xAI model access, and output storage. Does not generate media.",
    {
      check_api: z.boolean().optional().describe("Call the read-only xAI models endpoint. Default true."),
    },
    async ({ check_api }) => {
      try {
        return ok(formatDoctor(await runDoctor(check_api !== false)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "grok_auth_status",
    "Check Grok CLI OAuth session (~/.grok/auth.json), Grok binary, and whether the token can call api.x.ai. Never returns secrets.",
    {},
    async () => {
      try {
        const bin = resolveGrokBinary();
        const version = grokVersion(bin ?? undefined);
        const session = inspectSession();
        const hasApiKey = Boolean(process.env.XAI_API_KEY?.trim());
        let probe: Awaited<ReturnType<typeof probeApi>> | undefined;
        let resolveNote = "";
        try {
          const auth = await resolveAuth();
          probe = await probeApi(auth.token);
          resolveNote = `Using ${auth.info.source} (${auth.info.mode}).`;
        } catch (err) {
          resolveNote = errorMessage(err);
        }
        const body = {
          grok_cli: bin ? { path: bin, version } : { path: null, version: null },
          session: session
            ? {
                source: session.source,
                mode: session.mode,
                email: session.email ?? null,
                expires_at: session.expiresAt ?? null,
                expired: session.expired,
                issuer: session.issuer ?? null,
              }
            : null,
          xai_api_key_set: hasApiKey,
          api: probe ?? null,
          note: resolveNote,
        };
        return ok(JSON.stringify(body, null, 2));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "grok_login",
    "Sign in to Grok with official CLI OAuth (browser) or device-code. Reuses grok login --oauth. After success, tokens live in ~/.grok/auth.json.",
    {
      mode: z
        .enum(["oauth", "device"])
        .optional()
        .describe("oauth opens a browser (default). device prints a URL+code for headless/SSH."),
    },
    async ({ mode }) => {
      try {
        const result = await runGrokLogin(mode ?? "oauth");
        const session = inspectSession();
        const lines = [
          `Ran: ${result.command}`,
          `exit: ${result.exitCode ?? "killed"}`,
          result.timedOut ? "Timed out waiting for login. Finish in the browser, then call grok_auth_status." : null,
          result.urls.length ? `URLs:\n${result.urls.map((u) => `- ${u}`).join("\n")}` : null,
          session
            ? `Session now: ${session.email ?? "(no email)"} expired=${session.expired} expires_at=${session.expiresAt ?? "?"}`
            : "No session file yet. If the browser is still open, complete it and retry grok_auth_status.",
          "If the MCP host cannot open a browser, run this in your own terminal:",
          "`grok login --oauth`",
          result.outputTail ? `CLI output (tail):\n${result.outputTail}` : null,
        ].filter(Boolean);
        return ok(lines.join("\n"));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "grok_logout",
    "Sign out of Grok CLI (grok logout) and clear ~/.grok/auth.json.",
    {
      confirm: z.boolean().describe("Must be true to actually log out."),
    },
    async ({ confirm }) => {
      try {
        if (!confirm) return ok("Pass confirm=true to log out of Grok CLI.");
        const result = await runGrokLogout();
        return ok(`Logged out (exit ${result.exitCode}). ${result.outputTail}`.trim());
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "generate_image",
    "Generate an image with Grok Imagine (grok-imagine-image-2.0) using XAI_API_KEY or Grok CLI OAuth. This may consume paid quota; saves a local file and returns the path.",
    {
      prompt: z.string().min(1).describe("Full image description. Lead with subject, then setting, style, lighting."),
      aspect_ratio: z
        .string()
        .optional()
        .describe("e.g. 1:1, 16:9, 9:16, 4:3, 3:4, auto. Default auto."),
      resolution: z.enum(["1k", "2k"]).optional().describe("1k default, 2k for extra detail."),
      quality: z.enum(["low", "medium", "auto"]).optional(),
      n: z.number().int().min(1).max(10).optional().describe("How many variations, 1-10."),
      out: z.string().optional().describe("Absolute file path or directory to save. Prefer the user workspace."),
    },
    async (args) => {
      try {
        const result = await withToken((token) =>
          generateImage(token, {
            prompt: args.prompt,
            aspectRatio: args.aspect_ratio,
            resolution: args.resolution,
            quality: args.quality,
            n: args.n,
            out: args.out,
          }),
        );
        const extra: Content = [];
        if (result.preview) extra.push({ type: "image", data: result.preview.data, mimeType: result.preview.mimeType });
        return ok(describeImageResult(result), extra);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "edit_image",
    "Edit one to five local images or URLs with Grok Imagine. Single source uses image; multiple uses images[]. Tag extras in the prompt as <IMAGE_0>, <IMAGE_1>, ...",
    {
      prompt: z.string().min(1).describe("Describe the desired result and what must stay the same."),
      images: z.array(z.string()).min(1).max(5).describe("Local file paths, https URLs, or data URIs."),
      aspect_ratio: z.string().optional().describe("Used for multi-image edits. Single-image edits keep the source ratio."),
      quality: z.enum(["low", "medium", "auto"]).optional(),
      out: z.string().optional().describe("Absolute file path or directory to save."),
    },
    async (args) => {
      try {
        const result = await withToken((token) =>
          editImage(token, {
            prompt: args.prompt,
            images: args.images,
            aspectRatio: args.aspect_ratio,
            quality: args.quality,
            out: args.out,
          }),
        );
        const extra: Content = [];
        if (result.preview) extra.push({ type: "image", data: result.preview.data, mimeType: result.preview.mimeType });
        return ok(describeImageResult(result), extra);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "generate_video",
    "Generate a Grok Imagine video (grok-imagine-video-1.5). Modes: text (T2V), image (I2V first frame), reference (R2V, up to 7 images and/or 3 voices). Do not mix image and reference_images. Polls until done (up to ~10 min) and saves an MP4.",
    {
      prompt: z
        .string()
        .min(1)
        .describe("One short present-tense shot. For R2V tag <IMAGE_0> and <AUDIO_0>."),
      mode: z.enum(["text", "image", "reference"]).optional(),
      image: z.string().optional().describe("I2V first-frame path or URL. Mutually exclusive with reference_images."),
      reference_images: z.array(z.string()).max(7).optional().describe("R2V style/content references."),
      voices: z.array(z.string()).max(3).optional().describe("Preset voice ids e.g. eve, leo, ara, rex."),
      duration: z.number().int().min(1).max(15).optional().describe("Seconds, 1-15. Default 6."),
      aspect_ratio: z.string().optional(),
      resolution: z.enum(["480p", "720p", "1080p"]).optional().describe("1080p only for text/image, not reference."),
      generate_audio: z.boolean().optional(),
      out: z.string().optional().describe("Absolute MP4 path or directory."),
    },
    async (args) => {
      try {
        const result = await withToken((token) =>
          generateVideo(token, {
            prompt: args.prompt,
            mode: args.mode,
            image: args.image,
            referenceImages: args.reference_images,
            voices: args.voices,
            duration: args.duration,
            aspectRatio: args.aspect_ratio,
            resolution: args.resolution,
            generateAudio: args.generate_audio,
            out: args.out,
          }),
        );
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "edit_video",
    "Edit an existing video with Grok Imagine. Output keeps the source duration (capped). Provide a local MP4 path or URL.",
    {
      prompt: z.string().min(1),
      video: z.string().describe("Local video path or https URL."),
      out: z.string().optional(),
    },
    async (args) => {
      try {
        const result = await withToken((token) => editVideo(token, { prompt: args.prompt, video: args.video, out: args.out }));
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "extend_video",
    "Extend an existing video from its last frame (2-10 extra seconds).",
    {
      prompt: z.string().min(1),
      video: z.string().describe("Local video path or https URL."),
      duration: z.number().int().min(2).max(10).optional(),
      out: z.string().optional(),
    },
    async (args) => {
      try {
        const result = await withToken((token) =>
          extendVideo(token, { prompt: args.prompt, video: args.video, duration: args.duration, out: args.out }),
        );
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "get_video_job",
    "Poll a previous video request_id and download the MP4 when done.",
    {
      request_id: z.string().min(1),
      prompt: z.string().optional().describe("Used only to name the saved file."),
      out: z.string().optional(),
    },
    async (args) => {
      try {
        const result = await withToken((token) => getVideoJob(token, args.request_id, args.prompt, args.out));
        return ok(describeVideoResult(result));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "open_flow_ui",
    "Open the n8n-style Grok Imagine flow canvas in a local browser (http://127.0.0.1). Use when the user wants a visual workflow, to control/run image→video pipelines, or says giao diện flow / n8n / canvas.",
    {
      template: z.enum(["image", "image-to-video", "image-edit-video"]).optional().describe("Optional starter graph."),
      open_browser: z.boolean().optional().describe("Open the system browser. Default true."),
    },
    async ({ template, open_browser }) => {
      try {
        if (template) applyTemplate(template);
        const info = await ensureUiServer();
        if (open_browser !== false) openBrowser(info.url);
        return ok(
          [
            `Flow UI: ${info.url}`,
            `Flow: ${getFlow().name}`,
            open_browser === false ? "Browser not opened." : "Opened in the default browser (127.0.0.1 only).",
            "User can drag nodes, connect ports, edit prompts, then press Chạy flow. Live node status streams over SSE.",
            summarizeFlow(getFlow(), getRun()),
          ].join("\n"),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "apply_flow_template",
    "Replace the current Imagine flow with a template: image | image-to-video | image-edit-video.",
    {
      template: z.enum(["image", "image-to-video", "image-edit-video"]),
    },
    async ({ template }) => {
      try {
        await ensureUiServer();
        const flow = applyTemplate(template as TemplateName);
        return ok(summarizeFlow(flow, getRun()));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "save_flow",
    "Save/replace the Imagine flow graph (nodes + edges). Use after the user described a pipeline, or to set prompt text on the prompt node.",
    {
      flow: z
        .any()
        .describe("Full flow object { name, nodes, edges }. Nodes need id, type, x, y, config."),
    },
    async ({ flow }) => {
      try {
        const saved = saveFlow(flow as ImagineFlow);
        await ensureUiServer();
        return ok(summarizeFlow(saved, getRun()));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "get_flow_status",
    "Return the current flow graph, per-node status, and latest run (idle/running/success/error/stopped).",
    {},
    async () => {
      try {
        const url = uiUrl();
        return ok(`${url ? `UI: ${url}\n` : ""}${summarizeFlow(getFlow(), getRun())}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "run_flow",
    "Execute the current Imagine flow DAG (prompt → image → video, etc.) with live UI updates. Long-running; video nodes can take minutes.",
    {},
    async () => {
      try {
        await ensureUiServer();
        const { run, flow } = await runFlow();
        return ok(summarizeFlow(flow, run));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "stop_flow",
    "Stop the in-progress Imagine flow run.",
    {},
    async () => {
      try {
        stopFlow();
        return ok(summarizeFlow(getFlow(), getRun()));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
