import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { seqSchema } from "../base/values.ts";
import { activationComparisonSchema } from "../apps/activation/activation.ts";
import { toolKeySchema } from "../apps/channel-values.ts";
import { appGrantSchema } from "../apps/grants.ts";
import { appGrantScopeSchema } from "../apps/permissions.ts";
import { callAgentSchema } from "../lophn-agent/calls.ts";
import { agentRefSchema } from "../lophn-agent/places.ts";
import {
  agentGrantSchema,
  effectSchema,
  reactionEventTypeSchema,
  reactionGrantSchema,
} from "./grants.ts";

// app_resource는 앱의 바깥 자원(network host, secret, 파일) 사용이다.
const INTENT_KINDS = [
  "app_tool",
  "mcp_tool",
  "agent_call",
  "settings_edit",
  "app_resource",
  "reaction",
  "activation",
] as const;
export const intentKindSchema = z.enum(INTENT_KINDS);
export type IntentKind = z.infer<typeof intentKindSchema>;

const intentActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("agent"),
    agent: agentRefSchema,
    session: idSchema("ses"),
  }),
  z.strictObject({ kind: z.literal("app"), app: idSchema("app") }),
  // 근거 domain event seq.
  z.strictObject({ kind: z.literal("program"), seq: seqSchema }),
]);

export const intentTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("app_tool"),
    app: idSchema("app"),
    tool: toolKeySchema,
  }),
  z.strictObject({
    kind: z.literal("mcp_tool"),
    server: z.string().min(1),
    tool: z.string().min(1),
  }),
  // 받는 agent. 열린 session으로 보내도 그 session의 agent다.
  z.strictObject({ kind: z.literal("agent_call"), agent: callAgentSchema }),
  z.strictObject({
    kind: z.literal("settings_edit"),
    what: z.enum([
      "instructions",
      "agent_definition",
      "skill",
      "setting",
      "grant",
    ]),
    id: z.string().min(1).nullable(),
  }),
  // net.fetch, secret.use, fs 등.
  z.strictObject({
    kind: z.literal("app_resource"),
    scope: appGrantScopeSchema,
  }),
  z.strictObject({
    kind: z.literal("reaction"),
    event: reactionEventTypeSchema,
  }),
  z.strictObject({
    kind: z.literal("activation"),
    app: idSchema("app"),
    release: idSchema("rel"),
  }),
]);
export type IntentTarget = z.infer<typeof intentTargetSchema>;

const intentOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("turn"),
    session: idSchema("ses"),
    turn: idSchema("trn"),
    tool_call: idSchema("tcl"),
  }),
  z.strictObject({ kind: z.literal("event"), seq: seqSchema }),
  z.strictObject({
    kind: z.literal("activation"),
    app: idSchema("app"),
    release: idSchema("rel"),
  }),
  // 앱이 다른 앱의 tool을 부른 호출. 도는 부모 invocation이다. 부모를 모르면 부르지 못한다.
  z.strictObject({ kind: z.literal("app"), invocation: idSchema("inv") }),
]);

// effect는 호출하는 쪽이 읽어 넣는다: tool은 활성 release 선언, MCP tool은 readOnlyHint.
// agent_call은 read, settings_edit는 write다. reaction과 activation은 read로 두고
// Gate는 effect 대신 grant로 판정한다.
// input은 정규화한 입력이다. activation의 input은 선언 비교 값이고 activationComparisonSchema를 따른다.
// Gate 판정: activation이면 first이거나 added_resources, added_tools, loss_steps 가운데
// 하나라도 비어 있지 않을 때 ask다.
export const intentSchema = z.strictObject({
  kind: intentKindSchema,
  actor: intentActorSchema,
  target: intentTargetSchema,
  effect: effectSchema,
  input: jsonObjectSchema,
  origin: intentOriginSchema,
}).refine((value) => value.kind === value.target.kind, {
  message: "intent kind does not match target kind",
}).refine(
  (value) =>
    value.kind !== "activation" ||
    activationComparisonSchema.safeParse(value.input).success,
  { message: "activation input must be an activation comparison" },
);
export type Intent = z.infer<typeof intentSchema>;

// grant 밖(대상이 grant에 없음), agent grant에서 뺀 tool, reaction grant가 꺼짐.
const GATE_DENY_REASONS = [
  "not_granted",
  "excluded",
  "reaction_off",
] as const;
export const gateDenyReasonSchema = z.enum(GATE_DENY_REASONS);
export type GateDenyReason = z.infer<typeof gateDenyReasonSchema>;

// 이유 글은 만들지 않는다. 글은 호출하는 쪽이 wording key로 만든다.
const gateVerdictSchema = z.discriminatedUnion("verdict", [
  z.strictObject({ verdict: z.literal("deny"), reason: gateDenyReasonSchema }),
  z.strictObject({ verdict: z.literal("run") }),
  z.strictObject({ verdict: z.literal("ask") }),
]);
export type GateVerdict = z.infer<typeof gateVerdictSchema>;

// Gate는 이 값과 intent만 본다. IO가 없다.
const gateGrantsSchema = z.strictObject({
  app: z.array(appGrantSchema),
  agent: agentGrantSchema.nullable(),
  reaction: reactionGrantSchema,
});
export type GateGrants = z.infer<typeof gateGrantsSchema>;
