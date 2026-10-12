import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { idempotencyKeySchema } from "../base/envelope.ts";
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

// 문서를 이 새 파일에 둔다. 쓸 바이트는 content의 `existing` 원본
// 참조(그 판의 유일한 파일)다. core가 파일을 쓴 뒤 원본 연결·추적 규칙·자리를 각각 확정한다.
const placeIntentFields = {
  document: documentIdSchema,
  // 둘 문서의 최신 판. 그 사이 새 판이 생겼으면 conflict다.
  version: versionIdSchema,
};
export const filePlaceIntentSchema = z.strictObject(placeIntentFields);
export const filePlaceIntentOutputSchema = z.object(placeIntentFields);

// 원문은 JSON에 싣지 않고 신뢰한 blob 준비 참조로 받는다(document file 입력과 같다).
export const fileWriteRequestSchema = z.strictObject({
  request_key: idempotencyKeySchema,
  target: fileTargetSchema,
  base_hash: sha256Schema.nullable(),
  content: documentFileInputSchema.shape.content,
  version_request: fileVersionRequestSchema.optional(),
  place: filePlaceIntentSchema.optional(),
}).refine(
  (value) =>
    value.place === undefined ||
    (value.target.kind === "project_file" && value.base_hash === null &&
      value.version_request === undefined &&
      value.content.kind === "existing"),
  {
    message:
      "placing needs a new project file, no version request and an existing version file",
  },
);
export type FileWriteRequest = z.infer<typeof fileWriteRequestSchema>;

// 파일 작업 뒤 이어지는 연결 확정 단계 하나의 결과. 앞 단계가 실패하면 뒤 단계는
// not_attempted고, 이미 끝난 파일 작업은 되돌리지 않는다.
export const fileStepSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("done") }),
  z.object({ state: z.literal("skipped"), reason: z.string().min(1) }),
  z.object({
    state: z.literal("failed"),
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
    }),
  }),
  z.object({ state: z.literal("not_attempted") }),
]);
export type FileStep = z.infer<typeof fileStepSchema>;

// 두기: 원본 연결, 추적 규칙, 자리 순서로 각각 확정한다.
export const filePlacementSchema = z.object({
  source: fileStepSchema,
  tracking: fileStepSchema,
  move: fileStepSchema,
});
// 빼기: 원본 연결 해제, 자리 되돌리기 순서로 각각 확정한다.
export const fileUnlinkingSchema = z.object({
  source: fileStepSchema,
  move: fileStepSchema,
});

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
  // 두기·빼기 요청의 연결 확정 단계별 결과. 파일 결과와 따로 본다.
  placement: filePlacementSchema.optional(),
  unlinking: fileUnlinkingSchema.optional(),
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
