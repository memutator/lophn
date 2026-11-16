import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { toolKeySchema } from "../apps/channel-values.ts";
import { toolEffectSchema } from "../lophn-agent/tool-values.ts";

// Gate가 판정하는 호출 하나. kind로 가른다.
// Gate는 core(`packages/core/approvals`)가 구현하는 IO 없는 순수 함수다:
//   judge(call: GateCall, assignment: Assignment | null, shell: ShellRuleLayers, mode: TurnMode): Judgment
// mode는 `lophn-agent/turn-values.ts`의 `TurnMode`다.
const askedCallOptions = [
  z.strictObject({
    kind: z.literal("app_tool"),
    app: idSchema("app"),
    tool: toolKeySchema,
    effect: toolEffectSchema,
  }),
  z.strictObject({
    kind: z.literal("mcp_tool"),
    server: z.string().min(1),
    tool: z.string().min(1),
    effect: toolEffectSchema,
  }),
  z.strictObject({
    kind: z.literal("shell"),
    command: z.string().min(1),
  }),
  // agent가 사람의 허락이 드는 설정(선언 `approval: "person"`)을 바꾼다. lines는 core가 선언의 describe(before, after)로
  // 만든 영어 줄이고 카드가 줄이지 않고 그대로 보인다. always가 없다(always_patterns는 빈 목록).
  z.strictObject({
    kind: z.literal("setting"),
    key: z.string().min(1),
    lines: z.array(z.string().min(1)).min(1),
  }),
] as const;

// 사람에게 물을 수 있는 호출이다. 승인 카드(turn request)와 ACP 승인 subject가 이것만 쓴다.
export const askedCallSchema = z.discriminatedUnion("kind", askedCallOptions);

// Gate가 판정하는 호출 하나. kind로 가른다.
// Gate는 core(`packages/core/approvals`)가 구현하는 IO 없는 순수 함수다:
//   judge(call: GateCall, assignment: Assignment | null, shell: ShellRuleLayers, mode: TurnMode, extensions: ExtensionGrant | null): Judgment
// mode는 `lophn-agent/turn-values.ts`의 `TurnMode`다.
// shell extension의 tool. 할당(정의 `extensions`)이 곧 허락이라 묻지 않는다: run이나 deny뿐이다.
// 묻지 않으므로 승인 카드와 `acpApprovalSubjectSchema`에는 들지 않는다(ACP 승인 type이 넓어지지 않게).
export const gateCallSchema = z.discriminatedUnion("kind", [
  ...askedCallOptions,
  z.strictObject({
    kind: z.literal("extension_tool"),
    extension: z.string().min(1),
    tool: z.string().min(1),
  }),
]);
export type GateCall = z.infer<typeof gateCallSchema>;
export type AskedCall = z.infer<typeof askedCallSchema>;

// harness가 파일 바꾸기를 승인에 올린다. core Gate가 판정하는 호출이 아니라 ACP 승인 카드의 subject만 넓힌다.
// added·removed는 줄 수이고 모르면 null이다.
export const fileChangeSubjectSchema = z.strictObject({
  kind: z.literal("file_change"),
  changes: z.array(
    z.strictObject({
      path: z.string().min(1),
      change: z.enum(["create", "update", "delete"]),
      added: z.number().int().nonnegative().nullable(),
      removed: z.number().int().nonnegative().nullable(),
    }),
  ),
});
// harness의 plan 승인 카드다. `modes`는 harness가 주는 "승인하고 이렇게 이어 간다" 단추(Claude "Accept edits"·"Ask for
// edits", omp execute·keep context 등)이고 화면은 해석하지 않는다. 이 카드의 `pending.approval.choices`는 `["reject"]`이고
// (거절 = 계속 plan, 이유 글이 feedback이다) 승인은 `decide {kind: "mode"}`로 한다.
export const planSubjectSchema = z.strictObject({
  kind: z.literal("plan"),
  plan: z.string(),
  modes: z
    .array(z.strictObject({ id: z.string().min(1), label: z.string() }))
    .min(1),
});
export const acpApprovalSubjectSchema = z.discriminatedUnion("kind", [
  ...askedCallSchema.options,
  fileChangeSubjectSchema,
  planSubjectSchema,
]);
export type AcpApprovalSubject = z.infer<typeof acpApprovalSubjectSchema>;

// not_assigned는 할당에 없는 앱의 tool(extension_tool은 정의 `extensions`에 없는 extension), removed는 할당에서 뺀 tool
// (extension_tool은 꺼졌거나 목록에서 빠진 tool), shell_rule은 shell 규칙(floor)이 막음. no_person은 사람이 있는 session에서만
// 묻는 호출(setting)을 unattended turn이나 팀 자식이 한 것이다.
export const DENY_REASONS = [
  "not_assigned",
  "removed",
  "shell_rule",
  "no_person",
] as const;
export const denyReasonSchema = z.enum(DENY_REASONS);
export type DenyReason = z.infer<typeof denyReasonSchema>;

// pattern은 reason이 shell_rule일 때 막은 규칙이고 나머지는 null이다.
export const judgmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run") }),
  z.strictObject({ kind: z.literal("ask") }),
  z.strictObject({
    kind: z.literal("deny"),
    reason: denyReasonSchema,
    pattern: z.string().nullable(),
  }),
]);
export type Judgment = z.infer<typeof judgmentSchema>;
