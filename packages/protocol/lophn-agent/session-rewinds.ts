import { z } from "zod";
import { seqSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { appIdSchema, relativePathSchema } from "../projects/mod.ts";

// "Restore messages and documents" / "Restore messages only" / "Summarize from here".
const REWIND_CHOICES = [
  "restore_all",
  "messages_only",
  "summarize",
] as const;
export const rewindChoiceSchema = z.enum(REWIND_CHOICES);
export type RewindChoice = z.infer<typeof rewindChoiceSchema>;

export const rewindOutcomeSchema = z.enum([
  "applying",
  "applied",
  "partial",
  "uncertain",
  "blocked",
]);

// 이유는 글이 아니라 고정 코드다. 화면 문장은 이 코드로 wording을 고른다.
const REWIND_REASON_CODES = [
  "edited_outside",
  "chain_broken",
  "no_pre_image",
  "link_path",
  "rename_blocked",
  "created_edited",
  "external_effect",
  "already_reverted",
  "answered_fact",
  "later_edit",
] as const;
const rewindReasonSchema = z.enum(REWIND_REASON_CODES);
export type RewindReason = z.infer<typeof rewindReasonSchema>;

const FILE_REASONS: readonly RewindReason[] = [
  "edited_outside",
  "chain_broken",
  "no_pre_image",
  "link_path",
  "rename_blocked",
  "created_edited",
  "already_reverted",
  "later_edit",
];
const FACT_REASONS: readonly RewindReason[] = [
  "external_effect",
  "answered_fact",
];

const REWIND_ITEM_CLASSES = ["file", "fact"] as const;
const rewindItemClassSchema = z.enum(REWIND_ITEM_CLASSES);
const rewindPlanSchema = z.enum(["restore", "skip", "remain"]);

// rewind 항목 중 사전 검사가 정하는 부분(preview의 restore·skip·remain 항목).
export const previewItemFields = {
  ordinal: z.number().int().nonnegative(),
  class: rewindItemClassSchema,
  // file은 경로, fact는 사실 종류다.
  target: z.string().min(1),
  source: z.array(idSchema("tcl")),
  plan: rewindPlanSchema,
  reason: rewindReasonSchema.nullable(),
};

export type ItemShape = {
  class: "file" | "fact";
  plan: "restore" | "skip" | "remain";
  reason: RewindReason | null;
};

// 이유 코드는 대상 종류에 맞는 것만 쓰고, 남는 사실은 되돌리지 않으며, 문서 파일은 복원하거나
// 건너뛸 뿐 남는 영향이 아니다.
export function classOk(value: ItemShape): boolean {
  if (value.reason !== null) {
    const fits = value.class === "file" ? FILE_REASONS : FACT_REASONS;
    if (!fits.includes(value.reason)) return false;
  }
  if (value.class === "fact" && value.plan !== "remain") return false;
  return !(value.class === "file" && value.plan === "remain");
}

export function previewItemOk(value: ItemShape): boolean {
  // 건너뜀·남는 영향은 이유가 필수다. 복원 계획은 이유가 없다.
  return (value.plan === "restore") === (value.reason === null) &&
    classOk(value);
}

const previewItemSchema = z.object(previewItemFields).refine(
  previewItemOk,
  { message: "preview item fields disagree with its class or plan" },
);
export type PreviewItem = z.infer<typeof previewItemSchema>;

// 사람이 요청한 파일 복원 준비. 파일 쓰기·hash 계산·복원 내용 준비는 transaction 밖에서
// core가 하고, command는 ledger 기록과 이 관측으로 판정을 다시 한다. 판정에 든 경로(복원할
// 경로, 건너뛰는 경로, 이름 변경의 옛 경로)마다 하나씩 싣는다. 준비가 없으면 그 파일은
// restored가 될 수 없다.
const preparedFileSchema = z.strictObject({
  path: relativePathSchema,
  // 준비 때 본 파일의 지금 hash. 없으면 null.
  observed_sha256: sha256Schema.nullable(),
  // symlink이거나 hard link인 경로다(link_path).
  link: z.boolean(),
  // 복원할 내용(pre-image)을 session 저장소에서 읽을 수 있음을 확인했나.
  staged: z.boolean(),
});
export type PreparedFile = z.infer<typeof preparedFileSchema>;
const preparedFilesSchema = z.array(preparedFileSchema).refine(
  (files) => new Set(files.map((file) => file.path)).size === files.length,
  { message: "duplicate prepared path" },
);

export const rewindHeaderOutput = z.object({
  id: idSchema("rwd"),
  session: idSchema("ses"),
  outcome: rewindOutcomeSchema,
  result_seq: seqSchema.nullable(),
  // 같은 요청이 이미 접수되어 저장된 현재 결과를 돌려준 것이다.
  replayed: z.boolean(),
}).refine(
  (value) => (value.outcome === "applying") === (value.result_seq === null),
  { message: "only an applying rewind lacks a result event" },
);

// session rewind: 고른 시점으로 대화를 되돌리고, 사람이 고른 앱의 data도 그 시점으로 되돌린다.
// 앱 rewind의 계획(함께 되돌아갈 다른 변경, external 효과, 되돌릴 수 없음)은 앱 rewind 계획 route가
// 따로 보인다. 확인은 대화 화면 안의 panel이라 confirmation handle은 없다.
const sessionRewindInputSchema = z.strictObject({
  id: idSchema("rwd"),
  session: idSchema("ses"),
  checkpoint: idSchema("msg"),
  choice: rewindChoiceSchema,
  // 사람이 건너뜀·남는 영향 목록을 확인했다. 목록이 있는데 false면 blocked 결과다.
  accept_remaining: z.boolean(),
  preview_hash: sha256Schema,
  // choice=summarize일 때만: 완전 성공한 요약 call.
  summary_call: idSchema("mcl").nullable(),
  // choice=restore_all일 때만 준비한 파일 복원.
  files: preparedFilesSchema,
  // 사람이 고른 앱. 비면 앱 data는 그대로다.
  apps: z.array(appIdSchema).refine(
    (apps) => new Set(apps).size === apps.length,
    { message: "duplicate app" },
  ),
}).refine(
  (value) =>
    (value.choice === "summarize") === (value.summary_call !== null) &&
    (value.choice === "restore_all" || value.files.length === 0),
  { message: "summary_call and files must match the chosen scope" },
);

const sessionRewindCompareSchema = z.strictObject({
  session_state: z.literal("open"),
  // 도는 turn이 없다. 먼저 멈춘 뒤에만 시작한다.
  active_turn: z.null(),
  applying_rewind: z.null(),
});

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

export const sessionRewind = defineCommand({
  resource: "rewind",
  method: "apply",
  name: "Rewind",
  input: sessionRewindInputSchema,
  output: rewindHeaderOutput,
  compare: sessionRewindCompareSchema,
  actors: ["user"],
  errors: [...commandErrors],
});

const sessionRewindPreviewInputSchema = z.strictObject({
  session: idSchema("ses"),
  checkpoint: idSchema("msg"),
  choice: rewindChoiceSchema,
});

// 이 session이 고른 시점 뒤에 앱에 한 write invocation이다.
const appWritesSchema = z.array(z.object({
  app: appIdSchema,
  invocations: z.array(idSchema("inv")),
}));

export type SessionAppWrites = z.infer<typeof appWritesSchema>;

const sessionRewindPreviewOutputSchema = withReadCommon(z.object({
  choice: rewindChoiceSchema,
  checkpoint: idSchema("msg"),
  restore: z.array(previewItemSchema),
  skip: z.array(previewItemSchema),
  remain: z.array(previewItemSchema),
  app_writes: appWritesSchema,
  preview_hash: sha256Schema,
})).refine((value) => {
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
  return new Set(all.map((item) => item.ordinal)).size === all.length;
}, { message: "preview lists disagree with their plans" });

export const sessionRewindPreview = defineRead({
  resource: "rewind",
  method: "preview",
  name: "PreviewRewind",
  input: sessionRewindPreviewInputSchema,
  output: sessionRewindPreviewOutputSchema,
  actors: ["user", "machine"],
  errors: [...readErrors],
});
