// redaction이 쓰는 한도와 모양. protocol의 schema가 이 정의를 가져다 쓴다.

const MIB = 1024 * 1024;

// 고정 한도.
export const REDACTION_UNIT_MAX_BYTES = MIB;
export const REDACTION_MAX_DEPTH = 16;
export const REDACTION_MAX_ITEMS = 4096;
export const REDACTION_TIMEOUT_MS = 5_000;
export const REDACTION_REPLACEMENT = "*";

export const REDACTION_AUDIENCES = [
  "storage",
  "display",
  "model",
  "external",
] as const;
export type RedactionAudience = typeof REDACTION_AUDIENCES[number];

export const REDACTION_STATUSES = ["passed", "partial", "omitted"] as const;
export type RedactionStatus = typeof REDACTION_STATUSES[number];

export const OMISSION_REASONS = [
  "private",
  "secret_detected",
  "unsupported_media",
  "limit_exceeded",
  "redaction_failed",
  "uncertain",
] as const;
export type OmissionReason = typeof OMISSION_REASONS[number];

// 단독 `*`와 구간 중간 `*`는 원값 경로가 아니다.
export const FIELD_PATH_PATTERN =
  /^(?!\*)[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export type FieldPath = string;

export function isFieldPath(value: unknown): value is FieldPath {
  return typeof value === "string" && FIELD_PATH_PATTERN.test(value);
}

// 원문 메모리 참조. 바이트 자체는 pipe payload에 넣지 않는다.
export type RedactionSource = {
  concern: string;
  revision: string;
  scope: string;
};

export type RedactionInput = {
  source: RedactionSource;
  media_type: string;
  audience: RedactionAudience;
  safe_fields: FieldPath[];
  private_fields: FieldPath[];
};

// 검출한 값·길이·원문 일부를 담지 않는다.
export type RedactedItem = {
  location: string;
};

export type RedactionOmission = {
  location: string;
  reason: OmissionReason;
  message: string;
};

export type RedactionContent =
  | { kind: "inline"; value: string }
  | { kind: "blob"; hash: string };

export type RedactionResult = {
  rule_revision: string;
  status: RedactionStatus;
  content: RedactionContent | null;
  redacted_items: RedactedItem[];
  omissions: RedactionOmission[];
};

// 안전 필드·private 필드·표본 원값 경로. 표본 경로는 명시 경로만이다.
export type RedactionFieldDeclaration = {
  safe_fields: FieldPath[];
  private_fields: FieldPath[];
  sample_paths: FieldPath[];
};
