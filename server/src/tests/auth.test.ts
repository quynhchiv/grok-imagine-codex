import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inspectSession, parseExpiresAt, readAuthFile, resolveAuth } from "../auth.js";
import { redactSecrets } from "../errors.js";
import { slugFilename } from "../paths.js";

test("parseExpiresAt truncates extra fractional digits", () => {
  const d = parseExpiresAt("2026-09-08T08:35:19.158121700Z");
  assert.ok(d);
  assert.equal(d.toISOString(), "2026-09-08T08:35:19.158Z");
});

test("inspectSession reads grok CLI oidc entry without exposing the token", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-"));
  const file = path.join(dir, "auth.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      "https://auth.x.ai::test-client": {
        key: "super-secret-token-value",
        auth_mode: "oidc",
        email: "user@example.com",
        expires_at: "2099-01-01T00:00:00.000Z",
        oidc_issuer: "https://auth.x.ai",
        oidc_client_id: "test-client",
        refresh_token: "refresh-secret",
      },
    }),
  );
  const session = inspectSession(file);
  assert.ok(session);
  assert.equal(session.email, "user@example.com");
  assert.equal(session.expired, false);
  assert.equal(session.mode, "oidc");
  assert.equal(session.source, "grok-cli");
  const dumped = JSON.stringify(session);
  assert.equal(dumped.includes("super-secret"), false);
  assert.equal(dumped.includes("refresh-secret"), false);
  const file2 = readAuthFile(file);
  assert.ok(file2);
});

test("inspectSession skips web_login leftovers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-"));
  const file = path.join(dir, "auth.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      "https://accounts.x.ai/sign-in": { key: "legacy", auth_mode: "web_login" },
    }),
  );
  assert.equal(inspectSession(file), null);
});

test("redactSecrets strips bearer tokens", () => {
  const s = redactSecrets('Authorization Bearer abc.def.ghi and "refresh_token": "xyz"');
  assert.equal(s.includes("abc.def"), false);
  assert.equal(s.includes("xyz"), false);
});

test("slugFilename falls back when prompt is non-ascii", () => {
  const name = slugFilename("cáo origami đỏ", "jpg");
  assert.match(name, /^[a-z0-9TZ-]+\.jpg$/);
  assert.ok(name.endsWith(".jpg"));
});

test("resolveAuth ignores non-OAuth entries", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-auth-"));
  const file = path.join(dir, "auth.json");
  fs.writeFileSync(file, JSON.stringify({ legacy: { key: "not-oauth", auth_mode: "api_key" } }));
  await assert.rejects(resolveAuth(file), /No Grok CLI OAuth session found/);
});
