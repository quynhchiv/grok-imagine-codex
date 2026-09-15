# Grok Imagine Plugin

Generate and edit images and videos with Grok Imagine from **Hermes, Codex, or Claude Code**. Authentication uses each user's own Grok CLI OAuth session; generated files stay local.

> Community project. Not affiliated with OpenAI, Anthropic, Nous Research, or xAI.

[Hướng dẫn cài đặt tiếng Việt](docs/SETUP_VI.md)

## Features

- Image generation and editing
- Text-to-video, image-to-video, reference-to-video, editing, and extension
- Local visual flow canvas
- Dependency-free, auditable MCP runtime

Requires **Node.js 20+**, the official **Grok CLI**, and an account with Imagine model access.

## Install

### Hermes

```bash
hermes plugins install quynhchiv/grok-imagine-codex --enable
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

## Connect and use

```bash
grok login --oauth
```

Restart the agent, open a new task, and say:

```text
Setup Grok Imagine
```

Example requests:

```text
Generate a 1:1 origami fox icon.
Animate this image into a six-second cinematic video.
Open the Grok Imagine image-to-video canvas.
```

Media generation may consume the user's xAI quota. The setup doctor does not generate media.

## Security

- OAuth is the only supported authentication method.
- Tokens remain in `~/.grok/auth.json` and are never returned by MCP tools.
- Requests go only to xAI authentication and API endpoints.
- The shipped runtime has no production npm dependencies and passes Hermes security scanning.

See [SECURITY.md](SECURITY.md) for the complete data flow.

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

## License

[MIT](LICENSE)
