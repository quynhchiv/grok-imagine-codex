# Security policy

## Reporting a vulnerability

Please do not open a public issue for suspected credential exposure or another security vulnerability. Contact the maintainer privately through the security advisory feature of this GitHub repository.

Include the affected version, reproduction steps, and potential impact. Do not include access tokens, refresh tokens, API keys, or private media in the report.

## Credential handling

This project must never contain Grok OAuth credentials or `~/.grok/auth.json`. Users authenticate locally with the official Grok CLI. If credentials are accidentally committed, revoke them immediately and remove them from Git history before publishing.

## Runtime data flow

- The plugin reads the Grok CLI OAuth session from `~/.grok/auth.json` only when checking authentication or calling an Imagine operation.
- OAuth refresh requests are sent only to `https://auth.x.ai/oauth2/token`.
- Model and media requests are sent only to `https://api.x.ai`.
- Source media is sent to xAI only when the user requests an edit or image/video generation.
- Generated media and flow state are written to the user's local output directory.
- The local canvas listens on the loopback interface, not on public network interfaces.
- MCP responses never include access tokens or refresh tokens.

## Auditable build

The shipped MCP runtime has no production npm dependencies. It uses a small source-built JSON-RPC transport instead of bundling third-party MCP and schema libraries. CI rejects oversized bundles and common encoded or dynamically evaluated JavaScript patterns that previously caused Hermes security false positives.
