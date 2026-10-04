// guest 계산. model.ts의 선언·hash는 host에 남긴다.
import { extractHtml } from "./modules/document/html.ts";
import { scanMarkdown } from "./modules/document/markdown.ts";
import {
  failedExtraction,
  type FormatModuleInput,
  type GuestExtraction,
  type GuestValidation,
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

const DOCUMENT_TYPES = new Set<string>([
  "text/markdown",
  "text/x-markdown",
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);
const MARKDOWN_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

export type FormatKind = "document" | "pdf" | "image" | "data";

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
): GuestValidation {
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

function bytesValidation(input: FormatModuleInput): GuestValidation {
  const primary = primaryFile(input);
  if (!primary.ok) return validationFrom(input, primary.issues);
  return validationFrom(input, []);
}

export function validateFormat(
  name: FormatKind,
  input: FormatModuleInput,
): GuestValidation {
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
): GuestExtraction {
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
): GuestExtraction {
  if (name !== "document") return unsupportedExtraction(input);
  return documentExtraction(input);
}
