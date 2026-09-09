# Contributing

Contributions are welcome through issues and pull requests.

Before submitting a pull request:

1. Do not add credentials, private media, or generated output files.
2. Run `npm ci`, `npm test`, and `npm run build` in the plugin server directory.
3. Keep authentication compatible with the official Grok CLI OAuth flow.
4. Never return access tokens or refresh tokens from MCP tools.
5. Explain user-visible changes in the pull request description.
