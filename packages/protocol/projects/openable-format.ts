// 열 수 있는 file의 형식 판별. media type으로 가르는 formatForMediaType과 확장자만 보는
// openableKind가 있다. 둘 다 순수 함수라 이 file은 다른 module을 import하지 않는다.
export type OpenableFormat = "document" | "pdf" | "image" | "data";

const DOCUMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "text/markdown",
  "text/x-markdown",
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);
const PDF_MEDIA_TYPE = "application/pdf";

export function formatForMediaType(mediaType: string): OpenableFormat {
  if (DOCUMENT_MEDIA_TYPES.has(mediaType)) return "document";
  if (mediaType === PDF_MEDIA_TYPE) return "pdf";
  if (mediaType.startsWith("image/")) return "image";
  return "data";
}

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "log",
  "html",
  "htm",
  "xhtml",
  "css",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "tsv",
  "xml",
  "sql",
  "sh",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "swift",
  "php",
  "lua",
]);

// 확장자만 보고 가른다. null은 모르는 확장자이고, text로 열 수 있는지는 부르는 쪽이 byte로 정한다.
export function openableKind(path: string): "text" | "image" | "pdf" | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  if (extension === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return null;
}
