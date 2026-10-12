import { canonicalize } from "../../base/mod.ts";
import type {
  ContentFile,
  FormatDeclaration,
} from "../../protocol/projects/mod.ts";
import {
  DATA_MEDIA_TYPE,
  DOCUMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPE,
  PDF_MEDIA_TYPE,
} from "../../protocol/projects/mod.ts";
import { sha256Bytes } from "./pure/sha256.ts";
import { BUILTIN_MODULE_HASH } from "./guest/module-hash.ts";
import type { BUILTIN_FORMAT_NAMES } from "../../protocol/projects/mod.ts";

const DOCUMENT_TYPES = new Set<string>(DOCUMENT_MEDIA_TYPES);

// 묶음 코드·의존·추출 규칙·guest 실행 규약의 sha256. guest/module-hash.ts가 정본이다.
export const MODULE_HASH_PLACEHOLDER = BUILTIN_MODULE_HASH;

const EMPTY_TEMPLATE_HASH = sha256Bytes([]);

function template(path: string, mediaType: string): ContentFile {
  return {
    path,
    blob_hash: EMPTY_TEMPLATE_HASH,
    bytes: 0,
    media_type: mediaType,
    primary: true,
  };
}

// 내장 format 이름. guest.ts·runner protocol.ts가 같은 집합을 다시 적지 않게
// contracts의 고정 목록을 쓴다.
type FormatKind = (typeof BUILTIN_FORMAT_NAMES)[number];

const DECLARATIONS: Record<FormatKind, FormatDeclaration> = {
  document: {
    name: "document",
    module_hash: BUILTIN_MODULE_HASH,
    media_types: [...DOCUMENT_MEDIA_TYPES],
    structure: {
      headings: "markdown-atx-setext and html-h1-h6",
      excluded: [
        "front-matter",
        "fenced-code",
        "html-pre",
        "script",
        "style",
        "template",
        "nav",
        "textarea",
        "head",
        "title",
        "hidden",
      ],
    },
    metadata: {
      title: { type: "string", required: false, series_order: false },
    },
    template: [template("document.md", "text/markdown")],
    guide: {
      text:
        "Markdown ATX·setext heading, or the original HTML and XHTML h1–h6, become sections. Plain text stays searchable without headings. The single h1 is the document title.",
      examples: [
        "# Title\n\nIntro.\n\n## Section\n\nBody.\n",
        "<h1>Title</h1>\n<p>Body.</p>\n",
      ],
    },
    vocabulary: [
      { name: "heading", description: "ATX, setext, or HTML h1–h6" },
      { name: "anchor", description: "explicit {#id} or HTML id" },
      { name: "preamble", description: "body before the first heading" },
    ],
    extracts: true,
  },
  pdf: {
    name: "pdf",
    module_hash: BUILTIN_MODULE_HASH,
    media_types: [PDF_MEDIA_TYPE],
    structure: {},
    metadata: {},
    template: [template("document.pdf", PDF_MEDIA_TYPE)],
    guide: {
      text: "PDF keeps the original bytes. Section extraction is unsupported.",
      examples: [],
    },
    vocabulary: [{ name: "page", description: "original PDF bytes" }],
    extracts: false,
  },
  image: {
    name: "image",
    module_hash: BUILTIN_MODULE_HASH,
    media_types: [IMAGE_MEDIA_TYPE],
    structure: {},
    metadata: {},
    template: [template("image.png", "image/png")],
    guide: {
      text:
        "An image keeps the original bytes. Section extraction is unsupported.",
      examples: [],
    },
    vocabulary: [{ name: "image", description: "image/* bytes" }],
    extracts: false,
  },
  data: {
    name: "data",
    module_hash: BUILTIN_MODULE_HASH,
    media_types: [DATA_MEDIA_TYPE],
    structure: {},
    metadata: {},
    template: [template("data.bin", "application/octet-stream")],
    guide: {
      text:
        "Any other media type keeps the original bytes. Section extraction is unsupported.",
      examples: [],
    },
    vocabulary: [{ name: "bytes", description: "original file bytes" }],
    extracts: false,
  },
};

const FORMAT_NAMES = ["document", "pdf", "image", "data"] as const;

export function formatDeclarations(): FormatDeclaration[] {
  return FORMAT_NAMES.map((name) => structuredClone(DECLARATIONS[name]));
}

export function formatDeclaration(name: FormatKind): FormatDeclaration {
  return structuredClone(DECLARATIONS[name]);
}

export function formatForMediaType(mediaType: string): FormatKind {
  if (DOCUMENT_TYPES.has(mediaType)) return "document";
  if (mediaType === PDF_MEDIA_TYPE) return "pdf";
  if (mediaType.startsWith("image/")) return "image";
  return "data";
}

export function declarationJson(name: FormatKind): string {
  return canonicalize(formatDeclaration(name));
}
