import { z } from "zod";
import { readCursorSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { appIdSchema, relativePathSchema } from "../projects/mod.ts";
import { compactFailureReasonSchema } from "./sessions.ts";
import {
  classOk,
  type ItemShape,
  previewItemFields,
  previewItemOk,
  rewindChoiceSchema,
  rewindHeaderOutput,
  rewindOutcomeSchema,
} from "./session-rewinds.ts";

// session rewind의 나머지 contract다. Rewind와 PreviewRewind는
// `session-rewinds.ts`에 있다. 여기에는 file tool의 쓰기 기록, 설치 정정, 앱 rewind 요청 기록,
// "Summarize from here" 요청, 읽기(checkpoint 목록, rewind 목록)와 event가 있다. 단위는 session
// 안 turn을 시작한 입력(Checkpoint)이고, 파일은 RewindFile pre-image로 되돌린다. 앱 data는 되돌리지
// 않고 사람이 고른 앱만 앱 rewind에 요청한다. 숨긴 구간은 Message를 바꾸지 않고 rewind 기록에서 읽는다.

// 한도다. 넘는 쓰기는 막지 않고 그 checkpoint를 "파일 복원 불가"로 낮춘다.
export const REWIND_MAX_CHECKPOINTS = 100;
export const REWIND_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const REWIND_MAX_SESSION_BYTES = 200 * 1024 * 1024;

const CHECKPOINT_FILES_REASONS = [
  "limit_total",
  "limit_file",
  "limit_count",
  // 저장소나 기록이 실패해 pre-image를 두지 못했다(한도와 다른 이유).
  "record_failed",
] as const;
const checkpointFilesReasonSchema = z.enum(CHECKPOINT_FILES_REASONS);

const revertResultSchema = z.enum([
  "restored",
  "skipped",
  "remained",
  "failure",
  "uncertain",
  "unchanged",
]);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// agent와 앱에는 pre-image의 내용도 경로도 주지 않는다. 읽는 쪽은 사람과 machine이다.
const readActors = ["user", "machine"] as const;

// Checkpoint는 turn을 시작한 입력 메시지(`msg`) 하나다. 별도 ID가 없다.
const checkpointFields = {
  message: idSchema("msg"),
  session: idSchema("ses"),
  files_restorable: z.boolean(),
  files_reason: checkpointFilesReasonSchema.nullable(),
};
function filesCoupled(
  value: { files_restorable: boolean; files_reason: string | null },
): boolean {
  return value.files_restorable === (value.files_reason === null);
}
const filesCoupledMessage = {
  message: "files_reason is set exactly when files are not restorable",
};
export const checkpointSchema = z.object(checkpointFields).refine(
  filesCoupled,
  filesCoupledMessage,
);
export type Checkpoint = z.infer<typeof checkpointSchema>;

// FileState: 파일이 있었나와 내용 hash. blob은 session 저장소 항목 key(내용 sha256)이고
// `before`에서 exists이고 한도 안일 때만 있다. null이면 pre-image를 못 둔 것이다(unrecorded).
function fileStateOk(
  value: { exists: boolean; sha256: string | null; blob: string | null },
): boolean {
  return value.exists
    ? value.sha256 !== null &&
      (value.blob === null || value.blob === value.sha256)
    : value.sha256 === null && value.blob === null;
}
const fileStateMessage = { message: "file state fields disagree with exists" };
const fileStateSchema = z.object({
  exists: z.boolean(),
  sha256: sha256Schema.nullable(),
  blob: sha256Schema.nullable(),
}).refine(fileStateOk, fileStateMessage);
const fileStateInputSchema = z.strictObject({
  exists: z.boolean(),
  sha256: sha256Schema.nullable(),
  blob: sha256Schema.nullable(),
}).refine(fileStateOk, fileStateMessage);
export type FileState = z.infer<typeof fileStateSchema>;

function afterStateOk(
  value: { exists: boolean; sha256: string | null },
): boolean {
  return value.exists === (value.sha256 !== null);
}
const afterFileStateInputSchema = z.strictObject({
  exists: z.boolean(),
  sha256: sha256Schema.nullable(),
}).refine(afterStateOk, {
  message: "after state needs a hash exactly when the file exists",
});

// file tool에 열린 허용 폴더(절대 경로). 쓴 파일은 이 폴더 안의 상대 경로 `path`로 가리킨다.
const rootSchema = z.string().min(1).max(4096);

type ResultShape = ItemShape & {
  result: z.infer<typeof revertResultSchema>;
};

// plan별로 허용하는 result 조합과 그 이유. result가 restored가 아니면 이유가 있다.
//   restore: restored(이유 없음) / skipped(edited_outside: 확정 뒤 설치가 hash 불일치로 건너뜀.
//     AmendRevertInstall)
//   skip: skipped, 또는 이미 되돌린 파일(already_reverted)이면 unchanged
//   remain: remained
function itemResultOk(value: ResultShape): boolean {
  switch (value.plan) {
    case "restore":
      return classOk(value) &&
        (value.result === "restored"
          ? value.reason === null
          : value.result === "skipped" && value.reason === "edited_outside");
    case "skip":
      return (value.result === "skipped" ||
        (value.result === "unchanged" &&
          value.reason === "already_reverted")) &&
        previewItemOk(value);
    case "remain":
      return value.result === "remained" && previewItemOk(value);
  }
}

const revertItemSchema = z.object({
  ...previewItemFields,
  result: revertResultSchema,
}).refine(itemResultOk, {
  message: "revert item result disagrees with its plan or reason",
});
export type RevertItem = z.infer<typeof revertItemSchema>;

// 결과 event는 항목 목록을 싣지 않고 결과별 수만 싣는다. 목록은 rewind/list가 읽는다.
const revertResultCountsSchema = z.strictObject({
  restored: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  remained: z.number().int().nonnegative(),
  failure: z.number().int().nonnegative(),
  uncertain: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type RevertResultCounts = z.infer<typeof revertResultCountsSchema>;

// 앱 rewind 요청의 결과다. 요청은 앱 쪽 순서(drain, 충돌 시 통째로 취소)를 따르므로 session rewind는
// 이 결과를 기다리지 않는다. accepted는 앱 rewind가 접수되어 아직 끝나지 않았고, applied는 끝났고,
// rejected는 앱 rewind가 거절하거나 취소했다.
const REWIND_APP_RESULTS = ["accepted", "applied", "rejected"] as const;
const rewindAppResultSchema = z.enum(REWIND_APP_RESULTS);

const rewindAppRequestSchema = z.object({
  app: appIdSchema,
  // 이 session의 첫 write invocation. 앱 rewind는 이 invocation 직전으로 되돌린다.
  from_invocation: idSchema("inv"),
  result: rewindAppResultSchema,
  // 거절 이유(오류 code). 거절이 아니면 null이다.
  reason: z.string().nullable(),
});
export type RewindAppRequest = z.infer<typeof rewindAppRequestSchema>;

// Revert: rewind 한 번의 시도다(결과 기록).
const revertRecordSchema = z.object({
  id: idSchema("rwd"),
  session: idSchema("ses"),
  kind: z.literal("rewind"),
  choice: rewindChoiceSchema,
  checkpoint: idSchema("msg"),
  boundary_seq: seqSchema,
  summary_call: idSchema("mcl").nullable(),
  outcome: rewindOutcomeSchema,
  items: z.array(revertItemSchema),
  apps: z.array(rewindAppRequestSchema),
  preview_hash: sha256Schema,
  result_seq: seqSchema.nullable(),
}).refine((value) => {
  if ((value.choice === "summarize") !== (value.summary_call !== null)) {
    return false;
  }
  if ((value.outcome === "applying") !== (value.result_seq === null)) {
    return false;
  }
  const ordinals = new Set(value.items.map((item) => item.ordinal));
  if (ordinals.size !== value.items.length) return false;
  // blocked는 아무것도 하지 않아 항목이 없다.
  return value.outcome !== "blocked" || value.items.length === 0;
}, { message: "revert record fields disagree with its outcome" });
export type RevertRecord = z.infer<typeof revertRecordSchema>;

// file tool이 쓰기 직전에 pre-image를 남기는 기록이다. core의 `StageRewindFile`·`RecordRewindWrite`가
// 허용 폴더를 확인한 뒤 이 command를 machine 자격으로 낸다. agent는 이 command를 직접 부르지 못한다.
const recordRewindFileInputSchema = z.strictObject({
  session: idSchema("ses"),
  turn: idSchema("trn"),
  tool_call: idSchema("tcl"),
  root: rootSchema,
  path: relativePathSchema,
  before: fileStateInputSchema,
  // before 내용의 크기. 파일이 없었으면 null.
  before_size_bytes: z.number().int().nonnegative().nullable(),
  after: afterFileStateInputSchema,
  moved_from: relativePathSchema.nullable(),
}).refine(
  (value) => value.before.exists === (value.before_size_bytes !== null),
  { message: "before_size_bytes is set exactly when the file existed" },
);

const recordRewindFileOutputSchema = z.object({
  tool_call: idSchema("tcl"),
  path: relativePathSchema,
  checkpoint: idSchema("msg"),
  // 한도로 pre-image를 두지 못해 blob 없이 남겼으면 false다. 쓰기는 막지 않는다.
  recorded: z.boolean(),
  files_restorable: z.boolean(),
  files_reason: checkpointFilesReasonSchema.nullable(),
  replayed: z.boolean(),
}).refine(
  (value) => filesCoupled(value) && (value.recorded || !value.files_restorable),
  { message: "an unrecorded pre-image lowers the checkpoint" },
);

export const recordRewindFile = defineCommand({
  resource: "rewind",
  method: "record-file",
  name: "RecordRewindFile",
  input: recordRewindFileInputSchema,
  output: recordRewindFileOutputSchema,
  actors: ["machine"],
  errors: ["invalid_input", "conflict", "unavailable"],
});

// 쓰기 직전에 agent runtime이 core에 청한다. core가 그 파일의 지금 내용을 읽어 session 저장소에 두고
// (한도 안일 때) before 상태를 돌려준다. 내용은 HTTP로 오가지 않는다. root는 session의 place가 file
// tool에 연 폴더여야 하고, session·turn은 agent 자격의 것과 같아야 한다. 이름 변경이면 옛 경로를 준다.
export const stageRewindFile = defineMemory({
  resource: "rewind",
  method: "stage-file",
  name: "StageRewindFile",
  input: z.strictObject({
    session: idSchema("ses"),
    turn: idSchema("trn"),
    root: rootSchema,
    path: relativePathSchema,
  }),
  output: z.object({
    before: fileStateSchema,
    before_size_bytes: z.number().int().nonnegative().nullable(),
  }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 쓴 직후 agent runtime이 낸다. core가 같은 확인을 하고 RecordRewindFile을 낸다.
export const recordRewindWrite = defineMemory({
  resource: "rewind",
  method: "record-write",
  name: "RecordRewindWrite",
  input: recordRewindFileInputSchema,
  output: recordRewindFileOutputSchema,
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "conflict", "unavailable"],
});

// 설치가 쓰기 직전 hash 재비교에서 건너뛴 경로를 결과에 반영한다. outcome은 applied 그대로이고, 그 항목은
// plan=restore, result=skipped, reason=edited_outside가 된다. 그 경로의 기록은 되돌려짐 표시(reverted_by)를
// 풀고, 항목마다 한 번만 고친다.
const amendRevertInstallInputSchema = z.strictObject({
  revert: idSchema("rwd"),
  paths: z.array(relativePathSchema).min(1).refine(
    (paths) => new Set(paths).size === paths.length,
    { message: "duplicate path" },
  ),
});

export const amendRevertInstall = defineCommand({
  resource: "rewind",
  method: "amend-install",
  name: "AmendRevertInstall",
  input: amendRevertInstallInputSchema,
  output: rewindHeaderOutput,
  actors: ["machine"],
  errors: ["conflict", "forbidden", "not_found"],
});

// 사람이 고른 앱마다 앱 rewind를 요청한 결과를 rewind 기록에 남긴다. 앱마다 한 번 남기고, 접수(accepted)였던
// 것이 끝나면(applied, rejected) 다시 한 번 고친다.
export const recordRewindApps = defineCommand({
  resource: "rewind",
  method: "record-apps",
  name: "RecordRewindApps",
  input: z.strictObject({
    revert: idSchema("rwd"),
    apps: z.array(rewindAppRequestSchema).min(1),
  }),
  output: z.object({ revert: idSchema("rwd"), recorded: z.number().int() }),
  actors: ["machine"],
  errors: ["conflict", "forbidden", "not_found"],
});

// "Summarize from here"의 요약 요청이다. Compact와 같은 모양이다: 사람이 요청하면(RequestRewindSummary) runtime이
// 요약 call(Model for summaries)을 하고(Take·FinishRewindSummary) 사람이 끝난 call로 Rewind(choice=summarize)를
// 확인한다. 요청은 ledger 기록이 아니라 core의 작업 메모리다: 요약 call 자체는 model call 기록에 남고, 접히는 것은
// Rewind가 확정할 때뿐이다. 요청이 사라지면(core 재시작, 기한) 사람이 다시 요청한다.
const summaryRequestIdSchema = z.string().min(1).max(64);

const rewindSummaryStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("waiting") }),
  z.strictObject({
    state: z.literal("summarized"),
    // 완전 성공한 요약 call. Rewind의 summary_call로 넘긴다.
    summary_call: idSchema("mcl"),
  }),
  z.strictObject({
    state: z.literal("failed"),
    reason: compactFailureReasonSchema,
  }),
]);
export type RewindSummaryState = z.infer<typeof rewindSummaryStateSchema>;

const summaryErrors = [
  "unauthorized",
  "forbidden",
  "invalid_input",
  "not_found",
  "conflict",
  "unavailable",
] as const;

export const requestRewindSummary = defineMemory({
  resource: "rewind",
  method: "summary-request",
  name: "RequestRewindSummary",
  input: z.strictObject({
    session: idSchema("ses"),
    // 요약을 시작할 입력 메시지(checkpoint). 숨긴 구간 안이거나 checkpoint가 아니면 거절한다.
    checkpoint: idSchema("msg"),
  }),
  output: z.object({ request: summaryRequestIdSchema }),
  actors: ["user"],
  errors: [...summaryErrors],
});

export const readRewindSummary = defineMemory({
  resource: "rewind",
  method: "summary-state",
  name: "ReadRewindSummary",
  input: z.strictObject({ request: summaryRequestIdSchema }),
  output: rewindSummaryStateSchema,
  actors: ["user"],
  errors: [...summaryErrors],
});

export const takeRewindSummaryRequest = defineMemory({
  resource: "rewind",
  method: "summary-take",
  name: "TakeRewindSummaryRequest",
  input: z.strictObject({}),
  // 요약할 요청이 없으면 null이다. 가져간 요청은 다시 나오지 않는다.
  output: z.object({
    request: z.object({
      id: summaryRequestIdSchema,
      session: idSchema("ses"),
      // 요약을 시작할 메시지의 생성 seq다.
      from_seq: seqSchema,
    }).nullable(),
  }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

export const finishRewindSummary = defineMemory({
  resource: "rewind",
  method: "summary-done",
  name: "FinishRewindSummary",
  input: z.strictObject({
    id: summaryRequestIdSchema,
    result: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("summarized"),
        summary_call: idSchema("mcl"),
      }),
      z.strictObject({
        kind: z.literal("failed"),
        reason: compactFailureReasonSchema,
      }),
    ]),
  }),
  // 모르거나 기한이 지난 요청이면 accepted가 false다.
  output: z.object({ accepted: z.boolean() }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

// rewind menu가 session의 checkpoint를 고르는 데 쓴다. 숨긴 구간 안의 checkpoint는 고를 수
// 없으므로 hidden으로 알린다. created_seq는 메시지의 생성 seq다.
const checkpointEntrySchema = z.object({
  ...checkpointFields,
  created_seq: seqSchema,
  hidden: z.boolean(),
}).refine(filesCoupled, filesCoupledMessage);

export const rewindCheckpoints = defineRead({
  resource: "rewind",
  method: "checkpoints",
  name: "ListRewindCheckpoints",
  input: z.strictObject({
    session: idSchema("ses"),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(z.object({
    checkpoints: z.array(checkpointEntrySchema),
  })),
  actors: readActors,
  errors: [...readErrors],
});

const rewindListInputSchema = z.strictObject({
  session: idSchema("ses"),
  cursor: readCursorSchema.optional(),
});

export const rewindList = defineRead({
  resource: "rewind",
  method: "list",
  name: "ListReverts",
  input: rewindListInputSchema,
  output: withReadCommon(z.object({
    reverts: z.array(revertRecordSchema),
    // 숨김 구간의 시작 seq(가장 앞선 boundary_seq). 숨긴 구간이 없으면 null이다. 각 숨김 구간은 rewind의
    // boundary_seq부터 result_seq까지다(그 뒤에 접수한 메시지는 숨기지 않는다).
    hidden_from_seq: seqSchema.nullable(),
  })),
  actors: readActors,
  errors: [...readErrors],
});

const revertSubject = idSchema("rwd");

export const revertApplied = defineEvent("RevertApplied", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    choice: rewindChoiceSchema,
    // 건너뜀·남는 영향이 있었나.
    partial: z.boolean(),
    results: revertResultCountsSchema,
    boundary_seq: seqSchema,
    // 사람이 고른 앱 수.
    apps: z.number().int().nonnegative(),
  }),
});

export const revertBlocked = defineEvent("RevertBlocked", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    results: revertResultCountsSchema,
  }),
});

export const revertAmended = defineEvent("RevertAmended", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    // 설치가 건너뛰어 skipped로 고친 파일 수와 고친 뒤 결과별 항목 수.
    amended: z.number().int().positive(),
    results: revertResultCountsSchema,
  }),
});

export const REVERT_ROUTES = [
  recordRewindFile,
  stageRewindFile,
  recordRewindWrite,
  amendRevertInstall,
  recordRewindApps,
  requestRewindSummary,
  readRewindSummary,
  takeRewindSummaryRequest,
  finishRewindSummary,
  rewindCheckpoints,
  rewindList,
] as const;

