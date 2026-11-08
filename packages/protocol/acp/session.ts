import { z } from "zod";
import { atSchema } from "../base/values.ts";
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
  /**
   * `switch`는 값이 정확히 둘이고 `[0]`이 끔, `[1]`이 켬이다. picker는 켜고 끄기로 그리고, `options`에 그 축이
   * 없으면 끔으로 그린다. `choice`는 값 목록에서 하나를 고른다.
   */
  kind: z.enum(["choice", "switch"]),
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

/** `app`은 lophn 앱이 하는 명령(lophn 내장), `harness`는 그 CLI의 내장 명령, `custom_*`는 사람이 쓴 명령 file(Claude `~/.claude/commands`, `.claude/commands` 등)이다. 순서가 palette의 같은 순위 안 출처 순서다. */
export const ACP_COMMAND_SOURCES = [
  "app",
  "harness",
  "skill",
  "plugin",
  "mcp",
  "custom_user",
  "custom_project",
] as const;

/**
 * 명령이 열 화면 동작. 화면은 명령 이름이 아니라 이 값만 본다.
 *
 * | opens | 화면이 하는 일 | 내는 쪽 |
 * | new | 새 session 화면을 연다 | lophn(`/new`, 별칭 `/clear`). harness는 쓰지 않는다: 같은 탭의 새 session은 adapter가 `run_command`로 연다 |
 * | rename | 인자가 비면 composer에 `/<이름> `을 채우고 기다리고, 있으면 `rename {title: 인자}` | 둘 다 |
 * | archive | 이 session을 archive한다 | lophn |
 * | compact | `compact` 입력 | 둘 다 |
 * | fork | `fork {message: null}` | 둘 다 |
 * | rewind | rewind 고르기를 연다 | 둘 다 |
 * | model | model picker를 연다 | 둘 다 |
 * | effort | model picker의 option 축을 연다 | 둘 다 |
 * | mode | mode picker를 연다(harness `/permissions`, OpenCode `/agents`) | 둘 다 |
 * | permissions | lophn 할당 보기(`PermissionsView`) | lophn |
 * | status | status card | 둘 다 |
 * | usage | usage card(`usage`와 `limits`) | 둘 다 |
 * | context | context card(`usage.context`와 `parts`) | 둘 다 |
 * | mcp, skills | lophn agent 설정의 그 절 | lophn |
 * | subagents | dock의 subagent 목록 | harness |
 * | tasks | dock의 background task 목록 | harness |
 * | goal | 인자가 비면 goal 편집, 있으면 `set_goal {objective: 인자, paused: false}` | harness |
 * | resume | 머리 session menu를 연다(그 CLI의 지난 session 목록과 바꾸기) | harness |
 *
 * 규칙: `opens`가 null이면 화면은 `run_command`로 보낸다. `opens`가 있는데 사람이 인자를 쳤고 그 값이 인자를 쓰지
 * 않는 것(`rename`·`goal` 밖)이면, `argument_hint`가 있을 때 `run_command`로 보낸다(`/model sonnet`은 CLI가 바로
 * 바꾼다). TUI에서만 되는 명령은 목록에 넣지 않는다. 켜고 끄는 명령(Codex `/plan`, omp `/fast`)처럼 열 화면이 없는
 * 것은 `opens: null`이고 adapter가 `run_command`에서 바꾼 뒤 `session_changed`를 낸다.
 */
export const ACP_COMMAND_OPENS = [
  "new",
  "rename",
  "archive",
  "compact",
  "fork",
  "rewind",
  "model",
  "effort",
  "mode",
  "permissions",
  "status",
  "usage",
  "context",
  "mcp",
  "skills",
  "subagents",
  "tasks",
  "goal",
  "resume",
] as const;
export const acpCommandOpensSchema = z.enum(ACP_COMMAND_OPENS);
export type AcpCommandOpens = z.infer<typeof acpCommandOpensSchema>;

