import { z } from "zod";
import {
  defineCommand,
  defineDecision,
  defineEvent,
  defineFile,
  defineRead,
  defineWorker,
  idempotencyKeySchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  fileDeletedPayloadSchema,
  fileOperationResultSchema,
  fileRenamedPayloadSchema,
  fileStatusSchema,
  fileTargetOutputSchema,
  fileTargetSchema,
  fileWriteRequestSchema,
  fileWrittenPayloadSchema,
} from "./file-values.ts";
import {
  absolutePathSchema,
  documentIdSchema,
  projectIdSchema,
} from "./values.ts";

// files.*는 ledger transaction이 아니라 worker 파일 작업이다. record_result만 command다.
const userOnly = ["user"] as const;
const fileErrors = [
  "unauthorized",
  "forbidden",
  "invalid_input",
  "conflict",
  "unavailable",
] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const cursorFields = { cursor: z.string().min(1).optional() };

export const filesList = defineRead({
  resource: "files",
  method: "list",
  name: "files.list",
  input: z.strictObject({
    project: projectIdSchema.optional(),
    ...cursorFields,
  }),
  output: withReadCommon(z.object({
    targets: z.array(fileTargetOutputSchema),
  })),
  actors: userOnly,
  errors: readErrors,
});

export const filesRead = defineFile({
  resource: "files",
  method: "read",
  name: "files.read",
  input: z.strictObject({ target: fileTargetSchema }),
  // 실제 Content-Type·바이트 수는 host가 관측한 파일에서 정한다. 선언은 fallback이다.
  contentType: "application/octet-stream",
  actors: userOnly,
  errors: readErrors,
});

export const filesStatus = defineRead({
  resource: "files",
  method: "status",
  name: "files.status",
  input: z.strictObject({ target: fileTargetSchema }),
  output: withReadCommon(z.object({ status: fileStatusSchema })),
  actors: userOnly,
  errors: readErrors,
});

// shell 편집 연결의 현재 변화 힌트. 원본 접근은 user만이고 event를 만들지 않는다.
export const filesWatch = defineWorker({
  resource: "files",
  method: "watch",
  name: "files.watch",
  input: z.strictObject({ target: fileTargetSchema, ...cursorFields }),
  output: withReadCommon(z.object({ status: fileStatusSchema })),
  actors: userOnly,
  errors: readErrors,
});

export const filesWrite = defineWorker({
  resource: "files",
  method: "write",
  name: "files.write",
  input: fileWriteRequestSchema,
  output: fileOperationResultSchema,
  actors: userOnly,
  errors: fileErrors,
});

export const filesRename = defineWorker({
  resource: "files",
  method: "rename",
  name: "files.rename",
  input: z.strictObject({
    request_key: idempotencyKeySchema,
    target: fileTargetSchema,
    path: absolutePathSchema,
    base_hash: sha256Schema,
  }),
  output: fileOperationResultSchema,
  actors: userOnly,
  errors: fileErrors,
});

// 사람 결정은 T13 owner_decision이다. 표시는 같은 목표의 files.status를 읽는다.
export const FILE_DELETE_DECISION = defineDecision("delete_file");

export const filesDelete = defineWorker({
  resource: "files",
  method: "delete",
  name: "files.delete",
  input: z.strictObject({
    request_key: idempotencyKeySchema,
    target: fileTargetSchema,
    base_hash: sha256Schema,
    // 파일을 지운 뒤(이미 없으면 그대로) 그 문서의 원본 연결을 풀고 자리를 되돌린다.
    // 확인 handle의 묶음은 그대로다(request_key, target, base_hash).
    unlink: z.strictObject({ document: documentIdSchema }).optional(),
  }),
  output: fileOperationResultSchema,
  actors: userOnly,
  errors: fileErrors,
  confirmation: "required",
  binding: ["request_key", "target", "base_hash"],
  display_read: "/v1/files/status",
});

// 성공한 파일 작업만 기록한다. actor는 machine이고 원래 user 요청 근거는 host가 결합한다.
export const fileRecordResult = defineCommand({
  resource: "files",
  method: "record_result",
  name: "file.record_result",
  input: fileOperationResultSchema,
  output: fileOperationResultSchema,
  actors: ["machine"],
  errors: ["invalid_input", "conflict", "forbidden"],
});

// subject는 목표의 prj, working copy의 doc, 전역 지침이면 확인된 doc다.
export const fileEventSubjectSchema = z.union([
  projectIdSchema,
  documentIdSchema,
]);

export const fileWritten = defineEvent("FileWritten", {
  subject: fileEventSubjectSchema,
  payload: fileWrittenPayloadSchema,
});
export const fileRenamed = defineEvent("FileRenamed", {
  subject: fileEventSubjectSchema,
  payload: fileRenamedPayloadSchema,
});
export const fileDeleted = defineEvent("FileDeleted", {
  subject: fileEventSubjectSchema,
  payload: fileDeletedPayloadSchema,
});

export const FILE_ROUTES = [
  filesList,
  filesRead,
  filesStatus,
  filesWatch,
  filesWrite,
  filesRename,
  filesDelete,
  fileRecordResult,
] as const;

export const FILE_EVENTS = [fileWritten, fileRenamed, fileDeleted] as const;
