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
