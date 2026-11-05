import { z } from "zod";
import { CREDENTIAL_STATES } from "../lophn-agent/provider-values.ts";

// 대화 밖 session 기능(model, mode, 명령, 사용량)과 source가 그 기능을 가졌는지 알리는 capability다.
// lophn agent와 harness CLI가 같은 모양으로 낸다. 화면은 capability만 보고 칸을 그린다.
// 값의 id(model, mode, 축, 명령 이름)는 source가 정하는 불투명 글이고 화면은 해석하지 않는다.

const id = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const acpChoiceSchema = z.strictObject({
  id,
  label: z.string(),
  description: z.string().nullable(),
});
export type AcpChoice = z.infer<typeof acpChoiceSchema>;

/** model의 option 축 하나(effort, speed, thinking, variant 모두 축이다). lophn picker의 `PickerAxisView`와 같은 칸이다. */
export const acpModelAxisSchema = z.strictObject({
  id,
  label: z.string(),
  values: z.array(z.strictObject({ value: z.string(), label: z.string() })),
});
export type AcpModelAxis = z.infer<typeof acpModelAxisSchema>;

export const acpModelSchema = z.strictObject({
  id,
  label: z.string(),
  axes: z.array(acpModelAxisSchema),
});
export type AcpModel = z.infer<typeof acpModelSchema>;

/** lophn은 provider 묶음이고 harness는 CLI가 주는 묶음이나 하나다. */
export const acpModelGroupSchema = z.strictObject({
  id,
  label: z.string(),
  models: z.array(acpModelSchema),
});
export type AcpModelGroup = z.infer<typeof acpModelGroupSchema>;

// lophn `AgentValueLayer`(agent-definitions.ts의 AGENT_VALUE_LAYERS)와 같은 값. 그쪽이 enum을 내놓지 않고, type만
// 가져와도 shell main tsc가 agent-definitions의 큰 import 사슬을 읽게 되어 값을 옮겨 적는다.
const valueLayers = ["global", "project", "agent", "session"] as const;

export const acpModelCurrentSchema = z.strictObject({
  model: id,
  label: z.string(),
  /** 축 id → 고른 값. 없는 축은 모델에 맡김이다. */
  options: z.record(z.string(), z.string()),
  /** 어느 층의 값인가. harness는 null이다. */
  layer: z.enum(valueLayers).nullable(),
});
export type AcpModelCurrent = z.infer<typeof acpModelCurrentSchema>;

export const ACP_COMMAND_SOURCES = ["builtin", "skill", "cli"] as const;
/** `builtin`·`skill`은 lophn `/` 명령의 출처와 같은 뜻이고 `cli`는 harness가 주는 명령이다. */
export const acpCommandSchema = z.strictObject({
  name: id,
  description: z.string(),
  argument_hint: z.string().nullable(),
  source: z.enum(ACP_COMMAND_SOURCES),
});
export type AcpCommand = z.infer<typeof acpCommandSchema>;

// `COST_KINDS`(model-call-values.ts)와 같은 값이다. 그 file을 import하면 shell main tsc가 resolved-model.ts까지 읽는다.
const COST_KINDS = [
  "reported",
  "estimated",
  "subscription",
  "free",
  "unknown",
] as const;

const tokens = count.nullable();

/** `/status`가 그리는 칸이다(lophn의 `StatusView`와 같다). 모르는 칸은 null이고 0이 아니다. */
export const acpUsageSchema = z.strictObject({
  /** 지금 창에 든 token과 창 한도. */
  context: z.strictObject({ tokens: count, limit: count }).nullable(),
  input_tokens: tokens,
  output_tokens: tokens,
  cache_read_tokens: tokens,
  cache_write_tokens: tokens,
  turns: tokens,
  /** 금액. kind·통화가 다르면 따로 센다. 하나라도 모르면 그 묶음의 amount는 null이다. */
  costs: z.array(
    z.strictObject({
      kind: z.enum(COST_KINDS),
      currency: z.string().nullable(),
      amount: z.string().nullable(),
    }),
  ),
  provider: z
    .strictObject({
      name: z.string(),
      /** vendor 아이콘을 고르는 정의 key. */
      definition: z.string(),
      account: z.string().nullable(),
      state: z.enum(CREDENTIAL_STATES),
      /** usage_wait가 풀리는 시각. */
      until: z.string().nullable(),
    })
    .nullable(),
});
export type AcpUsage = z.infer<typeof acpUsageSchema>;

/**
 * source가 가진 기능. 화면이 칸을 켜고 끄는 근거다. `effort`는 "model 축 값을 바꿀 수 있다"이다. rewind를 마지막
 * 사람 메시지에만 받는 harness는 `rewind`를 켜고 다른 메시지면 `invalid_input`으로 답한다.
 */
export const ACP_CAPABILITIES = [
  "model",
  "effort",
  "mode",
  "commands",
  "rewind",
  "rewind_files",
  "fork",
  "compact",
  "rename",
  "usage",
  "steer",
  "queue_edit",
  "images",
  "retry",
  /** lophn session 목록·바꾸기·새로·archive·delete. 머리의 session menu가 본다. lophn만 true다. */
  "sessions",
] as const;
export const acpCapabilitiesSchema = z.strictObject(
  Object.fromEntries(
    ACP_CAPABILITIES.map((name) => [name, z.boolean()]),
  ) as Record<(typeof ACP_CAPABILITIES)[number], z.ZodBoolean>,
);
export type AcpCapabilities = z.infer<typeof acpCapabilitiesSchema>;

export const acpSessionMetaSchema = z.strictObject({
  title: z.string().nullable(),
  /** harness CLI 자신의 session id(resume, 창 머리). lophn은 null이다. */
  cli_session: z.string().nullable(),
  capabilities: acpCapabilitiesSchema,
  models: z.array(acpModelGroupSchema),
  model: acpModelCurrentSchema.nullable(),
  modes: z.array(acpChoiceSchema),
  mode: z.string().nullable(),
  commands: z.array(acpCommandSchema),
  usage: acpUsageSchema.nullable(),
});
export type AcpSessionMeta = z.infer<typeof acpSessionMetaSchema>;
