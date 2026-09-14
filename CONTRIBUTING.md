# Contributing

Contributions are welcome through issues and pull requests.

Before submitting a pull request:

1. Do not add credentials, private media, or generated output files.
2. Run `npm ci`, `npm test`, and `npm run build` in the plugin server directory.
3. Keep `XAI_API_KEY` and Grok CLI OAuth authentication compatible; never commit either credential.
4. Never return access tokens or refresh tokens from MCP tools.
5. Explain user-visible changes in the pull request description.

For install-related changes, also run `npm run doctor` and confirm that it never starts a media generation request. Pull requests must keep the legacy `.codex-plugin/plugin.json` and portable `plugin.json` metadata synchronized.
