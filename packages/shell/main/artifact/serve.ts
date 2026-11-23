// lophn-artifact:// 요청을 root 안 file로 답한다. GET·HEAD만, root 밖·일반 file이 아닌 것·크기 초과는 404.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { extname } from "node:path";

import { ENTRIES_PATH, listDataEntries } from "./entries.ts";
import { resolveInsideRoot } from "./paths.ts";
import type { RemoteArtifact } from "./source.ts";

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

const INSTANCE_PATH = "data/_instance.json";
// 가상 kit file. 요청 path가 아니라 이 고정 이름 둘만 dist에서 읽는다.
const KIT_PATHS: Record<string, { name: "kit.js" | "kit.css"; type: string }> =
  {
    "_lophn/kit.js": { name: "kit.js", type: "text/javascript; charset=utf-8" },
    "_lophn/kit.css": { name: "kit.css", type: "text/css; charset=utf-8" },
  };

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
  scopeOf(host: string): string | undefined;
  /** 다른 컴퓨터의 artifact를 연 host면 그 대상. root 대신 그 컴퓨터가 file을 준다. */
  remoteOf(host: string): RemoteArtifact | undefined;
  readRemote(target: RemoteArtifact, path: string): Promise<Uint8Array | null>;
  readInstance(instance: string): Promise<string | null>;
  kit(name: "kit.js" | "kit.css"): Promise<Uint8Array<ArrayBuffer> | null>;
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
    const remote = deps.remoteOf(url.hostname);
    const root = deps.rootOf(url.hostname);
    if (root === undefined && remote === undefined) return notFound();
    let path = url.pathname;
    if (path.endsWith("/")) path += "index.html";
    const head = request.method === "HEAD";

    const key = path.replace(/^\/+/, "");
    if (root !== undefined && key === ENTRIES_PATH) {
      return new Response(head ? null : await listDataEntries(root), {
        status: 200,
        headers: headers("application/json; charset=utf-8", CSP),
      });
    }

    const kit = KIT_PATHS[key];
    if (kit !== undefined) {
      const body = await deps.kit(kit.name);
      if (body === null) return notFound();
      return new Response(head ? null : body, {
        status: 200,
        headers: headers(kit.type, CSP),
      });
    }

    if (remote !== undefined) {
      // core가 폴더 밖 path를 거절하지만 여기서도 어휘로 한 번 거른다.
      let decoded: string;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        return notFound();
      }
      if (
        decoded === "" ||
        decoded.includes("\0") ||
        decoded.includes("\\") ||
        decoded
          .split("/")
          .some((part) => part === ".." || part === "." || part === "")
      ) {
        return notFound();
      }
      const bytes = await deps.readRemote(remote, decoded);
      if (bytes === null || bytes.byteLength > deps.maxBytes) return notFound();
      return new Response(head ? null : new Uint8Array(bytes), {
        status: 200,
        headers: headers(
          CONTENT_TYPES[extname(decoded).toLowerCase()] ??
            "application/octet-stream",
          CSP,
        ),
      });
    }
    if (root === undefined) return notFound();

    const scope =
      key === INSTANCE_PATH ? deps.scopeOf(url.hostname) : undefined;
    if (scope !== undefined) {
      const raw = await deps.readInstance(scope);
      const json =
        raw !== null && Buffer.byteLength(raw, "utf8") <= deps.maxBytes
          ? raw
          : null;
      return new Response(
        head ? null : (json ?? JSON.stringify({ error: "unavailable" })),
        {
          status: json === null ? 503 : 200,
          headers: headers("application/json; charset=utf-8", CSP),
        },
      );
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
