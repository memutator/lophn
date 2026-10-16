// lophn-shell:// 은 renderer build 출력 폴더의 설치 파일만 내준다.
// path traversal과 폴더 밖 symlink는 거절하고, 모든 응답에 CSP를 붙인다.
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";

import { SHELL_SCHEME } from "./security.ts";

const SHELL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  // 편집기가 이미지와 pdf(`<embed>`)를 blob URL로 그린다.
  "img-src 'self' data: blob:",
  "object-src blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * pathname을 root 안의 파일로만 푼다. `..`, NUL, 역슬래시, 절대 경로,
 * 디코드에 실패하는 값은 null이다.
 */
function safeJoin(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((part) =>
    part !== "" && part !== "."
  );
  // 디코드 뒤에야 보이는 절대 경로(`/etc/passwd`의 `etc`가 아니라 `/etc`)와 `..`.
  // 세그먼트 안에 남은 "/"는 %2F처럼 인코딩됐던 구분자다.
  if (
    segments.some((part) =>
      part === ".." || part.includes("/") || isAbsolute(part)
    )
  ) return null;
  const full = resolve(root, ...segments);
  const rootResolved = resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
    return null;
  }
  return full;
}

interface ShellResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

interface FileSystem {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
}

const nodeFs: FileSystem = {
  lstat: (path) => lstat(path),
  realpath: (path) => realpath(path),
  readFile: (path) => readFile(path),
};

function headers(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "content-security-policy": SHELL_CSP,
    "x-content-type-options": "nosniff",
  };
}

function empty(status: number): ShellResponse {
  return {
    status,
    headers: headers("text/plain; charset=utf-8"),
    body: null,
  };
}

interface ShellHandlerOptions {
  /** renderer build 출력 폴더. 이 폴더 밖은 어떤 경로로도 내주지 않는다. */
  distDir: string;
  fs?: FileSystem;
}

export function createShellHandler(
  options: ShellHandlerOptions,
): (request: Request) => Promise<ShellResponse> {
  const fs = options.fs ?? nodeFs;
  const distDir = resolve(options.distDir);
  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return empty(404);
    }
    if (url.protocol !== `${SHELL_SCHEME}:`) return empty(404);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return empty(405);
    }
    // host는 화면 이름이다. lophn-shell://desktop/index.html → desktop/index.html.
    if (url.host === "") return empty(404);
    const file = safeJoin(distDir, `/${url.host}${url.pathname}`);
    if (file === null || file === distDir) return empty(404);
    try {
      // 조상 디렉터리의 symlink도 폴더 밖으로 새므로 실제 자리로 다시 비교한다.
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) return empty(404);
      const real = await fs.realpath(file);
      const realRoot = await fs.realpath(distDir);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        return empty(404);
      }
      const body = request.method === "HEAD" ? null : await fs.readFile(real);
      return { status: 200, headers: headers(mimeFor(real)), body };
    } catch {
      return empty(404);
    }
  };
}

/** renderer dist의 desktop entry를 담는 첫 창 주소. */
export const DESKTOP_URL = `${SHELL_SCHEME}://desktop/index.html`;
