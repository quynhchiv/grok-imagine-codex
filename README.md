# Grok Imagine — Codex, Claude & Hermes

Create and edit images and videos with Grok Imagine from any compatible Agent Plugins host. The plugin runs locally, stores generated files locally, and connects only through the user's own Grok CLI OAuth session.

> Community project. Not affiliated with or endorsed by OpenAI, Anthropic, Nous Research, or xAI.

[Hướng dẫn cài đặt bằng tiếng Việt](docs/SETUP_VI.md)

## Features

- Generate and edit images with `grok-imagine-image-2.0`
- Generate, edit, and extend videos with `grok-imagine-video-1.5`
- Text-to-video, image-to-video, and reference-to-video workflows
- Safe setup doctor that never generates media
- Optional local flow canvas at `http://127.0.0.1`
- OAuth owned by each user; no maintainer key or shared account
- Dependency-free, auditable runtime designed to pass Hermes plugin scanning

## Requirements

- Node.js 20 or newer
- Official Grok CLI
- A Grok account with access to the required Imagine models

After installing the plugin, connect the account once:

```bash
grok login --oauth
```

The plugin reads the local Grok CLI session from `~/.grok/auth.json`. Never commit or share that file.

## Install

### Hermes

Install directly from GitHub and enable it:

```bash
hermes plugins install quynhchiv/grok-imagine-codex --enable
```

After the project is accepted into the official Hermes catalog, the short form will be:

```bash
hermes plugins install grok-imagine --enable
```

### Codex

```bash
codex plugin marketplace add quynhchiv/grok-imagine-codex --ref v0.3.1
codex plugin add grok-imagine@grok-imagine
```

### Claude Code

```bash
claude plugin marketplace add quynhchiv/grok-imagine-codex
claude plugin install grok-imagine@grok-imagine
```

Restart the agent host, open a new task, and say `Setup Grok Imagine`. The doctor checks the runtime, Grok CLI, OAuth session, model access, and output folder without creating paid media.

## First paid test

Image and video generation can consume the user's xAI quota. Setup is complete without generating anything. When ready, ask:

```text
Generate one low-quality 1:1 origami fox test image with Grok Imagine.
```

Other examples:

```text
Animate this image into a six-second cinematic video.
Open the Grok Imagine image-to-video flow canvas.
```

## Troubleshooting

| Doctor result | Meaning | Fix |
|---|---|---|
| Node.js `FAIL` | Node.js is missing or older than 20 | Install Node.js 20 LTS or newer and restart the host |
| Agent host `WARN` | Codex, Claude, or Hermes CLI was not detected | Confirm the plugin is running from your intended host |
| Grok CLI `FAIL` | Official Grok CLI is missing | Install Grok CLI, then run `grok login --oauth` |
| Authentication `FAIL` | OAuth session is missing, expired, or invalid | Run `grok login --oauth`, then rerun setup |
| xAI API `FAIL` | Account, billing, network, or model access problem | Check account access and billing, then retry |
| Output `FAIL` | Default folder cannot be written | Set `GROK_IMAGINE_OUT` to a writable absolute folder |

When requesting support, include doctor output but never include access tokens, refresh tokens, or `~/.grok/auth.json`.

## Development

```bash
cd server
npm ci
npm test
npm run build
npm run audit:bundle
node scripts/mcp-smoke.mjs
npm run validate:package
```

The repository root is a portable Agent Plugins v1 package. Compatibility overlays are included for Codex (`.codex-plugin`, `.agents/plugins`) and Claude Code (`.claude-plugin`, `.mcp.json`). Keep all manifest versions synchronized and publish immutable tags for releases.

## Privacy and security

- OAuth through Grok CLI is the only authentication method.
- No maintainer credential, account, or token is bundled.
- Credentials remain on the user's computer and are never returned by MCP tools.
- Prompts and media are sent to xAI only when the user starts an Imagine operation.
- Generated files are saved locally.
- The setup doctor does not generate paid media.

Review xAI pricing, terms, and acceptable-use policies before commercial use.

## License

MIT. See [LICENSE](LICENSE).
