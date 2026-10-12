// 앱 bundle 사본의 화면 자원을 직접 내주는 읽기(apps/runtime). 화면 build 결과는
// bundle의 `screens/<screen key>/<path>`에 있고, 요청 경로는 그 screen 아래 상대 경로뿐이다.
// 다른 screen이나 bundle 밖 경로는 파일이 있어도 내주지 않는다. 쓰기는 하지 않는다.
import { screenAssetPath } from "./wire.ts";

const TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  map: "application/json",
  wasm: "application/wasm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

// shell가 받는 content type은 위 표뿐이다(app-protocol). 모르는 확장자는 받지 못하는 형식으로 둔다.
export function screenContentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const extension = dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
  return TYPES[extension] ?? "application/octet-stream";
}

export type BundleScreenFiles = {
  screenBytes: (screen: string, path: string) => Uint8Array | undefined;
  contentType: (path: string) => string;
};

export function bundleScreenFiles(bundleDir: string): BundleScreenFiles {
  const root = bundleDir.replace(/\/+$/, "");
  return {
    screenBytes(screen, path) {
      if (screen.includes("/") || screen === "" || screen === "..") return;
      if (!screenAssetPath(path)) return;
      try {
        return Deno.readFileSync(`${root}/screens/${screen}/${path}`);
      } catch {
        return;
      }
    },
    contentType: screenContentType,
  };
}
