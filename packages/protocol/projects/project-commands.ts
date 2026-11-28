import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";

// `projects/` 최상위가 `coding-agent/`·`lophn-agent/`에 거꾸로 기대지 않도록 참조 꼴만 여기서 닫는다.
const terminalRefSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const agentIdSchema = z.union([
  z.literal("lophn_home"),
  z
    .string()
    .refine(
      (value) =>
        value.startsWith("lophn_") &&
        (idSchema("prj").safeParse(value.slice(6)).success ||
          idSchema("app").safeParse(value.slice(6)).success),
    ),
  z.string().regex(/^coding_[a-z0-9][a-z0-9_-]*$/),
  idSchema("agt"),
]);

// project에서 반복 실행하는 명령(action)과 장기 실행 서비스(service)의 계약이다.
// 정의와 project별 agent 설정은 core의 ledger가 소유하고, 실행(ProjectCommandRun)은 core 메모리에 둔다.
// env 값은 로그·알림·승인 카드·CLI `list`·agent·원격 응답에 원문으로 싣지 않는다(키 이름만 보인다).

export const COMMAND_KINDS = ["action", "service"] as const;
export const commandKindSchema = z.enum(COMMAND_KINDS);
export type CommandKind = z.infer<typeof commandKindSchema>;

export const PROJECT_COMMANDS_MAX = 50;
export const PROJECT_COMMAND_ENV_MAX = 64;
export const PROJECT_COMMAND_DETECTED_URLS_MAX = 8;

export const PROJECT_COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const PROJECT_COMMAND_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const projectCommandIdSchema = z
  .string()
  .regex(PROJECT_COMMAND_ID_PATTERN, "invalid command id");

export const projectCommandNameSchema = z.string().trim().min(1).max(60);

export const projectCommandScriptSchema = z.string().trim().min(1).max(4000);

// 기준 폴더 안의 상대 경로다. 절대 경로와 `..` 탈출을 거절한다(실제 실행 시 realpath로 한 번 더 검사한다).
export const projectCommandCwdSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:/.test(value) &&
      !/(?:^|[\\/])\.\.(?:$|[\\/])/.test(value),
    "cwd must be a relative path inside the project folder without '..'",
  );

export const projectCommandEnvSchema = z
  .record(
    z.string().regex(PROJECT_COMMAND_ENV_KEY_PATTERN, "invalid env key"),
    z.string().max(4096),
  )
  .refine(
    (env) => Object.keys(env).length <= PROJECT_COMMAND_ENV_MAX,
    `at most ${PROJECT_COMMAND_ENV_MAX} env entries`,
  );

// http/https만 허용하고 내장 자격증명(user:pass@)을 거부한다.
export const projectCommandPreviewUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  }, "preview_url must be an http(s) URL without embedded credentials");

export const projectCommandTimeoutSchema = z
  .number()
  .int()
  .min(1_000)
  .max(3_600_000);

export const projectCommandAgentsSchema = z.union([
  z.literal("all"),
  z.array(agentIdSchema).max(100),
]);
export type ProjectCommandAgents = z.infer<typeof projectCommandAgentsSchema>;

export const projectCommandSettingsSchema = z.strictObject({
  agents: projectCommandAgentsSchema,
  ask_before_run: z.boolean(),
  approve_agent_writes: z.boolean(),
});
export type ProjectCommandSettings = z.infer<
  typeof projectCommandSettingsSchema
>;

export const DEFAULT_PROJECT_COMMAND_SETTINGS: ProjectCommandSettings = {
  agents: "all",
  ask_before_run: false,
  approve_agent_writes: true,
};

export const projectCommandSchema = z.strictObject({
  id: projectCommandIdSchema,
  name: projectCommandNameSchema,
  command: projectCommandScriptSchema,
  kind: commandKindSchema,
  description: z.string().trim().max(200).optional(),
  folder_ref: z.string().min(1).max(80).optional(),
  cwd: projectCommandCwdSchema.optional(),
  // env 키 목록(정렬됨). 값은 로컬 사람이 설정 편집을 위해 명시적으로 요청할 때만 `env`에 싣는다.
  env_keys: z
    .array(z.string().regex(PROJECT_COMMAND_ENV_KEY_PATTERN))
    .optional(),
  env: projectCommandEnvSchema.optional(),
  preview_url: projectCommandPreviewUrlSchema.optional(),
  auto_open_preview: z.boolean().optional(),
  timeout_ms: projectCommandTimeoutSchema.optional(),
  order: z.number().int().nonnegative().optional(),
  // 명령별 덮어쓰기(생략 시 project 기본값을 따른다). 사람만 쓴다.
  agents: projectCommandAgentsSchema.optional(),
  ask_before_run: z.boolean().optional(),
});
export type ProjectCommand = z.infer<typeof projectCommandSchema>;

