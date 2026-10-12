import type { z } from "zod";

const MIB = 1024 * 1024;
const KIB = 1024;

// architecture/documents 2.2 초기 조절값. domain 원문 크기 제한이 아니다.
// FORMAT_INPUT_MAX_BYTES는 guest가 받는 입력 JSON 문자열의 상한이다. 파일 바이트는 JSON
// 숫자 배열로 들어가 한 바이트가 3~4자가 되고 guest 안에서는 원소마다 값 하나를 차지하므로
// 파일 크기의 상한은 아래 FORMAT_CHECK_CONTENT_MAX_BYTES다.
export const FORMAT_GUEST_MEMORY_BYTES = 64 * MIB;
export const FORMAT_CALL_TIMEOUT_MS = 5_000;
export const FORMAT_INPUT_MAX_BYTES = 16 * MIB;
export const FORMAT_OUTPUT_MAX_BYTES = 8 * MIB;

// format 검사가 guest에 넘기는 대표 파일 바이트의 상한. 위 guest memory·호출 시간 안에서
// 실제로 끝나는 크기다(대표 파일 1 MiB의 document 검사는 약 2.5초, 1.75 MiB부터 guest
// memory 초과). 문서 원문 크기의 domain 제한이 아니다: 저장 한도는 upload 상한이고, 이
// 크기를 넘는 대표 파일은 검사를 하지 못한다. format을 명시한 저장은 이 한도를 밝힌
// invalid_input으로 거절하고, 명시하지 않은 새 문서는 검사 생략 warning으로 저장한다.
export const FORMAT_CHECK_CONTENT_MAX_BYTES = 1 * MIB;

// 검사가 파일 바이트를 읽는 내장 format. 나머지는 파일 모양(경로·대표 파일 하나)만 보므로
// 바이트를 guest에 넘기지 않고 위 한도도 받지 않는다.
export const FORMATS_CHECKING_CONTENT: readonly string[] = ["document"];

export function formatChecksContent(name: string): boolean {
  return FORMATS_CHECKING_CONTENT.includes(name);
}

export function formatCheckLimitMessage(bytes: number): string {
  return `format check input is ${bytes} bytes, over the ${FORMAT_CHECK_CONTENT_MAX_BYTES} byte limit`;
}

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
    (value) => {
      try {
        return jsonUtf8ByteLength(value) <= FORMAT_PUBLIC_JSON_MAX_BYTES;
      } catch {
        // 앞의 JSON guard가 거절한 값도 refinement에서 throw하지 않는다.
        return false;
      }
    },
    { message: "public JSON exceeds 256KiB UTF-8" },
  );
}
