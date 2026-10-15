import { z } from "zod";
import { canonicalize } from "../../base/canonical-json.ts";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { callAgentSchema } from "../lophn-agent/calls.ts";
import { type AgentRef, agentRefSchema } from "../lophn-agent/places.ts";

// 효과. 대상마다 호출하는 쪽이 읽어 Gate에 넣는다.
export const EFFECTS = ["read", "write", "external"] as const;
export const effectSchema = z.enum(EFFECTS);
export type Effect = z.infer<typeof effectSchema>;

// 묻지 않음, 물음.
export const ASK_SETTINGS = ["never", "ask"] as const;
export const askSettingSchema = z.enum(ASK_SETTINGS);
export type AskSetting = z.infer<typeof askSettingSchema>;

// 대상의 setting이 없으면 효과별 기본값이다.
export const DEFAULT_ASK: Record<Effect, AskSetting> = {
  read: "never",
  write: "never",
  external: "ask",
};
// lophn 쪽 설정 고치기. agent가 자기 grant를 넓히지 못하게 한다.
export const SETTINGS_EDIT_DEFAULT_ASK: AskSetting = "ask";

// agent grant의 한 대상. 같은 대상은 entries 안에서 하나다.
export const agentGrantEntrySchema = z.discriminatedUnion("kind", [
  // 앱 하나를 할당하면 app-api 전부가 대상이다. apis에는 사람이 바꾼 것만 든다.
  // 빠진 app-api는 효과별 기본값이다. excluded는 그 agent가 부르지 못한다.
  z.strictObject({
    kind: z.literal("app"),
    app: idSchema("app"),
    apis: z.array(z.strictObject({
      api: z.string().min(1),
      setting: z.enum(["excluded", "never", "ask"]),
    })),
  }),
  z.strictObject({
    kind: z.literal("mcp_tool"),
    server: z.string().min(1),
    tool: z.string().min(1),
    setting: askSettingSchema.optional(),
  }),
  // 다른 agent 부르기. coding agent 맡기기도 대상이다.
  z.strictObject({
    kind: z.literal("agent"),
    agent: callAgentSchema,
    setting: askSettingSchema.optional(),
  }),
  // lophn 쪽 설정 고치기.
  z.strictObject({
    kind: z.literal("settings"),
    setting: askSettingSchema.optional(),
  }),
]);
export type AgentGrantEntry = z.infer<typeof agentGrantEntrySchema>;

// 같은 agent인지는 canonical JSON으로 비교한다.
export function agentKey(agent: AgentRef | z.infer<typeof callAgentSchema>) {
  return canonicalize(agent);
}

// 같은 대상인지 비교하는 key. setting은 대상이 아니다.
export function agentGrantEntryKey(entry: AgentGrantEntry): string {
  switch (entry.kind) {
    case "app":
      return `app:${entry.app}`;
    case "mcp_tool":
      return canonicalize(["mcp_tool", entry.server, entry.tool]);
    case "agent":
      return `agent:${agentKey(entry.agent)}`;
    case "settings":
      return "settings";
  }
}

const entriesSchema = z.array(agentGrantEntrySchema).refine(
  (entries) => {
    const keys = entries.map(agentGrantEntryKey);
    if (new Set(keys).size !== keys.length) return false;
    return entries.every((entry) =>
      entry.kind !== "app" ||
      new Set(entry.apis.map((one) => one.api)).size === entry.apis.length
    );
  },
  { message: "duplicate grant target" },
);

// key는 agent다. 고정 role agent는 role과 place가 곧 정체성이다.
export const agentGrantSchema = z.strictObject({
  agent: agentRefSchema,
  entries: entriesSchema,
});
export type AgentGrant = z.infer<typeof agentGrantSchema>;

// 새 일을 여는 domain event. 맡긴 call을 닫는 셋은 끌 수 없어서 여기 없다.
export const REACTION_EVENT_TYPES = [
  "ProblemOpened",
  "ProblemReopened",
  "AppRestartHalted",
  "ReleaseActivationFailed",
  "ContextViolationFound",
] as const;
export const reactionEventTypeSchema = z.enum(REACTION_EVENT_TYPES);
export type ReactionEventType = z.infer<typeof reactionEventTypeSchema>;

// 끔, 열고 묻지 않음, 물음.
export const REACTION_MODES = ["off", "open", "ask"] as const;
export const reactionModeSchema = z.enum(REACTION_MODES);
export type ReactionMode = z.infer<typeof reactionModeSchema>;
export const DEFAULT_REACTION_MODE: ReactionMode = "open";

export const reactionGrantSchema = z.strictObject({
  ProblemOpened: reactionModeSchema,
  ProblemReopened: reactionModeSchema,
  AppRestartHalted: reactionModeSchema,
  ReleaseActivationFailed: reactionModeSchema,
  ContextViolationFound: reactionModeSchema,
});
export type ReactionGrant = z.infer<typeof reactionGrantSchema>;

// Settings key는 `reactions.<snake_case 이벤트 이름>`이다.
export function reactionSettingKey(type: ReactionEventType): string {
  return `reactions.${
    type.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  }`;
}

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const agentGrantsGet = defineRead({
  resource: "agent_grants",
  method: "get",
  name: "GetAgentGrant",
  input: z.strictObject({ agent: agentRefSchema }),
  output: withReadCommon(z.object({ grant: agentGrantSchema })),
  actors: ["user"],
  errors: [...readErrors],
});

// entries를 통째로 바꾼다. agent·coding agent·앱은 자기 grant를 넓히지 못한다.
export const agentGrantsSet = defineCommand({
  resource: "agent_grants",
  method: "set",
  name: "SetAgentGrant",
  input: z.strictObject({ agent: agentRefSchema, entries: entriesSchema }),
  output: z.object({ grant: agentGrantSchema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// registry에는 lead가 올린다.
export const AGENT_GRANT_ROUTES = [agentGrantsGet, agentGrantsSet] as const;
