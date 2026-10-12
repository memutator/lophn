import type { RunTrace } from "../../protocol/lophn-agent/mod.ts";
import { TRACE_EXPORT_FORMAT_VERSION } from "../../protocol/lophn-agent/mod.ts";
import type {
  RedactionInput,
  RedactionResult,
} from "../../protocol/platform/mod.ts";

// export 파일의 형식과 내용 판정(observability#R10, R14, R16, R17). trace 자체는 원본
// 참조 묶음이므로 그대로 한 줄에 내보내도 사본이 아니다. 선택한 본문만 redaction 뒤
// 앞부분만 자른다. IO는 work.ts가 한다. 이 파일은 파일·network를 열지 않는다.

// redaction 뒤 값 하나의 UTF-8 상한(platform/redaction 뒤, R10).
export const EXPORT_VALUE_MAX_BYTES = 32768;

const encoder = new TextEncoder();

// 잘림 표시는 본문 안 문구가 아니라 별도 필드다(R10). 잘린 개수와 원본 크기를 같이 낸다.
export type ExportedValue = {
  // redaction을 끝낸 값. 끝내지 못한 값은 잘리지 않은 값 대신 제외한다.
  kind: "text";
  body: string;
  truncated: boolean;
  original_bytes: number;
};

export type ExcludedValue = {
  reference: string;
  // redaction 실패·원본 부재다. 값·이유 원문은 담지 않는다(R9, R10).
  reason: "redaction_failed" | "original_missing";
};

// UTF-8 상한 안에서 글자 경계를 지키는 앞부분이다. 연속 바이트(10xxxxxx) 끝에서 자르므로
// 한글·이모지의 중간이 잘리지 않는다(R10).
export function truncateForExport(
  text: string,
  limitBytes: number = EXPORT_VALUE_MAX_BYTES,
): { value: string; truncated: boolean; original_bytes: number } {
  const bytes = encoder.encode(text);
  if (bytes.length <= limitBytes) {
    return { value: text, truncated: false, original_bytes: bytes.length };
  }
  let end = limitBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return {
    value: new TextDecoder("utf-8", { fatal: false }).decode(
      bytes.slice(0, end),
    ),
    truncated: true,
    original_bytes: bytes.length,
  };
}

// export가 쓰는 주입 값. platform redaction 엔진과 같은 모양이고, 없으면 내보내지
// 않는다(fail-closed). body는 blob에서 읽은 글 하나다.
export type ExportRedactor = (
  input: RedactionInput,
  body: string,
) => RedactionResult | Promise<RedactionResult>;

const EXPORT_SOURCE = {
  concern: "lophn-agent/observability",
  revision: "1",
  scope: "trace-export",
};

// media_type은 redaction 엔진이 지원하는 글 두 종류이고 export 본문은 항상 글이다.
const EXPORT_MEDIA = "text/plain";

// redaction을 끝내지 못하면 값은 나가지 않는다(fail-closed). 성공 본문은 truncate뿐이고
// 잘림·제외는 값 바깥 필드에 남는다(R10).
export async function exportValue(
  redactor: ExportRedactor,
  reference: string,
  value: string,
): Promise<{ value: ExportedValue } | { excluded: ExcludedValue }> {
  let result: RedactionResult;
  try {
    result = await redactor({
      source: EXPORT_SOURCE,
      media_type: EXPORT_MEDIA,
      audience: "external",
      safe_fields: [],
      private_fields: [],
    }, value);
  } catch {
    return { excluded: { reference, reason: "redaction_failed" } };
  }
  if (
    result.status === "omitted" || result.content === null ||
    result.content.kind !== "inline" ||
    typeof result.content.value !== "string"
  ) {
    return { excluded: { reference, reason: "redaction_failed" } };
  }
  const cut = truncateForExport(result.content.value);
  return {
    value: {
      kind: "text",
      body: cut.value,
      truncated: cut.truncated,
      original_bytes: cut.original_bytes,
    },
  };
}

// NDJSON 줄 하나다. 첫 줄은 형식 버전이고 trace·content 줄이 그 뒤에 온다(R14).
export type ExportLine =
  | {
    type: "export";
    format_version: typeof TRACE_EXPORT_FORMAT_VERSION;
    generated_at: string;
  }
  | { type: "trace"; trace: RunTrace }
  | {
    type: "content";
    record: string;
    field: string;
    value: ExportedValue;
  };

export function exportLine(line: ExportLine): string {
  return `${JSON.stringify(line)}\n`;
}

// export 파일의 첫 줄이다.
export function exportHeader(generatedAt: string): ExportLine {
  return {
    type: "export",
    format_version: TRACE_EXPORT_FORMAT_VERSION,
    generated_at: generatedAt,
  };
}

export type ExportCount = {
  // 대상에 실제로 쓴 trace 줄 수다.
  sent: number;
  // redaction 실패·원본 부재로 빠진 trace 줄 수다.
  not_sent: number;
};

// 빈 content_kinds인 export는 메타데이터만 내보낸다(R16).
export function emptyCount(): ExportCount {
  return { sent: 0, not_sent: 0 };
}
