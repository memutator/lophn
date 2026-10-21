import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { toolKeySchema } from "../apps/channel-values.ts";
import { toolEffectSchema } from "../lophn-agent/tool-values.ts";

// Gate가 판정하는 호출 하나. kind로 가른다.
// Gate는 core(`packages/core/approvals`)가 구현하는 IO 없는 순수 함수다:
//   judge(call: GateCall, assignment: AgentAssignment | null, shell: ShellRuleLayers, mode: TurnMode): Judgment
// mode는 `lophn-agent/turn-values.ts`의 `TurnMode`다.
export const gateCallSchema = z.discriminatedUnion("kind", [
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
]);
export type GateCall = z.infer<typeof gateCallSchema>;

// not_assigned는 할당에 없는 앱의 tool, removed는 할당에서 뺀 tool, shell_rule은 shell 규칙(floor)이 막음.
export const DENY_REASONS = ["not_assigned", "removed", "shell_rule"] as const;
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
