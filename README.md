# Grok Imagine for Codex

Create and edit images and videos with Grok Imagine from ChatGPT Codex. The plugin runs locally, keeps generated files local, and uses authentication owned by each user.

> Community project. Not affiliated with or endorsed by OpenAI or xAI.

[Hướng dẫn cài đặt bằng tiếng Việt](docs/SETUP_VI.md)

## Features

- Generate and edit images with `grok-imagine-image-2.0`
- Generate, edit, and extend videos with `grok-imagine-video-1.5`
- Text-to-video, image-to-video, and reference-to-video workflows
- Safe setup doctor that never generates media
- Optional local flow canvas at `http://127.0.0.1:3847/`
- User-owned authentication and local output files

## Fast install

Requirements: ChatGPT desktop with Codex (or a compatible Codex CLI) and Node.js 20 or newer.

Install a fixed release instead of the moving `main` branch:

```powershell
codex plugin marketplace add quynhchiv/grok-imagine-codex --ref v0.2.2
codex plugin add grok-imagine@grok-imagine
codex plugin list
```

Start a new Codex task and say:

```text
Setup Grok Imagine
```

The setup doctor checks Node.js, Codex/Grok CLI availability, authentication, model access, and the output folder. It does not create an image or video.

## Authentication

Choose one user-owned method:

### Option A — xAI API key (recommended)

Create a key in your own xAI Console account, set it as `XAI_API_KEY` in your local environment, then restart Codex. Never paste the key into a chat, issue, log, or repository.

Windows PowerShell for the current session:

```powershell
$env:XAI_API_KEY = "your-key"
```

macOS/Linux for the current shell:

```bash
export XAI_API_KEY="your-key"
```

Use your operating system's secret manager or environment configuration for persistent setup.

### Option B — Grok CLI OAuth

Install the Grok CLI from the official xAI instructions, then authenticate:

```powershell
grok --version
grok login --oauth
```

For a device-code login, use `grok login --device-auth`. Never commit or share `~/.grok/auth.json`.

## Verify and diagnose

From a new Codex task, say `Check Grok Imagine setup`, or run the developer doctor:

```powershell
cd .agents/plugins/plugins/grok-imagine/server
npm run doctor
```

The result uses `PASS`, `WARN`, and `FAIL`, with a repair instruction for each failure. The API check only reads the available model list; it does not submit a generation request.

## First paid test

Image and video generation can consume the user's xAI quota. Setup completes without generating media. Only after reviewing account access and cost, ask Codex:

```text
Generate one low-quality 1:1 origami fox test image.
```

## Example prompts

```text
Generate a 1:1 origami fox icon with Grok Imagine.
Animate this image into a six-second cinematic video.
Open the Grok Imagine image-to-video flow canvas.
```

## Updating and uninstalling

```powershell
codex plugin marketplace upgrade grok-imagine
codex plugin add grok-imagine@grok-imagine
```

Start a new Codex task after updating. To remove the plugin, use the Plugins Directory in the Codex app or the removal command supported by your installed Codex version.

## Troubleshooting

| Doctor result | Meaning | Fix |
|---|---|---|
| Node.js `FAIL` | Node.js is missing or older than 20 | Install Node.js 20 LTS or newer and restart Codex |
| Grok CLI `FAIL` | Neither Grok CLI nor an API key was found | Set `XAI_API_KEY`, or install Grok CLI and log in |
| Authentication `FAIL` | Credential is missing, expired, or invalid | Replace the API key or run `grok login --oauth` |
| xAI API `FAIL` | Account, billing, network, or model access problem | Check xAI Console access and billing, then retry |
| Output `FAIL` | Default folder cannot be written | Set `GROK_IMAGINE_OUT` to a writable absolute folder |

When requesting support, include doctor output but never include API keys, access tokens, refresh tokens, or `auth.json`.

## Development

```powershell
cd .agents/plugins/plugins/grok-imagine/server
npm ci
npm test
npm run build
node scripts/mcp-smoke.mjs
npm run validate:package
```

The repository keeps both legacy (`.codex-plugin/plugin.json`, `.mcp.json`) and portable (`plugin.json`, `mcp.json`) manifests synchronized for compatibility. Before publishing, validate the plugin manifest, create an immutable GitHub tag/release, and install that tag on a clean Windows, macOS, and Linux environment.

## Privacy and security

- No maintainer API key, account, or token is bundled.
- Credentials remain on the user's computer and are never returned by MCP tools.
- Prompts and media are sent to xAI only when the user starts an Imagine operation.
- Generated files are saved locally.
- The setup doctor does not generate paid media.

Review xAI pricing, terms, and acceptable-use policies before commercial use.

## License

MIT. See [LICENSE](LICENSE).
