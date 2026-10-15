import { z } from "zod";
import { sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { appIdSchema } from "../projects/mod.ts";
import {
  preparedFilesSchema,
  previewItemSchema,
  revertHeaderOutput,
  rewindChoiceSchema,
} from "./reverts.ts";

// session rewind: 고른 시점으로 대화를 되돌리고, 사람이 고른 앱의 data도 그 시점으로 되돌린다.
// 앱 rewind의 계획(함께 되돌아갈 다른 변경, external 효과, 되돌릴 수 없음)은 앱 rewind 계획 route가
// 따로 보인다. 확인은 대화 화면 안의 panel이라 confirmation handle은 없다.
export const sessionRewindInputSchema = z.strictObject({
  id: idSchema("rvt"),
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

export const sessionRewindCompareSchema = z.strictObject({
  session_state: z.literal("open"),
  // 도는 turn이 없다. 먼저 멈춘 뒤에만 시작한다.
  active_turn: z.null(),
  applying_revert: z.null(),
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
  output: revertHeaderOutput,
  compare: sessionRewindCompareSchema,
  actors: ["user"],
  errors: [...commandErrors],
});

export const sessionRewindPreviewInputSchema = z.strictObject({
  session: idSchema("ses"),
  checkpoint: idSchema("msg"),
  choice: rewindChoiceSchema,
});

// 이 session이 고른 시점 뒤에 앱에 한 write invocation이다.
export const appWritesSchema = z.array(z.object({
  app: appIdSchema,
  invocations: z.array(idSchema("inv")),
}));

export const sessionRewindPreviewOutputSchema = withReadCommon(z.object({
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
