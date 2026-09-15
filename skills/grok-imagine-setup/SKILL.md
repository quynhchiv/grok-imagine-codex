---
name: grok-imagine-setup
description: >
  First-run setup for the Grok Imagine agent plugin. Runs a no-generation doctor,
  connects the user's own Grok account through official Grok CLI OAuth, and offers an optional paid test. Use when the user
  installs the plugin, says setup grok imagine, đăng nhập grok, or login Grok for images.
---

# Grok Imagine setup

1. Tell the user that setup first performs a safe check and will not generate paid media.
2. Call `grok_imagine_doctor` with `check_api=true`.
3. Present the result in plain language. Grok CLI OAuth is the only supported authentication method; never request a key or token in chat.
4. If Grok CLI is missing, give the official install command for the user's operating system. Windows PowerShell:

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
```

5. If there is no usable OAuth session, call `grok_login` with `mode=oauth`. Headless/SSH: use `mode=device`.
6. Call `grok_imagine_doctor` again. Confirm `READY` and that the required Imagine model ids appear (`grok-imagine-image-2.0`, `grok-imagine-video-1.5`).
7. Explain that image/video generation can consume the user's xAI quota. Ask for explicit confirmation before calling `generate_image` as a paid end-to-end test. Skipping the paid test is a valid completed setup.
8. Only after confirmation, call `generate_image` with one simple 1:1 prompt (`quality=low`, `n=1`) and show the saved path.
9. Summarize in Vietnamese: authentication source, account email if available, model access, and the output folder. Mention the flow canvas only when the user asks for it.

Never display tokens or silently generate paid media.
