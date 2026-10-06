import { z } from "zod";
import {
  atSchema,
  idempotencyKeySchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { documentFileInputSchema } from "./document-files.ts";
import {
  absolutePathSchema,
  documentIdSchema,
  projectIdSchema,
  revisionSchema,
  versionIdSchema,
} from "./values.ts";
import { instructionTargetSchema, saveResultSchema } from "./versions.ts";

// 사람 파일 통로의 목표. 다른 가지의 field는 strict 가지가 거절한다.
const projectTargetFields = {
  kind: z.literal("project_file"),
  project: projectIdSchema,
  path: absolutePathSchema,
};
const workingCopyTargetFields = {
  kind: z.literal("working_copy"),
  document: documentIdSchema,
};
const instructionTargetFields = {
  kind: z.literal("instruction_file"),
  instruction_target: instructionTargetSchema,
  project: projectIdSchema.nullable(),
  path: absolutePathSchema,
};
export const fileTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject(projectTargetFields),
  z.strictObject(workingCopyTargetFields),
  z.strictObject(instructionTargetFields),
]);
export const fileTargetOutputSchema = z.discriminatedUnion("kind", [
  z.object(projectTargetFields),
  z.object(workingCopyTargetFields),
  z.object(instructionTargetFields),
]);
export type FileTarget = z.infer<typeof fileTargetSchema>;

// 조회 때 계산하는 마지막 관측. conflict는 요청 비교 실패라 상태에 없다.
export const FILE_STATUS_STATES = [
  "not_tracked",
  "tracked",
  "version_pending",
  "validation_failed",
  "source_missing",
  "unverified",
] as const;
export const fileStatusStateSchema = z.enum(FILE_STATUS_STATES);
const fileStatusFields = {
  state: fileStatusStateSchema,
  target: fileTargetOutputSchema,
  observed_at: atSchema,
  observed_hash: sha256Schema.nullable(),
  compared_version: versionIdSchema.nullable(),
  project_revision: revisionSchema.nullable(),
  details: z.string().nullable(),
};
export const fileStatusSchema = z.object(fileStatusFields);
export type FileStatus = z.infer<typeof fileStatusSchema>;

// version 확정도 함께 요청할 때의 준비 입력. 결과 PreparedVersion은 documents/versions다.
const versionRequestFields = {
  document: documentIdSchema,
  base_version: versionIdSchema.nullable(),
  idempotency_key: idempotencyKeySchema,
};
export const fileVersionRequestSchema = z.strictObject(versionRequestFields);
export const fileVersionRequestOutputSchema = z.object(versionRequestFields);

// 원문은 JSON에 싣지 않고 신뢰한 blob 준비 참조로 받는다(document file 입력과 같다).
export const fileWriteRequestSchema = z.strictObject({
  request_key: idempotencyKeySchema,
  target: fileTargetSchema,
  base_hash: sha256Schema.nullable(),
  content: documentFileInputSchema.shape.content,
  version_request: fileVersionRequestSchema.optional(),
});
export type FileWriteRequest = z.infer<typeof fileWriteRequestSchema>;

export const FILE_OPERATION_OUTCOMES = [
  "written",
  "renamed",
  "deleted",
  "unverified",
] as const;
export const FILE_RECORDING_STATES = ["recorded", "unverified"] as const;
export const FILE_VERSION_RESULTS = [
  "not_requested",
  "preparing",
  "validation_failed",
  "conflict",
  "confirmed",
] as const;

const fileResultFields = {
  request_key: idempotencyKeySchema,
  operation: z.enum(["write", "rename", "delete"]),
  target: fileTargetOutputSchema,
  outcome: z.enum(FILE_OPERATION_OUTCOMES),
  before_path: absolutePathSchema.nullable(),
  after_path: absolutePathSchema.nullable(),
  before_hash: sha256Schema.nullable(),
  written_hash: sha256Schema.nullable(),
  observed_hash: sha256Schema.nullable(),
  observed_at: atSchema.nullable(),
  changed_again: z.boolean().nullable(),
  recording: z.enum(FILE_RECORDING_STATES),
  event_seq: seqSchema.nullable(),
  version_result: z.enum(FILE_VERSION_RESULTS),
  save_result: saveResultSchema.optional(),
  // version_result가 conflict일 때의 새 기준(그 문서의 지금 최신 판). 사본은 남아 있고
  // 사람이 이 판과 비교해 다시 정한다. 최신 판을 읽지 못하면 없다.
  latest_version: versionIdSchema.optional(),
};

// 파일 결과와 version 결과, 기록 결과는 각각이다. 뒤 단계 실패가 파일 성공을 지우지 않는다.
export const fileOperationResultSchema = z.object(fileResultFields).refine(
  (value) => value.recording !== "recorded" || value.event_seq !== null,
  { message: "recorded result needs event_seq" },
).refine(
  (value) =>
    value.version_result !== "confirmed" || value.save_result !== undefined,
  { message: "confirmed version needs save_result" },
).refine(
  (value) =>
    value.latest_version === undefined || value.version_result === "conflict",
  { message: "latest_version only comes with a conflict" },
).refine(
  (value) =>
    value.observed_hash === null ||
    (value.observed_at !== null && value.changed_again !== null),
  { message: "observation needs a time and a changed_again flag" },
);
export type FileOperationResult = z.infer<typeof fileOperationResultSchema>;

// 감사 event payload. 본문은 없고 경로와 hash만 남긴다.
export const fileWrittenPayloadSchema = z.object({
  path: absolutePathSchema,
  before_hash: sha256Schema.nullable(),
  after_hash: sha256Schema,
});
export const fileRenamedPayloadSchema = z.object({
  before_path: absolutePathSchema,
  after_path: absolutePathSchema,
  before_hash: sha256Schema,
  after_hash: sha256Schema,
});
export const fileDeletedPayloadSchema = z.object({
  path: absolutePathSchema,
  before_hash: sha256Schema,
  after_hash: z.null(),
});
