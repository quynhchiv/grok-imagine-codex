# Security policy

## Reporting a vulnerability

Please do not open a public issue for suspected credential exposure or another security vulnerability. Contact the maintainer privately through the security advisory feature of this GitHub repository.

Include the affected version, reproduction steps, and potential impact. Do not include access tokens, refresh tokens, API keys, or private media in the report.

## Credential handling

This project must never contain Grok OAuth credentials or `~/.grok/auth.json`. Users authenticate locally with the official Grok CLI. If credentials are accidentally committed, revoke them immediately and remove them from Git history before publishing.
