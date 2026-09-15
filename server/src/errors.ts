export class PluginError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.status = status;
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [redacted]")
    .replace(/("?(?:key|access_token|refresh_token|api_key)"?\s*[:=]\s*")[^"]+"/gi, '$1[redacted]"')
    .replace(/xai-[A-Za-z0-9]+/g, "xai-[redacted]");
}

export function errorMessage(err: unknown): string {
  if (err instanceof PluginError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return redactSecrets(err.message);
  return redactSecrets(String(err));
}