// 명령을 추가하거나 가져올 때의 입력. `id`를 생략하면 core가 `name`에서 유일한 id를 만든다.
export const projectCommandInputSchema = z.strictObject({
  id: projectCommandIdSchema.optional(),
  name: projectCommandNameSchema,
  command: projectCommandScriptSchema,
  kind: commandKindSchema.default("action"),
  description: z.string().trim().max(200).optional(),
  folder_ref: z.string().min(1).max(80).optional(),
  cwd: projectCommandCwdSchema.optional(),
  env: projectCommandEnvSchema.optional(),
  preview_url: projectCommandPreviewUrlSchema.optional(),
  auto_open_preview: z.boolean().optional(),
  timeout_ms: projectCommandTimeoutSchema.optional(),
  agents: projectCommandAgentsSchema.optional(),
  ask_before_run: z.boolean().optional(),
});
export type ProjectCommandInput = z.infer<typeof projectCommandInputSchema>;

// 명령을 고칠 때의 부분 패치. null은 해당 선택 필드를 지운다.
export const projectCommandPatchSchema = z.strictObject({
  name: projectCommandNameSchema.optional(),
  command: projectCommandScriptSchema.optional(),
  kind: commandKindSchema.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  folder_ref: z.string().min(1).max(80).nullable().optional(),
  cwd: projectCommandCwdSchema.nullable().optional(),
  env: projectCommandEnvSchema.nullable().optional(),
  preview_url: projectCommandPreviewUrlSchema.nullable().optional(),
  auto_open_preview: z.boolean().optional(),
  timeout_ms: projectCommandTimeoutSchema.nullable().optional(),
  // 아래 둘은 사람만 쓴다. agent가 넣으면 forbidden이다.
  agents: projectCommandAgentsSchema.nullable().optional(),
  ask_before_run: z.boolean().nullable().optional(),
});
export type ProjectCommandPatch = z.infer<typeof projectCommandPatchSchema>;

