// lophn-artifact:// 요청을 root 안 file로 답한다. GET·HEAD만, root 밖·일반 file이 아닌 것·크기 초과는 404.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { extname } from "node:path";

import { ENTRIES_PATH, listDataEntries } from "./entries.ts";
import { resolveInsideRoot } from "./paths.ts";

// rea DEFAULT_CSP에서 connect-src만 'self'다. template이 자기 data/를 fetch해야 갈아끼우기와 series가 된다.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'self'",
  "form-action 'none'",
  "base-uri 'self'",
].join("; ");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function createArtifactServer(deps: {
  rootOf(host: string): string | undefined;
  maxBytes: number;
}): (request: Request) => Promise<Response> {
  const headers = (type: string, policy: string) => ({
    "content-type": type,
    "cache-control": "no-store",
    "x-dns-prefetch-control": "off",
    "content-security-policy": policy,
  });
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: headers("text/plain; charset=utf-8", "default-src 'none'"),
    });

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405 });
    }
    const url = new URL(request.url);
    const root = deps.rootOf(url.hostname);
    if (root === undefined) return notFound();
    let path = url.pathname;
    if (path.endsWith("/")) path += "index.html";
    const head = request.method === "HEAD";

    if (path.replace(/^\/+/, "") === ENTRIES_PATH) {
      return new Response(head ? null : await listDataEntries(root), {
        status: 200,
        headers: headers("application/json; charset=utf-8", CSP),
      });
    }

    const resolved = await resolveInsideRoot(root, path);
    if (resolved === null) return notFound();
    let file;
    try {
      file = await open(
        resolved.absolute,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch {
      return notFound();
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > deps.maxBytes) return notFound();
      const body = head ? null : new Uint8Array(await file.readFile());
      return new Response(body, {
        status: 200,
        headers: headers(
          CONTENT_TYPES[extname(resolved.absolute).toLowerCase()] ??
            "application/octet-stream",
          CSP,
        ),
      });
    } finally {
      await file.close();
    }
  };
}
