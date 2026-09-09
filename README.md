# Grok Imagine for Codex

Create and edit images and videos with Grok Imagine from ChatGPT Codex. The plugin runs locally, uses the official Grok CLI OAuth flow, and includes an n8n-style visual canvas for image-to-video workflows.

> Community project. Not affiliated with or endorsed by OpenAI or xAI.

## Features

- Generate and edit images with `grok-imagine-image-2.0`
- Generate, edit, and extend videos with `grok-imagine-video-1.5`
- Text-to-video, image-to-video, and reference-to-video workflows
- Local visual flow canvas at `http://127.0.0.1:3847/`
- Per-user Grok OAuth; no shared API key is bundled
- Local output files

## Requirements

- ChatGPT desktop app with Codex, or Codex CLI with plugin support
- Node.js 20 or newer
- Grok CLI
- A Grok/xAI account with access to the required Imagine models

### Install Grok CLI on Windows

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
grok login --oauth
```

Never commit or share `~/.grok/auth.json`.

## Install from GitHub

Add this repository as a Codex plugin marketplace:

```powershell
codex plugin marketplace add quynhchiv/grok-imagine-codex --ref main
codex plugin add grok-imagine@grok-imagine
```

Start a new Codex task after installation, then ask:

```text
Setup Grok Imagine
```

The plugin checks the local Grok CLI session and guides the user through OAuth when needed. Each user authenticates with their own Grok account and uses their own xAI quota.

## Example prompts

```text
Generate a 1:1 origami fox icon with Grok Imagine.
Animate this image into a six-second cinematic video.
Open the Grok Imagine image-to-video flow canvas.
```

## Development

The MCP server source is located at:

```text
.agents/plugins/plugins/grok-imagine/server
```

Build and test it with:

```powershell
cd .agents/plugins/plugins/grok-imagine/server
npm ci
npm test
npm run build
```

Validate the plugin manifest with the Codex `plugin-creator` validator before publishing a release.

## Updating

```powershell
codex plugin marketplace upgrade grok-imagine
codex plugin add grok-imagine@grok-imagine
```

Start a new Codex task so updated skills and MCP tools are loaded.

## Privacy and security

- Authentication is handled by the official Grok CLI OAuth flow.
- Tokens remain in the user's local `~/.grok/auth.json` file.
- The plugin does not include the maintainer's account, API key, or tokens.
- Prompts and media are sent to xAI only when the user runs an Imagine operation.
- Generated files are saved locally.

Review xAI's terms and acceptable-use policy before using the plugin commercially.

## License

MIT. See [LICENSE](LICENSE).
