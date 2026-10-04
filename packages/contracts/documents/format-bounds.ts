import type { z } from "zod";

const MIB = 1024 * 1024;
const KIB = 1024;

// architecture/documents 2.2 초기 조절값. domain 원문 크기 제한이 아니다.
export const FORMAT_GUEST_MEMORY_BYTES = 64 * MIB;
export const FORMAT_CALL_TIMEOUT_MS = 5_000;
export const FORMAT_INPUT_MAX_BYTES = 16 * MIB;
export const FORMAT_OUTPUT_MAX_BYTES = 8 * MIB;

// public JSON은 platform RPC 한도와 같다. 전체 pure result의 8MiB와 별개다.
export const FORMAT_PUBLIC_JSON_MAX_BYTES = 256 * KIB;
export const FORMAT_TEXT_PAGE_MAX_CODEPOINTS = 12_000;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function codePointLength(value: string): number {
  return [...value].length;
}

export function jsonUtf8ByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

export function publicJsonBound<T extends z.ZodType>(schema: T) {
  return schema.refine(
    (value) => jsonUtf8ByteLength(value) <= FORMAT_PUBLIC_JSON_MAX_BYTES,
    { message: "public JSON exceeds 256KiB UTF-8" },
  );
}
