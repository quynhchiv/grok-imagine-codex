---
name: grok-imagine-setup
description: >
  First-run setup for the Grok Imagine Codex plugin. Runs a no-generation doctor,
  helps configure user-owned xAI authentication, and offers an optional paid test. Use when the user
  installs the plugin, says setup grok imagine, đăng nhập grok, or login Grok for images.
---

# Grok Imagine setup

1. Tell the user that setup first performs a safe check and will not generate paid media.
2. Call `grok_imagine_doctor` with `check_api=true`.
3. Present the result in plain language. Prefer `XAI_API_KEY`, which the user obtains from their own xAI Console account. Never ask them to paste the key into chat; tell them to set it in their local environment and restart Codex.
4. If the user chooses Grok CLI OAuth and the CLI is missing, give the official install command for their operating system. Windows PowerShell:

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
```

5. If OAuth was chosen and there is no usable session, call `grok_login` with `mode=oauth`. Headless/SSH: use `mode=device`.
6. Call `grok_imagine_doctor` again. Confirm `READY` and that the required Imagine model ids appear (`grok-imagine-image-2.0`, `grok-imagine-video-1.5`).
7. Explain that image/video generation can consume the user's xAI quota. Ask for explicit confirmation before calling `generate_image` as a paid end-to-end test. Skipping the paid test is a valid completed setup.
8. Only after confirmation, call `generate_image` with one simple 1:1 prompt (`quality=low`, `n=1`) and show the saved path.
9. Summarize in Vietnamese: authentication source, account email if available, model access, and the output folder. Mention the flow canvas only when the user asks for it.

Never display tokens, request a key in chat, or silently generate paid media.
