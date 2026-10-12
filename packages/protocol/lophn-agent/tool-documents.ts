import { z } from "zod";
import {
  defineWorker,
  idempotencyKeySchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  builtinFormatNameSchema,
  documentIdSchema,
  documentMetadataSchema,
  formatValidationPageSchema,
  saveResultSchema,
  versionIdSchema,
} from "../projects/mod.ts";

// 문서·format tool의 글 값 통로(lophn-agent/harness/tools#R6, R7). tool은 본문을 글(UTF-8)로
// 싣고 hash·blob을 만들지 않는다. core가 요청 자격으로 글을 redaction해 UTF-8 bytes로 blob을
// 준비한 뒤 documents의 준비·저장·검사 경로를 부른다(`document.prepare`·`document.save`·
// format 검사). 저장 범위(원본 연결·보관·지침 문서·파일 source 금지)는 documents/versions가
// 그대로 정한다. 이 route는 그 규칙을 다시 만들지 않는다.

export const TOOL_TEXT_MAX_BYTES = 128 * 1024;

// 본문 글. 공백뿐인 글과 NUL은 본문이 아니다. 상한은 UTF-8 bytes다.
export const toolTextSchema = z.string().refine(
  (value) =>
    /\S/.test(value) && !value.includes("\u0000") &&
    new TextEncoder().encode(value).byteLength <= TOOL_TEXT_MAX_BYTES,
  { message: "text must be non-blank UTF-8 within the limit" },
);

// 에이전트가 쓰는 본문의 형식. 그 밖의 파일 형식은 tool로 저장하지 않는다.
export const TOOL_TEXT_MEDIA_TYPES = [
  "text/markdown",
  "text/html",
  "text/plain",
] as const;
export const toolTextMediaTypeSchema = z.enum(TOOL_TEXT_MEDIA_TYPES);

// 본문 파일의 상대 경로. 형식이 정하고 호출자가 고르지 않는다.
export const TOOL_TEXT_PATHS: Readonly<
  Record<(typeof TOOL_TEXT_MEDIA_TYPES)[number], string>
> = {
  "text/markdown": "document.md",
  "text/html": "document.html",
  "text/plain": "document.txt",
};

export const toolFormatSchema = z.strictObject({
  name: builtinFormatNameSchema,
  module_hash: sha256Schema,
});

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

export const saveToolDocumentInputSchema = z.strictObject({
  document: documentIdSchema,
  // 새 문서면 null이고 metadata가 필요하다. 기존 문서면 읽은 version이고 metadata는 null이다.
  base_version: versionIdSchema.nullable(),
  metadata: documentMetadataSchema.nullable(),
  text: toolTextSchema,
  media_type: toolTextMediaTypeSchema,
  // 명시 format은 검사를 통과해야 저장한다. null이면 새 문서는 MIME 기본, 기존 문서는 기준 판의 계약이다.
  format: toolFormatSchema.nullable(),
  // 최초 ToolCall ID다. 같은 요청의 재전송은 새 판이나 새 문서를 만들지 않는다.
  idempotency_key: idempotencyKeySchema,
}).refine(
  (value) => (value.base_version === null) === (value.metadata !== null),
  { message: "a new document needs metadata and an existing one does not" },
);

export const saveToolDocument = defineWorker({
  resource: "tool-documents",
  method: "save",
  name: "SaveToolDocument",
  input: saveToolDocumentInputSchema,
  output: saveResultSchema,
  actors: ["agent"],
  errors,
});

export const validateToolTextInputSchema = z.strictObject({
  format: toolFormatSchema,
  text: toolTextSchema,
  media_type: toolTextMediaTypeSchema,
  cursor: z.string().min(1).optional(),
});

// 검사만 한다. Document·Version·준비 참조를 만들지 않는다. 결과는 documents의 검사 page다.
export const validateToolText = defineWorker({
  resource: "tool-documents",
  method: "validate",
  name: "ValidateToolText",
  input: validateToolTextInputSchema,
  output: formatValidationPageSchema,
  actors: ["agent"],
  errors,
});

export const TOOL_DOCUMENT_ROUTES = [
  saveToolDocument,
  validateToolText,
] as const;
