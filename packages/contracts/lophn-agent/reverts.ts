import { z } from "zod";
import {
  atSchema,
  defineCommand,
  defineEvent,
  defineMemory,
  defineRead,
  idSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import { defineDecision } from "../platform/confirmation-handle.ts";
import { relativePathSchema } from "../documents/mod.ts";
import { readCursorSchema } from "./run-values.ts";
import { compactFailureReasonSchema } from "./sessions.ts";

// session 안 rewind와 편집 카드 Undo의 contract다(lophn-agent/revert). 단위는 session 안 사람
// 메시지(Checkpoint)이고, 문서 파일은 RewindFile pre-image로, 앱 data는 앱이 선언한 revert
// command로 되돌린다. 숨긴 구간은 Message를 바꾸지 않고 Revert 기록에서 읽는다.

// 한도(요구 R14). 넘는 쓰기는 막지 않고 그 checkpoint를 "파일 복원 불가"로 낮춘다.
export const REWIND_MAX_CHECKPOINTS = 100;
export const REWIND_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const REWIND_MAX_SESSION_BYTES = 200 * 1024 * 1024;

export const REVERT_KINDS = ["rewind", "undo"] as const;
export const revertKindSchema = z.enum(REVERT_KINDS);

// "Restore messages and documents" / "Restore messages only" / "Summarize from here".
export const REWIND_CHOICES = [
  "restore_all",
  "messages_only",
  "summarize",
] as const;
export const rewindChoiceSchema = z.enum(REWIND_CHOICES);
export type RewindChoice = z.infer<typeof rewindChoiceSchema>;

export const revertOutcomeSchema = z.enum([
  "applying",
  "applied",
  "partial",
  "uncertain",
  "blocked",
]);

export const REVERT_REDO_STATES = [
  "none",
  "available",
  "done",
  "closed",
] as const;
export const revertRedoSchema = z.enum(REVERT_REDO_STATES);

export const CHECKPOINT_FILES_REASONS = [
  "limit_total",
  "limit_file",
  "limit_count",
  // 저장소나 기록이 실패해 pre-image를 두지 못했다(한도와 다른 이유).
  "record_failed",
] as const;
export const checkpointFilesReasonSchema = z.enum(CHECKPOINT_FILES_REASONS);

// 이유는 글이 아니라 고정 코드다. 화면 문장은 이 코드로 wording을 고른다(문서 표 17개).
export const REVERT_REASON_CODES = [
  "edited_outside",
  "chain_broken",
  "no_pre_image",
  "link_path",
  "rename_blocked",
  "created_edited",
  "no_receipt",
  "no_revert_command",
  "app_revision_changed",
  "external_effect",
  "already_reverted",
  "answered_fact",
  "app_failed",
  "app_uncertain",
  "app_not_started",
  "app_not_settled",
  "later_edit",
] as const;
export const revertReasonSchema = z.enum(REVERT_REASON_CODES);
export type RevertReason = z.infer<typeof revertReasonSchema>;

const FILE_REASONS: readonly RevertReason[] = [
  "edited_outside",
  "chain_broken",
  "no_pre_image",
  "link_path",
  "rename_blocked",
  "created_edited",
  "already_reverted",
  "later_edit",
  "app_not_settled",
];
const APP_REASONS: readonly RevertReason[] = [
  "no_receipt",
  "no_revert_command",
  "app_revision_changed",
  "external_effect",
  "app_failed",
  "app_uncertain",
  "app_not_started",
];
const FACT_REASONS: readonly RevertReason[] = [
  "external_effect",
  "answered_fact",
];

export const REVERT_ITEM_CLASSES = ["file", "app", "fact"] as const;
export const revertItemClassSchema = z.enum(REVERT_ITEM_CLASSES);
export const revertPlanSchema = z.enum(["restore", "skip", "remain"]);
export const revertResultSchema = z.enum([
  "restored",
  "skipped",
  "remained",
  "failure",
  "uncertain",
  "unchanged",
]);
// 앱 단계 하나가 남길 수 있는 결과다(CheckpointRevert).
export const appStepResultSchema = z.enum([
  "restored",
  "failure",
  "uncertain",
  "unchanged",
]);

const commandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// agent와 앱에는 pre-image의 내용도 경로도 주지 않는다. 읽는 쪽은 사람과 machine이다.
const readActors = ["user", "machine"] as const;

// Checkpoint는 사람 메시지(`msg`) 하나다. 별도 ID가 없다.
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
export const fileStateSchema = z.object({
  exists: z.boolean(),
  sha256: sha256Schema.nullable(),
  blob: sha256Schema.nullable(),
}).refine(fileStateOk, fileStateMessage);
export const fileStateInputSchema = z.strictObject({
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
const afterStateMessage = {
  message: "after state needs a hash exactly when the file exists",
};
export const afterFileStateSchema = z.object({
  exists: z.boolean(),
  sha256: sha256Schema.nullable(),
}).refine(afterStateOk, afterStateMessage);
export const afterFileStateInputSchema = z.strictObject({
  exists: z.boolean(),
  sha256: sha256Schema.nullable(),
}).refine(afterStateOk, afterStateMessage);

// RewindFile: 문서 tool이 쓰기 직전에 tool call마다 한 줄 남기는 기록이다.
export const rewindFileSchema = z.object({
  tool_call: idSchema("tcl"),
  path: relativePathSchema,
  checkpoint: idSchema("msg"),
  seq: seqSchema,
  before: fileStateSchema,
  after: afterFileStateSchema,
  moved_from: relativePathSchema.nullable(),
  reverted_by: idSchema("rvt").nullable(),
});
export type RewindFile = z.infer<typeof rewindFileSchema>;

// AppRevertBinding: 앱 write 하나를 되돌릴 근거다. receipt 원문은 UI·model에 주지 않는다.
export const appRevertBindingSchema = z.object({
  app: idSchema("app"),
  release: idSchema("rel"),
  command: z.string().min(1),
  tool_call: idSchema("tcl"),
  invocation: idSchema("inv"),
  receipt: z.string().min(1),
  expected_revision: z.string().min(1),
  revert_command: z.string().min(1),
  step_key: z.string().min(1),
  revert_invocation: idSchema("inv").nullable(),
});
export type AppRevertBinding = z.infer<typeof appRevertBindingSchema>;

// RevertItem 중 사전 검사가 정하는 부분(RevertPreview의 restore·skip·remain 항목).
const previewItemFields = {
  ordinal: z.number().int().nonnegative(),
  class: revertItemClassSchema,
  // file은 경로, app은 원래 ToolCall ID, fact는 사실 종류다.
  target: z.string().min(1),
  source: z.array(idSchema("tcl")),
  plan: revertPlanSchema,
  reason: revertReasonSchema.nullable(),
  app_revert: appRevertBindingSchema.nullable(),
};

type ItemShape = {
  class: "file" | "app" | "fact";
  plan: "restore" | "skip" | "remain";
  reason: RevertReason | null;
  app_revert: unknown | null;
};

// 이유 코드는 대상 종류에 맞는 것만 쓰고, 남는 사실은 되돌리지 않으며, 문서 파일은 복원하거나
// 건너뛸 뿐 남는 영향이 아니다. 앱 복원 근거는 앱 항목에만 있고 복원할 앱 항목에는 반드시 있다.
function classOk(value: ItemShape): boolean {
  if (value.reason !== null) {
    const allowed = value.class === "file"
      ? FILE_REASONS
      : value.class === "app"
      ? APP_REASONS
      : FACT_REASONS;
    if (!allowed.includes(value.reason)) return false;
  }
  if (value.class === "fact" && value.plan !== "remain") return false;
  if (value.class === "file" && value.plan === "remain") return false;
  if (value.class !== "app") return value.app_revert === null;
  return value.plan !== "restore" || value.app_revert !== null;
}

function previewItemOk(value: ItemShape): boolean {
  // 건너뜀·남는 영향은 이유가 필수다. 복원 계획은 이유가 없다.
  return (value.plan === "restore") === (value.reason === null) &&
    classOk(value);
}

export const previewItemSchema = z.object(previewItemFields).refine(
  previewItemOk,
  { message: "preview item fields disagree with its class or plan" },
);
export type PreviewItem = z.infer<typeof previewItemSchema>;

type ResultShape = ItemShape & {
  result: z.infer<typeof revertResultSchema>;
};

// plan별로 허용하는 result 조합과 그 이유(문서 표). result가 restored가 아니면 이유가 있다.
//   restore: restored(이유 없음) / failure(app_failed) / uncertain(app_uncertain) /
//     unchanged(앱: app_not_started, 파일: app_not_settled; applying 중에는 아직 시작 전이라 이유 없음) /
//     skipped(파일, edited_outside: 확정 뒤 설치가 hash 불일치로 건너뜀. AmendRevertInstall)
//   skip: skipped, 또는 이미 Undo한 파일(already_reverted)이면 unchanged
//   remain: remained
function restoreResultOk(value: ResultShape): boolean {
  if (!classOk(value)) return false;
  const app = value.class === "app";
  switch (value.result) {
    case "restored":
      return value.reason === null;
    case "failure":
      return app && value.reason === "app_failed";
    case "uncertain":
      return app && value.reason === "app_uncertain";
    case "unchanged":
      return value.reason === null ||
        value.reason === (app ? "app_not_started" : "app_not_settled");
    case "skipped":
      return !app && value.reason === "edited_outside";
    case "remained":
      return false;
  }
}

function itemResultOk(value: ResultShape): boolean {
  switch (value.plan) {
    case "restore":
      return restoreResultOk(value);
    case "skip":
      return (value.result === "skipped" ||
        (value.result === "unchanged" &&
          value.reason === "already_reverted")) &&
        previewItemOk(value);
    case "remain":
      return value.result === "remained" && previewItemOk(value);
  }
}

export const revertItemSchema = z.object({
  ...previewItemFields,
  result: revertResultSchema,
}).refine(itemResultOk, {
  message: "revert item result disagrees with its plan or reason",
});
export type RevertItem = z.infer<typeof revertItemSchema>;

// 결과 event는 항목 목록을 싣지 않고 결과별 수만 싣는다. 목록은 rewind/list가 읽는다.
export const revertResultCountsSchema = z.strictObject({
  restored: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  remained: z.number().int().nonnegative(),
  failure: z.number().int().nonnegative(),
  uncertain: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type RevertResultCounts = z.infer<typeof revertResultCountsSchema>;

function hasAppRestore(items: readonly PreviewItem[]): boolean {
  return items.some((item) => item.class === "app" && item.plan === "restore");
}

// Revert: rewind 한 번 또는 Undo 한 번의 시도다(결과 기록).
export const revertRecordSchema = z.object({
  id: idSchema("rvt"),
  session: idSchema("ses"),
  kind: revertKindSchema,
  choice: rewindChoiceSchema.nullable(),
  checkpoint: idSchema("msg").nullable(),
  tool_call: idSchema("tcl").nullable(),
  boundary_seq: seqSchema.nullable(),
  summary_call: idSchema("mcl").nullable(),
  outcome: revertOutcomeSchema,
  redo: revertRedoSchema,
  items: z.array(revertItemSchema),
  preview_hash: sha256Schema,
  result_seq: seqSchema.nullable(),
}).refine((value) => {
  const rewound = value.kind === "rewind";
  if (rewound) {
    if (
      value.choice === null || value.checkpoint === null ||
      value.boundary_seq === null || value.tool_call !== null
    ) return false;
  } else if (
    value.tool_call === null || value.choice !== null ||
    value.checkpoint !== null || value.boundary_seq !== null
  ) return false;
  if ((value.choice === "summarize") !== (value.summary_call !== null)) {
    return false;
  }
  if ((value.outcome === "applying") !== (value.result_seq === null)) {
    return false;
  }
  const ordinals = new Set(value.items.map((item) => item.ordinal));
  if (ordinals.size !== value.items.length) return false;
  // blocked는 아무것도 하지 않아 항목이 없다. applying이 아니면 시작 전 항목(unchanged)은 이유가 있다.
  if (value.outcome === "blocked" && value.items.length > 0) return false;
  if (
    value.outcome !== "applying" &&
    value.items.some((item) =>
      item.plan === "restore" && item.result === "unchanged" &&
      item.reason === null
    )
  ) return false;
  // redo는 앱 복원 단계가 없는 applied rewind(restore_all·messages_only)만 가진다.
  const redoable = rewound && value.choice !== "summarize" &&
    value.outcome === "applied" && !hasAppRestore(value.items);
  return redoable || value.redo === "none";
}, { message: "revert record fields disagree with its kind or outcome" });
export type RevertRecord = z.infer<typeof revertRecordSchema>;

// 사람이 요청한 파일 복원 준비. 파일 쓰기·hash 계산·복원 내용 준비는 transaction 밖에서
// core가 하고, command는 ledger 기록과 이 관측으로 판정을 다시 한다. 판정에 든 경로(복원할
// 경로, 건너뛰는 경로, 이름 변경의 옛 경로)마다 하나씩 싣는다. 준비가 없으면 그 파일은
// restored가 될 수 없다.
export const preparedFileSchema = z.strictObject({
  path: relativePathSchema,
  // 준비 때 본 파일의 지금 hash. 없으면 null.
  observed_sha256: sha256Schema.nullable(),
  // symlink이거나 hard link인 경로다(link_path).
  link: z.boolean(),
  // 복원할 내용(pre-image)을 session 저장소에서 읽을 수 있음을 확인했나.
  staged: z.boolean(),
  // 복원 직전 내용을 redo 근거로 session 저장소에 둔 key. restore_all rewind에만 있다.
  redo_ref: sha256Schema.nullable(),
});
export type PreparedFile = z.infer<typeof preparedFileSchema>;
const preparedFilesSchema = z.array(preparedFileSchema).refine(
  (files) => new Set(files.map((file) => file.path)).size === files.length,
  { message: "duplicate prepared path" },
);

const revertHeaderOutput = z.object({
  id: idSchema("rvt"),
  session: idSchema("ses"),
  kind: revertKindSchema,
  outcome: revertOutcomeSchema,
  redo: revertRedoSchema,
  result_seq: seqSchema.nullable(),
  // 같은 요청이 이미 접수되어 저장된 현재 결과를 돌려준 것이다(R8).
  replayed: z.boolean(),
}).refine(
  (value) => (value.outcome === "applying") === (value.result_seq === null),
  { message: "only an applying revert lacks a result event" },
);
export type RevertHeader = z.infer<typeof revertHeaderOutput>;

// 사람 결정은 적용 자체다. 표시는 rewind/preview를 읽는다. ledger는 확인 handle의 결정 이름으로
// command 이름(route.name)을 검사하므로 이 이름이 command 이름과 같아야 한다.
export const REWIND_DECISION = defineDecision("Rewind");

export const rewindInputSchema = z.strictObject({
  id: idSchema("rvt"),
  session: idSchema("ses"),
  checkpoint: idSchema("msg"),
  choice: rewindChoiceSchema,
  // 사람이 건너뜀·남는 영향 목록을 확인했다(R7). 목록이 있는데 false면 blocked 결과다.
  accept_remaining: z.boolean(),
  preview_hash: sha256Schema,
  // choice=summarize일 때만: 완전 성공한 요약 call. 요약이 실패하면 command를 내지 않는다.
  summary_call: idSchema("mcl").nullable(),
  // choice=restore_all일 때만 준비한 파일 복원.
  files: preparedFilesSchema,
}).refine(
  (value) =>
    (value.choice === "summarize") === (value.summary_call !== null) &&
    (value.choice === "restore_all" || value.files.length === 0),
  { message: "summary_call and files must match the chosen scope" },
);

export const rewindCompareSchema = z.strictObject({
  session_state: z.literal("open"),
  // 진행 중이거나 기다리는 run이 없다(R15). 먼저 멈춘 뒤에만 시작한다.
  active_run: z.null(),
  applying_revert: z.null(),
});

export const rewind = defineCommand({
  resource: "rewind",
  method: "apply",
  name: "Rewind",
  input: rewindInputSchema,
  output: revertHeaderOutput,
  compare: rewindCompareSchema,
  actors: ["user"],
  errors: [...commandErrors],
  confirmation: "required",
  binding: [
    "id",
    "session",
    "checkpoint",
    "choice",
    "accept_remaining",
    "preview_hash",
  ],
  display_read: "/v1/rewind/preview",
});

export const undoEditInputSchema = z.strictObject({
  id: idSchema("rvt"),
  session: idSchema("ses"),
  tool_call: idSchema("tcl"),
  preview_hash: sha256Schema,
  // 한 call이 쓴 파일 하나(이름 변경이면 옛 경로와 새 경로 둘).
  files: preparedFilesSchema.refine((files) => files.length <= 2, {
    message: "an undo restores at most two paths",
  }),
});

export const undoEditCompareSchema = z.strictObject({
  session_state: z.literal("open"),
  reverted_by: z.null(),
});

export const undoEdit = defineCommand({
  resource: "rewind",
  method: "undo",
  name: "UndoEdit",
  input: undoEditInputSchema,
  output: revertHeaderOutput,
  compare: undoEditCompareSchema,
  actors: ["user"],
  errors: [...commandErrors],
});

export const redoInputSchema = z.strictObject({
  revert: idSchema("rvt"),
  // 사람이 본 결과 event의 seq. 그 사이 상태가 바뀌었으면 거절한다.
  result_seq: seqSchema,
  // 복원했던 파일을 redo 근거에서 다시 쓰기 위한 준비.
  files: preparedFilesSchema,
});

export const redoCompareSchema = z.strictObject({
  redo: z.literal("available"),
});

export const redo = defineCommand({
  resource: "rewind",
  method: "redo",
  name: "Redo",
  input: redoInputSchema,
  output: revertHeaderOutput,
  compare: redoCompareSchema,
  actors: ["user"],
  errors: [...commandErrors],
});

// 문서 tool의 harness가 파일을 쓰기 직전에 부른다. 한도 판정은 이 command가 한다.
export const recordRewindFileInputSchema = z.strictObject({
  tool_call: idSchema("tcl"),
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

export const recordRewindFileOutputSchema = z.object({
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
  actors: ["agent"],
  errors: ["invalid_input", "conflict", "unavailable"],
});

export const checkpointRevertInputSchema = z.strictObject({
  revert: idSchema("rvt"),
  step_key: z.string().min(1),
  // 앱의 revert command 호출이 남긴 실제 Invocation이다(원래 write의 invocation이 아니다). 호출이
  // 앱에 닿지 않았거나 응답을 잃어 알 수 없으면 null이다. 원래 write의 invocation은 앱 단계
  // 근거(AppRevertBinding.invocation)에 그대로 있다.
  invocation: idSchema("inv").nullable(),
  result: appStepResultSchema,
});

export const checkpointRevert = defineCommand({
  resource: "rewind",
  method: "checkpoint",
  name: "CheckpointRevert",
  input: checkpointRevertInputSchema,
  output: z.object({
    revert: idSchema("rvt"),
    step_key: z.string().min(1),
    recorded: z.boolean(),
  }),
  actors: ["machine"],
  errors: ["conflict", "forbidden"],
});

export const finishRevertInputSchema = z.strictObject({
  revert: idSchema("rvt"),
  // 앱 단계 전체의 step_key. 저장한 단계 계획과 맞아야 한다.
  step_keys: z.array(z.string().min(1)).min(1),
  // 앱 단계가 모두 성공했을 때만 준비한 문서 파일 복원. partial·uncertain이면 비어 있다.
  files: preparedFilesSchema,
});

export const finishRevert = defineCommand({
  resource: "rewind",
  method: "finish",
  name: "FinishRevert",
  input: finishRevertInputSchema,
  output: revertHeaderOutput,
  actors: ["machine"],
  errors: ["conflict", "forbidden"],
});

// 확정된 revert의 설치가 쓰기 직전 hash 재비교에서 건너뛴 경로를 결과에 반영한다. outcome은
// applied 그대로이고, 그 항목은 plan=restore, result=skipped, reason=edited_outside가 된다.
// 그 경로의 기록은 되돌려짐 표시(reverted_by)를 풀고 redo 근거에서도 빠진다. 항목마다 한 번만 고친다.
export const amendRevertInstallInputSchema = z.strictObject({
  revert: idSchema("rvt"),
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
  output: revertHeaderOutput,
  actors: ["machine"],
  errors: ["conflict", "forbidden", "not_found"],
});

// 사람이 확인해 applying으로 접수된 revert의 앱 단계를 core가 이어 실행한다. 호출한 사람의
// 자격으로 앱의 revert command를 직접 부르고, 단계 기록과 끝내기는 core 내부 machine 자격이
// 한다. 사람 결정은 Rewind의 확인 handle이 이미 받았고 이 route는 applying인 revert만 이어
// 받는다. ledger를 거치지 않는 core 메모리 route다.
export const runAppRevert = defineMemory({
  resource: "rewind",
  method: "run-apps",
  name: "RunAppRevert",
  input: z.strictObject({
    revert: idSchema("rvt"),
    // 앱 단계 뒤에 복원할 문서 파일 준비. 앱 단계가 모두 성공했을 때만 쓴다.
    files: preparedFilesSchema,
  }),
  output: z.object({
    revert: idSchema("rvt"),
    outcome: revertOutcomeSchema,
    // 이번에 부른 단계의 step_key(호출 순서)다.
    called: z.array(z.string()),
  }),
  actors: ["user"],
  errors: [...commandErrors],
});

// "Summarize from here"의 요약 요청이다. Compact와 같은 모양이다: 사람이 요청하면(RequestRewindSummary) runtime이
// 요약 call(Model for summaries)을 하고(Take·FinishRewindSummary) 사람이 끝난 call로 Rewind(choice=summarize)를
// 확인한다. 요청은 ledger 기록이 아니라 core의 작업 메모리다: 요약 call 자체는 model call 기록에 남고, 접히는 것은
// Rewind가 확정할 때뿐이다. 요청이 사라지면(core 재시작, 기한) 사람이 다시 요청한다.
const summaryRequestIdSchema = z.string().min(1).max(64);

export const rewindSummaryStateSchema = z.discriminatedUnion("state", [
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
    // 요약을 시작할 사람 메시지(checkpoint). 숨긴 구간 안이거나 checkpoint가 아니면 거절한다.
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
      assignment: idSchema("asg"),
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

// 읽기. preview는 command나 event를 만들지 않는다.
export const rewindPreviewInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rewind"),
    session: idSchema("ses"),
    checkpoint: idSchema("msg"),
    choice: rewindChoiceSchema,
  }),
  z.strictObject({
    kind: z.literal("undo"),
    session: idSchema("ses"),
    tool_call: idSchema("tcl"),
  }),
]);

export const rewindPreviewOutputSchema = withReadCommon(z.object({
  kind: revertKindSchema,
  choice: rewindChoiceSchema.nullable(),
  checkpoint: idSchema("msg").nullable(),
  tool_call: idSchema("tcl").nullable(),
  restore: z.array(previewItemSchema),
  skip: z.array(previewItemSchema),
  remain: z.array(previewItemSchema),
  // 앱 복원이 있으면 false다. 예고일 뿐 결정 기준이 아니다.
  redo: z.boolean(),
  preview_hash: sha256Schema,
})).refine((value) => {
  if (value.kind === "rewind") {
    if (
      value.choice === null || value.checkpoint === null ||
      value.tool_call !== null
    ) return false;
  } else if (
    value.tool_call === null || value.choice !== null ||
    value.checkpoint !== null
  ) return false;
  const groups = [
    ["restore", value.restore],
    ["skip", value.skip],
    ["remain", value.remain],
  ] as const;
  if (
    groups.some(([plan, items]) => items.some((item) => item.plan !== plan))
  ) {
    return false;
  }
  const all = [...value.restore, ...value.skip, ...value.remain];
  if (new Set(all.map((item) => item.ordinal)).size !== all.length) {
    return false;
  }
  const redoable = value.kind === "rewind" && value.choice !== "summarize" &&
    !hasAppRestore(value.restore);
  return redoable || !value.redo;
}, { message: "preview fields disagree with its kind or lists" });

export const rewindPreview = defineRead({
  resource: "rewind",
  method: "preview",
  name: "PreviewRewind",
  input: rewindPreviewInputSchema,
  output: rewindPreviewOutputSchema,
  actors: readActors,
  errors: [...readErrors],
});

// rewind menu가 session의 checkpoint를 고르는 데 쓴다. 숨긴 구간 안의 checkpoint는 고를 수
// 없으므로 hidden으로 알린다. created_seq는 메시지의 생성 seq다.
export const checkpointEntrySchema = z.object({
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

export const rewindListInputSchema = z.strictObject({
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
    // boundary_seq부터 result_seq까지이고(그 뒤에 접수한 메시지는 숨기지 않는다) redo=done이면 다시 보인다.
    hidden_from_seq: seqSchema.nullable(),
  })),
  actors: readActors,
  errors: [...readErrors],
});

const revertSubject = idSchema("rvt");

export const revertStarted = defineEvent("RevertStarted", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    kind: revertKindSchema,
    choice: rewindChoiceSchema.nullable(),
    preview_hash: sha256Schema,
    // 전체 앱 단계 참조(step_key, 호출 순서).
    steps: z.array(z.string().min(1)).min(1),
  }),
});

export const revertApplied = defineEvent("RevertApplied", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    kind: revertKindSchema,
    choice: rewindChoiceSchema.nullable(),
    // 건너뜀·남는 영향이 있었나.
    partial: z.boolean(),
    results: revertResultCountsSchema,
    boundary_seq: seqSchema.nullable(),
    redo: revertRedoSchema,
  }),
});

export const revertFinished = defineEvent("RevertFinished", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    outcome: z.enum(["partial", "uncertain"]),
    results: revertResultCountsSchema,
  }),
});

export const revertBlocked = defineEvent("RevertBlocked", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    results: revertResultCountsSchema,
  }),
});

export const revertRedone = defineEvent("RevertRedone", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    // 다시 보인 메시지 수와 다시 복원한 파일 수.
    messages: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
  }),
});

export const revertClosed = defineEvent("RevertClosed", {
  subject: revertSubject,
  payload: z.object({
    session: idSchema("ses"),
    closed_at: atSchema,
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
  runAppRevert,
  rewind,
  undoEdit,
  redo,
  recordRewindFile,
  checkpointRevert,
  finishRevert,
  amendRevertInstall,
  requestRewindSummary,
  readRewindSummary,
  takeRewindSummaryRequest,
  finishRewindSummary,
  rewindPreview,
  rewindCheckpoints,
  rewindList,
] as const;

export const REVERT_EVENTS = [
  revertStarted,
  revertApplied,
  revertFinished,
  revertBlocked,
  revertRedone,
  revertClosed,
  revertAmended,
] as const;