export const acpCommandSchema = z.strictObject({
  name: id,
  /** 앞 `/` 없는 다른 이름. */
  aliases: z.array(id),
  description: z.string(),
  /** null이면 인자를 받지 않는다. */
  argument_hint: z.string().nullable(),
  source: z.enum(ACP_COMMAND_SOURCES),
  opens: acpCommandOpensSchema.nullable(),
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

export const acpUsageLimitSchema = z.strictObject({
  id,
  label: z.string(),
  used_percent: z.number().min(0).max(100).nullable(),
  /** "$4.20 left"처럼 source가 만든 글. */
  left: z.string().nullable(),
  resets_at: atSchema.nullable(),
});
export type AcpUsageLimit = z.infer<typeof acpUsageLimitSchema>;

/** `/status`가 그리는 칸이다(lophn의 `StatusView`와 같다). 모르는 칸은 null이고 0이 아니다. */
export const acpUsageSchema = z.strictObject({
  /** 지금 창에 든 token과 창 한도. `parts`는 `/context` card의 분해이고 모르면 빈 배열이다. */
  context: z
    .strictObject({
      tokens: count,
      limit: count,
      parts: z.array(z.strictObject({ label: z.string(), tokens: count })),
    })
    .nullable(),
  /** 사용 한도(5시간 창, 주간 등). 모르면 빈 배열. */
  limits: z.array(acpUsageLimitSchema),
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
  /** 도는 root tool(Bash·Agent 등)을 background로 보낸다(`background_tool`). */
  "background",
  "queue_edit",
  "images",
  "retry",
  /** lophn session 목록·바꾸기·새로·archive·delete. 머리의 session menu가 본다. lophn만 true다. */
  "sessions",
  /** subagent를 멈추고(`stop_child`) 방향을 준다(`steer_child`). */
  "stop_child",
  "steer_child",
  /** background task 목록과 `stop_task`. */
  "tasks",
  /** meta `toggles`와 `set_toggle`. */
  "toggles",
  /** meta `goal`과 `set_goal`. */
  "goal",
  /** meta `roles`와 `use_role`. */
  "roles",
  /** composer shell mode(`!`)와 `run_shell`. */
  "shell",
  /** harness 머리 session menu의 지난 session 목록과 `open_session`. */
  "resume",
] as const;
export const acpCapabilitiesSchema = z.strictObject(
  Object.fromEntries(
    ACP_CAPABILITIES.map((name) => [name, z.boolean()]),
  ) as Record<(typeof ACP_CAPABILITIES)[number], z.ZodBoolean>,
);
export type AcpCapabilities = z.infer<typeof acpCapabilitiesSchema>;

/** 켜고 끄는 session 설정(Codex plan mode, omp fast/slow, OpenCode auto-accept). */
export const acpToggleSchema = z.strictObject({
  id,
  label: z.string(),
  description: z.string().nullable(),
  on: z.boolean(),
});
export type AcpToggle = z.infer<typeof acpToggleSchema>;

/** Codex `usageLimited`·`budgetLimited`는 `blocked`에 `detail`로 싣는다. */
export const acpGoalSchema = z.strictObject({
  objective: z.string(),
  status: z.enum(["active", "paused", "blocked", "done"]),
  detail: z.string().nullable(),
});
export type AcpGoal = z.infer<typeof acpGoalSchema>;

/** model role(omp `/switch @role`). role 배정을 바꾸는 칸은 두지 않는다. */
export const acpRoleSchema = z.strictObject({
  id,
  label: z.string(),
  kind: z.enum(["chat", "model"]),
  model: z.string().nullable(),
});
export type AcpRole = z.infer<typeof acpRoleSchema>;

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
  toggles: z.array(acpToggleSchema),
  goal: acpGoalSchema.nullable(),
  /** null = role이 없는 source. */
  roles: z.array(acpRoleSchema).nullable(),
  /** harness id(`protocol/coding-agent/harness-id.ts`의 값). lophn은 null. 화면이 이 값으로 vendor 아이콘을 고른다. */
  harness: z.string().min(1).nullable(),
});
export type AcpSessionMeta = z.infer<typeof acpSessionMetaSchema>;
