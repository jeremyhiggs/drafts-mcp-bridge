import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function isBearerAuthorized(req: IncomingMessage, token: string): boolean {
  const value = req.headers.authorization;
  if (typeof value !== "string") {
    return false;
  }

  const prefix = "Bearer ";
  if (!value.startsWith(prefix)) {
    return false;
  }

  const supplied = value.slice(prefix.length);
  const expectedDigest = createHash("sha256").update(token).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function writeUnauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": 'Bearer realm="drafts-mcp-bridge"',
  });
  res.end(
    JSON.stringify({
      error: "unauthorized",
    }),
  );
}
