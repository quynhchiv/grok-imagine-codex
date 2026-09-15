#!/usr/bin/env node
/**
 * Live check: Grok CLI OAuth token → api.x.ai models + one tiny image.
 * Does not print tokens.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const authPath = path.join(process.env.GROK_HOME || path.join(os.homedir(), ".grok"), "auth.json");
if (!fs.existsSync(authPath)) {
  console.error("missing", authPath);
  process.exit(3);
}
const file = JSON.parse(fs.readFileSync(authPath, "utf8"));
const entry = Object.values(file).find((e) => e && e.key && e.auth_mode !== "web_login");
if (!entry) {
  console.error("no oidc session");
  process.exit(3);
}
const token = entry.key;
console.log("auth_mode", entry.auth_mode);
console.log("expires_at", entry.expires_at);
console.log("token_len", token.length);

const modelsRes = await fetch("https://api.x.ai/v1/models", {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
console.log("models_status", modelsRes.status);
if (!modelsRes.ok) {
  console.error("models_body", (await modelsRes.text()).slice(0, 300));
  process.exit(1);
}
const models = await modelsRes.json();
const ids = (models.data || []).map((m) => m.id).filter(Boolean);
console.log(
  "media_models",
  ids.filter((id) => /imagine|image|video/i.test(id)),
);

const imgRes = await fetch("https://api.x.ai/v1/images/generations", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    model: "grok-imagine-image-2.0",
    prompt: "A tiny red paper fox, white background, no text",
    n: 1,
    aspect_ratio: "1:1",
    quality: "low",
    response_format: "b64_json",
  }),
});
console.log("image_status", imgRes.status);
if (!imgRes.ok) {
  console.error("image_body", (await imgRes.text()).slice(0, 400));
  process.exit(1);
}
const img = await imgRes.json();
const b64 = img.data?.[0]?.b64_json;
const dest = path.join(os.tmpdir(), "grok-imagine-spike.jpg");
if (b64) {
  fs.writeFileSync(dest, Buffer.from(b64, "base64"));
  console.log("wrote", dest, fs.statSync(dest).size);
}
console.log("ok");
