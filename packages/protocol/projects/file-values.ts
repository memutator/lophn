import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { idempotencyKeySchema } from "../base/envelope.ts";
import { blobRefRegistrationSchema } from "../storage/blob.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  revisionSchema,
} from "./values.ts";

// exact 등록 참조의 해석과 권한은 instructions owner가 검증한다.
const instructionTargetSchema = z.string().min(1);

// 사람 파일 통로의 목표. 다른 가지의 field는 strict 가지가 거절한다.
const projectTargetFields = {
  kind: z.literal("project_file"),
  project: projectIdSchema,
  path: absolutePathSchema,
};
const instructionTargetFields = {
  kind: z.literal("instruction_file"),
  instruction_target: instructionTargetSchema,
  project: projectIdSchema.nullable(),
  path: absolutePathSchema,
};
export const fileTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject(projectTargetFields),
  z.strictObject(instructionTargetFields),
]);
export const fileTargetOutputSchema = z.discriminatedUnion("kind", [
  z.object(projectTargetFields),
  z.object(instructionTargetFields),
]);
export type FileTarget = z.infer<typeof fileTargetSchema>;

// 조회 때 계산하는 마지막 관측. conflict는 요청 비교 실패라 상태에 없다.
export const FILE_STATUS_STATES = [
  "not_tracked",
  "tracked",
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
  project_revision: revisionSchema.nullable(),
  details: z.string().nullable(),
};
export const fileStatusSchema = z.object(fileStatusFields);
export type FileStatus = z.infer<typeof fileStatusSchema>;

// 원문은 JSON에 싣지 않고 신뢰한 blob 준비 참조로 받는다.
export const fileWriteRequestSchema = z.strictObject({
  request_key: idempotencyKeySchema,
  target: fileTargetSchema,
  base_hash: sha256Schema.nullable(),
  content: blobRefRegistrationSchema.shape.source,
});
export type FileWriteRequest = z.infer<typeof fileWriteRequestSchema>;

export const FILE_OPERATION_OUTCOMES = [
  "written",
  "renamed",
  "deleted",
  "unverified",
] as const;
export const FILE_RECORDING_STATES = ["recorded", "unverified"] as const;

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
};

export const fileOperationResultSchema = z.object(fileResultFields).refine(
  (value) => value.recording !== "recorded" || value.event_seq !== null,
  { message: "recorded result needs event_seq" },
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
