import { canonicalize } from "../../base/mod.ts";
import type {
  BuiltinFormatName,
  ContentFile,
  FormatDeclaration,
  FormatValidationResult,
  SectionExtractionResult,
} from "../../contracts/documents/mod.ts";
import {
  DATA_MEDIA_TYPE,
  DOCUMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPE,
  PDF_MEDIA_TYPE,
} from "../../contracts/documents/mod.ts";
import { extractHtml } from "./modules/document/html.ts";
import { scanMarkdown } from "./modules/document/markdown.ts";
import {
  failedExtraction,
  type FormatModuleInput,
  type InputIssue,
  normalizeDocumentText,
  primaryFile,
} from "./pure/input.ts";
import { decodeUtf8 } from "./pure/utf8.ts";
import {
  buildSections,
  readyExtraction,
  unsupportedExtraction,
  validationFrom,
} from "./pure/module.ts";
import { sha256Bytes } from "./pure/sha256.ts";

const DOCUMENT_TYPES = new Set<string>(DOCUMENT_MEDIA_TYPES);
const MARKDOWN_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

export type FormatKind = BuiltinFormatName;

// module 묶음 hash는 T4가 코드 전체로 계산한다. 이 값은 선언 자리만 채운다.
export const MODULE_HASH_PLACEHOLDER = "0".repeat(64);

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

const DECLARATIONS: Record<FormatKind, FormatDeclaration> = {
  document: {
    name: "document",
    module_hash: MODULE_HASH_PLACEHOLDER,
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
    module_hash: MODULE_HASH_PLACEHOLDER,
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
    module_hash: MODULE_HASH_PLACEHOLDER,
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
    module_hash: MODULE_HASH_PLACEHOLDER,
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

function duplicateAnchors(
  file: string,
  tree: Extract<ReturnType<typeof buildSections>, { ok: true }>,
): InputIssue[] {
  return tree.diagnostics.map((item) => ({
    code: "duplicate_anchor",
    message: item.message,
    file,
    line: item.line,
    column: 1,
  }));
}

function documentValidation(
  input: FormatModuleInput,
): FormatValidationResult {
  const normalized = normalizeDocumentText(input);
  if (!normalized.ok) return validationFrom(input, normalized.issues);
  const file = normalized.value.file;
  const media = file.media_type;
  if (!DOCUMENT_TYPES.has(media)) {
    return validationFrom(input, [{
      code: "unsupported_media_type",
      message: `${media} is not a document media type`,
      file: file.path,
    }]);
  }
  const located = decodeDocument(normalized.value.bytes) ??
    normalized.value.text;
  if (MARKDOWN_TYPES.has(media) || media === "text/plain") {
    const scan = scanMarkdown(located);
    const tree = buildSections({
      text: normalized.value.text,
      headings: media === "text/plain" ? [] : scan.headings,
      documentTitle: null,
      omitted: scan.omitted,
    });
    if (!tree.ok) {
      return validationFrom(input, [{
        code: "invalid_structure",
        message: tree.reason,
        file: file.path,
        line: tree.line,
        column: 1,
      }]);
    }
    return validationFrom(input, duplicateAnchors(file.path, tree), file.path);
  }
  const html = extractHtml(located);
  const tree = buildSections({
    text: html.text,
    headings: html.headings,
    documentTitle: null,
    omitted: html.omitted,
  });
  if (!tree.ok) {
    return validationFrom(input, [{
      code: "invalid_structure",
      message: tree.reason,
      file: file.path,
      line: tree.line,
      column: 1,
    }]);
  }
  return validationFrom(input, duplicateAnchors(file.path, tree), file.path);
}

function bytesValidation(input: FormatModuleInput): FormatValidationResult {
  const primary = primaryFile(input);
  if (!primary.ok) return validationFrom(input, primary.issues);
  return validationFrom(input, []);
}

export function validateFormat(
  name: FormatKind,
  input: FormatModuleInput,
): FormatValidationResult {
  if (name === "document") return documentValidation(input);
  return bytesValidation(input);
}

function decodeDocument(bytes: readonly number[]): string | null {
  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) return null;
  const withoutBom = decoded.text.charCodeAt(0) === 0xfeff
    ? decoded.text.slice(1)
    : decoded.text;
  return withoutBom.replace(/\r\n?/g, "\n");
}

function soleH1<T extends { level: number; title: string }>(
  headings: readonly T[],
): T | null {
  const tops = headings.filter((heading) => heading.level === 1);
  return tops.length === 1 ? tops[0]! : null;
}

function documentExtraction(
  input: FormatModuleInput,
): SectionExtractionResult {
  const normalized = normalizeDocumentText(input);
  if (!normalized.ok) {
    return failedExtraction(
      input,
      normalized.issues.map((issue) => issue.message).join("; "),
    );
  }
  const media = normalized.value.file.media_type;
  const text = normalized.value.text;
  // HTML 줄 위치는 NFC 이전 텍스트 기준이다. 대표 텍스트는 NFC를 유지한다.
  const located = decodeDocument(normalized.value.bytes) ?? text;
  if (media === "text/plain") {
    const tree = buildSections({
      text,
      headings: [],
      documentTitle: null,
      omitted: [],
    });
    if (!tree.ok) return failedExtraction(input, tree.reason);
    return readyExtraction(input, text, tree);
  }
  if (MARKDOWN_TYPES.has(media)) {
    const scan = scanMarkdown(located);
    const sole = soleH1(scan.headings);
    const headings = sole === null
      ? scan.headings
      : scan.headings.filter((heading) => heading !== sole);
    const tree = buildSections({
      text,
      headings,
      documentTitle: sole?.title ?? null,
      omitted: scan.omitted,
    });
    if (!tree.ok) return failedExtraction(input, tree.reason);
    if (tree.diagnostics.length > 0) {
      return failedExtraction(input, tree.diagnostics[0]!.message);
    }
    return readyExtraction(input, text, tree);
  }
  if (HTML_TYPES.has(media)) {
    const html = extractHtml(located);
    const sole = soleH1(html.headings);
    const headings = sole === null
      ? html.headings
      : html.headings.filter((heading) => heading !== sole);
    const tree = buildSections({
      text: html.text,
      headings,
      documentTitle: sole?.title ?? html.title,
      omitted: html.omitted,
    });
    if (!tree.ok) return failedExtraction(input, tree.reason);
    if (tree.diagnostics.length > 0) {
      return failedExtraction(input, tree.diagnostics[0]!.message);
    }
    return readyExtraction(input, text, tree);
  }
  return failedExtraction(input, `${media} is not a document media type`);
}

export function extractFormat(
  name: FormatKind,
  input: FormatModuleInput,
): SectionExtractionResult {
  if (name !== "document") return unsupportedExtraction(input);
  return documentExtraction(input);
}

export function declarationJson(name: FormatKind): string {
  return canonicalize(formatDeclaration(name));
}
