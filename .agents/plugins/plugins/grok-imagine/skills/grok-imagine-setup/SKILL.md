---
name: grok-imagine-setup
description: >
  First-run setup for the Grok Imagine Codex plugin. Checks Grok CLI, runs OAuth
  login (grok login --oauth), and generates a tiny test image. Use when the user
  installs the plugin, says setup grok imagine, đăng nhập grok, or login Grok for images.
---

# Grok Imagine setup

1. Call `grok_auth_status`.
2. If Grok CLI is missing, tell the user (Windows PowerShell):

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
```

3. If there is no usable session, call `grok_login` with `mode=oauth`. If the host cannot open a browser, ask them to run `grok login --oauth` themselves.
4. Call `grok_auth_status` again. Confirm `api.ok` is true and Imagine model ids appear (`grok-imagine-image-2.0`, `grok-imagine-video-1.5`).
5. Call `generate_image` with a simple 1:1 prompt (`quality=low`) and show the saved path.
6. Optionally call `open_flow_ui` with `template=image-to-video` so they can see the canvas.
7. Summarize in Vietnamese: CLI path, email (if present), where files will be saved (`out` workspace path vs `~/grok-imagine-output`), and the flow UI URL.

Never display tokens.
