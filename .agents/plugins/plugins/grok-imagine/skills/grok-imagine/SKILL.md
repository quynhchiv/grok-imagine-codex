---
name: grok-imagine
description: >
  Generate and edit images and videos with Grok Imagine through the grok-imagine MCP tools,
  authenticated with a user-owned XAI_API_KEY or Grok CLI OAuth. Use when the user asks to create,
  generate, edit, or animate images or videos; Vietnamese triggers include tạo ảnh, sửa ảnh,
  generate image, animate, video, I2V, R2V, Grok Imagine.
---

# Grok Imagine (Codex)

Use the **grok-imagine** MCP tools. Do not shell out to `grok -p` for media. Do not invent xAI request bodies.

## Visual flow (n8n-style)

When the user wants to **see or control the pipeline** (giao diện flow, canvas, n8n, kiểm soát flow, mở UI):

1. Call `open_flow_ui` (optionally with `template=image-to-video`).
2. Tell them the local URL (`http://127.0.0.1:3847/`) opened in the browser.
3. They can drag nodes, connect ports, edit prompts, press **Chạy flow**. Node status updates live.
4. Use `get_flow_status` / `run_flow` / `stop_flow` if they ask you to run or inspect without clicking.

Do not skip the UI when they explicitly asked for the canvas.

## Auth

1. Call `grok_imagine_doctor` before the first media tool in a thread.
2. Prefer a user-owned `XAI_API_KEY`. Never ask the user to paste it into chat; it must be set locally and Codex restarted.
3. OAuth alternative: call `grok_login` with `mode=oauth` (browser). Headless/SSH: `mode=device`.
4. If MCP cannot open a browser, tell the user to run `grok login --oauth` in a terminal, then call `grok_imagine_doctor` again.
5. Never print access tokens, refresh tokens, API keys, or `auth.json`.

## When not to use Imagine

If the result must get exact text, numbers, charts, labeled diagrams, or UI copy right, build it with code (HTML/CSS). Imagine is for photos, illustration, icons, cinematic frames, and motion — not data-accurate graphics.

## Images

| Need | Tool |
|---|---|
| New image, no source | `generate_image` |
| Change an existing file / keep likeness | `edit_image` |

- Pass `out` as an **absolute path** in the user workspace whenever they named a folder (`assets/icon.png`). Otherwise the server saves under `~/grok-imagine-output`.
- `aspect_ratio`: `1:1` icons/avatars, `16:9` banners/frames, `9:16` stories. Omit for `auto`.
- `resolution`: `1k` default, `2k` only if they asked for extra detail.
- `n` 1–10 for variations; default 1.
- Craft the prompt unless they gave one to use verbatim: subject, action, setting, style, lighting. 2–5 sentences. No negative-prompt dumps.
- Named real people: `edit_image` with a real reference path, never a fresh `generate_image`.
- Moderation block: stop. Do not paraphrase to evade.

## Video

Video is a short shot, not a feature film.

1. Prefer 6s. Allowed duration 1–15s.
2. **I2V** (best default): generate/edit a still, then `generate_video` with `mode=image` and that file as `image` (becomes frame 1).
3. **T2V**: `mode=text` when they want video from words only.
4. **R2V**: `mode=reference` with up to 7 `reference_images` and/or up to 3 `voices` (`eve`, `leo`, `ara`, `rex`, …). Tag `<IMAGE_0>`, `<AUDIO_0>` in the prompt. Do **not** send `image` and `reference_images` together.
5. 1080p is only for text/image modes. Reference is capped at 720p.
6. `edit_video` / `extend_video` (extend 2–10s) for existing MP4s.
7. Jobs can take minutes. If you get `video_timeout` and a `request_id`, call `get_video_job`.
8. Return the saved absolute path. Codex does not inline-play MP4s.

Prompt for video: one present-tense moment, one subject, one camera move. Do not stack multiple actions.

## After a tool call

- Tell the user the absolute saved path.
- For images, the MCP result may already include image content — do not re-fetch.
- Do not claim a URL from xAI is a durable deliverable; the local file is.
