import type { ToolResult } from "../../../contracts/lophn-agent/mod.ts";

// 결과 상한(R13, R14). 목록·검색은 한 번에 20개. 텍스트는 UTF-8 24 KiB와 300줄
// 중 먼저 닿는 곳에서 자른다. 문서는 앞, log는 뒤를 남기고 JSON·Unicode를 깨지
// 않는다.

export const PAGE_SIZE = 20;
export const TEXT_MAX_BYTES = 24 * 1024;
export const TEXT_MAX_LINES = 300;

export type Page<T> = {
  items: readonly T[];
  hasMore: boolean;
  nextCursor: string | null;
};

// cursor는 base64 {after}다. 조건은 호출자가 유지하고 여기는 위치만 옮긴다.
export function pageOf<T>(items: readonly T[], cursor: string | null): Page<T> {
  const start = cursor === null ? 0 : indexAfter(items, cursor);
  const slice = items.slice(start, start + PAGE_SIZE);
  const next = start + slice.length;
  const hasMore = next < items.length;
  return {
    items: slice,
    hasMore,
    nextCursor: hasMore ? cursorOf(next - 1) : null,
  };
}

function indexAfter<T>(items: readonly T[], cursor: string): number {
  const parsed = readCursor(cursor);
  if (parsed === null) return items.length;
  return Math.min(items.length, parsed + 1);
}

function readCursor(cursor: string): number | null {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after?: unknown };
    return typeof parsed.after === "number" && Number.isInteger(parsed.after) &&
        parsed.after >= 0
      ? parsed.after
      : null;
  } catch {
    return null;
  }
}

function cursorOf(after: number): string {
  return btoa(JSON.stringify({ after }));
}

export type TextLimit = {
  text: string;
  complete: boolean;
  originalBytes: number;
  originalLines: number;
  omittedCount: number;
};

// direction head는 문서·목록, tail은 log다(R14). 멀티바이트 문자와 JSON 문자열
// 경계를 넘지 않게 UTF-8 code point와 줄 경계에서만 자른다.
export function limitText(
  text: string,
  direction: "head" | "tail",
): TextLimit {
  const encoded = new TextEncoder().encode(text);
  const lines = text.split("\n");
  const originalBytes = encoded.byteLength;
  const originalLines = lines.length;
  const overBytes = originalBytes > TEXT_MAX_BYTES;
  const overLines = originalLines > TEXT_MAX_LINES;
  if (!overBytes && !overLines) {
    return {
      text,
      complete: true,
      originalBytes,
      originalLines,
      omittedCount: 0,
    };
  }
  const kept = direction === "head"
    ? keepHead(text, lines)
    : keepTail(text, lines);
  return {
    text: kept,
    complete: false,
    originalBytes,
    originalLines,
    omittedCount: countOmitted(text, kept),
  };
}

function keepHead(text: string, lines: readonly string[]): string {
  const chosen = lines.slice(0, TEXT_MAX_LINES).join("\n");
  return cutBytes(chosen, "head", text);
}

function keepTail(text: string, lines: readonly string[]): string {
  const chosen = lines.slice(-TEXT_MAX_LINES).join("\n");
  return cutBytes(chosen, "tail", text);
}

function cutBytes(
  text: string,
  direction: "head" | "tail",
  original: string,
): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= TEXT_MAX_BYTES) return text;
  const slice = direction === "head"
    ? bytes.slice(0, TEXT_MAX_BYTES)
    : bytes.slice(bytes.byteLength - TEXT_MAX_BYTES);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  // 잘린 멀티바이트가 교체 문자로 남으면 그 문자를 버린다.
  const clean = decoded.includes("�")
    ? direction === "head"
      ? decoded.slice(0, decoded.lastIndexOf("�"))
      : decoded.slice(decoded.indexOf("�") + 1)
    : decoded;
  return direction === "tail" && !original.endsWith(clean) ? clean : clean;
}

function countOmitted(original: string, kept: string): number {
  return Math.max(
    0,
    new TextEncoder().encode(original).byteLength -
      new TextEncoder().encode(kept).byteLength,
  );
}

// JSON 결과는 문자열 한가운데를 자르지 않는다. 상한을 넘으면 content를 비우고
// 생략을 표시한다(R14).
export function limitJson(value: unknown): {
  content: unknown;
  complete: boolean;
  originalBytes: number;
} {
  const text = JSON.stringify(value);
  const originalBytes = new TextEncoder().encode(text).byteLength;
  if (originalBytes <= TEXT_MAX_BYTES) {
    return { content: value, complete: true, originalBytes };
  }
  return { content: null, complete: false, originalBytes };
}

export function boundedResult(
  result: ToolResult,
  limited: { complete: boolean },
): ToolResult {
  return limited.complete ? result : { ...result, complete: false };
}