export const RUN_STATUSES = [
  "idle",
  "starting",
  "running",
  "succeeded",
  "failed",
  "stopped",
  "timed_out",
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const RUN_ENDED_BY = [
  "process",
  "user",
  "agent",
  "timeout",
  "shutdown",
] as const;
export const runEndedBySchema = z.enum(RUN_ENDED_BY);
export type RunEndedBy = z.infer<typeof runEndedBySchema>;

export const projectCommandRunSchema = z.strictObject({
  run_id: idSchema("pcr"),
  project_id: idSchema("prj"),
  command_id: projectCommandIdSchema,
  status: runStatusSchema,
  terminal_id: terminalRefSchema.nullable(),
  pid: z.number().int().nullable(),
  started_at: atSchema,
  ended_at: atSchema.nullable(),
  exit_code: z.number().int().nullable(),
  signal: z.string().nullable(),
  detected_urls: z.array(z.string()).max(PROJECT_COMMAND_DETECTED_URLS_MAX),
  ended_by: runEndedBySchema.nullable(),
  worktree_id: idSchema("wkt").nullable().optional(),
});
export type ProjectCommandRun = z.infer<typeof projectCommandRunSchema>;

export const detectedCommandCandidateSchema = z.strictObject({
  id: projectCommandIdSchema,
  name: projectCommandNameSchema,
  command: projectCommandScriptSchema,
  kind: commandKindSchema,
  description: z.string().trim().max(200).optional(),
  folder_ref: z.string().min(1).max(80).optional(),
  cwd: projectCommandCwdSchema.optional(),
  env: projectCommandEnvSchema.optional(),
  preview_url: projectCommandPreviewUrlSchema.optional(),
  source: z.string().min(1).max(120),
  already_registered: z.boolean(),
});
export type DetectedCommandCandidate = z.infer<
  typeof detectedCommandCandidateSchema
>;

export const detectResultSchema = z.strictObject({
  candidates: z.array(detectedCommandCandidateSchema),
  unsupported_notes: z.array(z.string()),
});
export type DetectResult = z.infer<typeof detectResultSchema>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

// project의 명령 정의, 현재 실행(및 마지막 결과) 목록, project agent 설정을 읽는다.
// `include_env: true`는 이 컴퓨터의 사람 자격(Settings 화면)에만 `env` 값을 싣고, agent·원격 기기에는 무시한다.
// `can_run`은 이 호출자가 이 컴퓨터에서 명령을 실행할 수 있는지(로컬은 true, 원격 기기는 터미널 입력 허락 여부)다.
export const projectCommandsList = defineRead({
  resource: "project_commands",
  method: "list",
  name: "ProjectCommandsList",
  input: z.strictObject({
    project: idSchema("prj"),
    include_env: z.boolean().optional(),
  }),
  output: z.strictObject({
    commands: z.array(projectCommandSchema),
    runs: z.array(projectCommandRunSchema),
    settings: projectCommandSettingsSchema,
    can_run: z.boolean(),
  }),
  reads: [{ name: "project_commands", id: (input) => input.project }],
  actors: ["user", "agent"],
  errors,
});

export const projectCommandsAdd = defineMemory({
  resource: "project_commands",
  method: "add",
  name: "ProjectCommandsAdd",
  changes: [{ name: "project_commands", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    command: projectCommandInputSchema,
    tool_call: idSchema("tcl").optional(),
  }),
  output: z.strictObject({ command: projectCommandSchema }),
  actors: ["user", "agent"],
  errors,
});

export const projectCommandsUpdate = defineMemory({
  resource: "project_commands",
  method: "update",
  name: "ProjectCommandsUpdate",
  changes: [{ name: "project_commands", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    id: projectCommandIdSchema,
    patch: projectCommandPatchSchema,
    tool_call: idSchema("tcl").optional(),
  }),
  output: z.strictObject({ command: projectCommandSchema }),
  actors: ["user", "agent"],
  errors,
});

export const projectCommandsRemove = defineMemory({
  resource: "project_commands",
  method: "remove",
  name: "ProjectCommandsRemove",
  changes: [{ name: "project_commands", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    id: projectCommandIdSchema,
    tool_call: idSchema("tcl").optional(),
  }),
  output: z.strictObject({ removed: z.boolean() }),
  actors: ["user", "agent"],
  errors,
});

export const projectCommandsReorder = defineMemory({
  resource: "project_commands",
  method: "reorder",
  name: "ProjectCommandsReorder",
  changes: [{ name: "project_commands", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    ids: z.array(projectCommandIdSchema).max(PROJECT_COMMANDS_MAX),
  }),
  output: z.strictObject({ commands: z.array(projectCommandSchema) }),
  actors: ["user"],
  errors,
});

// 감지 결과나 기존 layout 명령을 여러 개 한 번에 가져온다(사람만). 이미 있는 id는 건너뛴다.
export const projectCommandsImport = defineMemory({
  resource: "project_commands",
  method: "import",
  name: "ProjectCommandsImport",
  changes: [{ name: "project_commands", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    commands: z
      .array(projectCommandInputSchema)
      .min(1)
      .max(PROJECT_COMMANDS_MAX),
  }),
  output: z.strictObject({
    added: z.array(projectCommandSchema),
    skipped: z.array(z.string()),
  }),
  actors: ["user"],
  errors,
});

// project의 agent 설정(쓸 수 있는 agent, ask before run, 정의 쓰기 승인)을 바꾼다. 사람만 쓴다.
export const projectCommandsSetSettings = defineMemory({
  resource: "project_commands",
  method: "set_settings",
  name: "ProjectCommandsSetSettings",
  changes: [{ name: "project_commands", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    settings: projectCommandSettingsSchema,
  }),
  output: z.strictObject({ settings: projectCommandSettingsSchema }),
  actors: ["user"],
  errors,
});

// 등록 폴더를 읽기만 해서 후보를 찾는다. 저절로 등록하지 않는다.
export const projectCommandsDetect = defineRead({
  resource: "project_commands",
  method: "detect",
  name: "ProjectCommandsDetect",
  input: z.strictObject({ project: idSchema("prj") }),
  output: detectResultSchema,
  actors: ["user", "agent"],
  errors,
});

// 명령을 실행한다. `command`는 id 또는 이름이다. 이미 실행 중이면 `conflict`다.
// `wait: true`는 action이 끝날 때까지 기다려 최종 상태와 보존 꼬리 로그를 함께 돌려준다.
export const projectCommandsRun = defineMemory({
  resource: "project_commands",
  method: "run",
  name: "ProjectCommandsRun",
  changes: [],
  input: z.strictObject({
    project: idSchema("prj"),
    command: z.string().trim().min(1).max(120),
    worktree_id: idSchema("wkt").optional(),
    wait: z.boolean().optional(),
    tool_call: idSchema("tcl").optional(),
  }),
  output: z.strictObject({
    run: projectCommandRunSchema,
    tail: z.string().optional(),
  }),
  actors: ["user", "agent"],
  errors,
});

// 명령을 멈춘다(`command` 하나 또는 `all: true`로 project 전체). 프로세스 트리 종료 완료 뒤 돌려준다.
// `dismiss: true`면 끝난·실패 실행 상태와 터미널 참조까지 정리해 idle로 되돌린다(터미널 탭 닫기·사이드바 지우기).
export const projectCommandsStop = defineMemory({
  resource: "project_commands",
  method: "stop",
  name: "ProjectCommandsStop",
  changes: [],
  input: z
    .strictObject({
      project: idSchema("prj"),
      command: z.string().trim().min(1).max(120).optional(),
      all: z.boolean().optional(),
      dismiss: z.boolean().optional(),
    })
    .refine((value) => value.all === true || value.command !== undefined, {
      message: "specify command or all: true",
    }),
  output: z.strictObject({ runs: z.array(projectCommandRunSchema) }),
  actors: ["user", "agent"],
  errors,
});

// 명령별 직렬 큐에서 멈춤 → 최신 정의로 다시 시작을 수행한다.
export const projectCommandsRestart = defineMemory({
  resource: "project_commands",
  method: "restart",
  name: "ProjectCommandsRestart",
  changes: [],
  input: z.strictObject({
    project: idSchema("prj"),
    command: z.string().trim().min(1).max(120),
    worktree_id: idSchema("wkt").optional(),
    wait: z.boolean().optional(),
    tool_call: idSchema("tcl").optional(),
  }),
  output: z.strictObject({
    run: projectCommandRunSchema,
    tail: z.string().optional(),
  }),
  actors: ["user", "agent"],
  errors,
});

// 실행 중 링버퍼 또는 종료 후 보존 꼬리(200줄/32 KiB)를 읽는다. agent 호출 시 비밀값 마스킹을 거친다.
export const projectCommandsLogs = defineRead({
  resource: "project_commands",
  method: "logs",
  name: "ProjectCommandsLogs",
  input: z.strictObject({
    project: idSchema("prj"),
    command: z.string().trim().min(1).max(120),
    lines: z.number().int().min(1).max(1000).optional(),
  }),
  output: z.strictObject({
    run: projectCommandRunSchema.nullable(),
    lines: z.array(z.string()),
    truncated: z.boolean(),
  }),
  actors: ["user", "agent"],
  errors,
});

// core 내부 machine 전용 ledger 쓰기 command. main thread가 검증·승인 뒤에 원자적으로 저장한다.
export const projectCommandsStore = defineCommand({
  resource: "project_commands",
  method: "store",
  name: "ProjectCommandsStore",
  changes: [{ name: "project_commands", id: (input) => input.project }],
  input: z.strictObject({
    project: idSchema("prj"),
    commands: z
      .array(projectCommandSchema)
      .max(PROJECT_COMMANDS_MAX)
      .optional(),
    settings: projectCommandSettingsSchema.optional(),
  }),
  compare: z.strictObject({}),
  output: z.strictObject({ saved: z.literal(true) }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const PROJECT_COMMAND_MEMORY_ROUTES = [
  projectCommandsAdd,
  projectCommandsUpdate,
  projectCommandsRemove,
  projectCommandsReorder,
  projectCommandsImport,
  projectCommandsSetSettings,
  projectCommandsRun,
  projectCommandsStop,
  projectCommandsRestart,
] as const;

export const PROJECT_COMMAND_READ_ROUTES = [
  projectCommandsList,
  projectCommandsDetect,
  projectCommandsLogs,
] as const;

export const PROJECT_COMMAND_ROUTES = [
  ...PROJECT_COMMAND_READ_ROUTES,
  ...PROJECT_COMMAND_MEMORY_ROUTES,
  projectCommandsStore,
] as const;
