import { jsonObjectSchema } from "../base/json-values.ts";

const KIB = 1024;

// redaction 뒤 UTF-8 상한.
export const INVOCATION_SUMMARY_MAX_BYTES = 16 * KIB;

// summary는 redaction 뒤의 작은 JSON object다. 입출력 본문·credential 원문이 아니다.
export const invocationSummarySchema = jsonObjectSchema.refine(
  (value) =>
    new TextEncoder().encode(JSON.stringify(value)).length <=
    INVOCATION_SUMMARY_MAX_BYTES,
  { message: "invocation summary exceeds 16384 UTF-8 bytes" },
);
