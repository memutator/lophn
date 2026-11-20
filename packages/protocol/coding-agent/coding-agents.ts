import { z } from "zod";
import { defineMemory, defineRead } from "../base/route.ts";
import { harnessIdSchema } from "./harness-id.ts";

// Settings › Coding agents와 전역 hook 자동 설치다. core가 사람의 env로 harness를 찾고 전역 hook을 놓는다. token·경로 설정·credential은
// 여기 없다. 처음 알아본 harness에 hook이 없으면 묻지 않고 자동으로 놓으며(Settings에서 지운 harness는 opt-out으로 기억해 다시 놓지 않는다),
// 결과는 `HookInstallFinished`다.

export const harnessDiscoverySchema = z.enum([
  "unobserved",
  "detected",
  "absent",
  "unknown",
  "error",
]);
export type HarnessDiscovery = z.infer<typeof harnessDiscoverySchema>;

// Settings가 제품마다 보이는 값.
export const harnessSettingsViewSchema = z.strictObject({
  harness_id: harnessIdSchema,
  label: z.string(),
  discovery: harnessDiscoverySchema,
  version: z.string().nullable(),
  version_result: z.enum(["verified", "unknown", "error"]),
  can_deliver_messages: z.boolean(),
  // 감지한 때. 감지 결과를 읽지 못했으면 없다.
  observed_at: z.string().optional(),
  // 찾은 실행 파일 경로. 못 찾았으면 없거나 null이다.
  executable: z.string().nullable().optional(),
});
export type HarnessSettingsView = z.infer<typeof harnessSettingsViewSchema>;

// `unsupported`는 hook이 없는 제품이거나 이 실행에서 hook command를 못 정한 것이고, `failed`는 설정 file을 읽거나 쓰지 못한 것이다.
export const hookInstallStatusSchema = z.enum([
  "installed",
  "missing",
  "unsupported",
  "failed",
]);
export type HookInstallStatus = z.infer<typeof hookInstallStatusSchema>;

export const harnessHookViewSchema = z.strictObject({
  harness_id: harnessIdSchema,
  status: hookInstallStatusSchema,
  // missing이면 놓을 file, installed를 막 놓았으면 쓴 file, 막 지웠으면 고친 file의 절대 경로다.
  files: z.array(z.string()),
});
export type HarnessHookView = z.infer<typeof harnessHookViewSchema>;

// 자동 hook 설치의 끝. 실패하면 message가 까닭이고 files는 알면 문제의 file이다. running은 이미 도는 harness를 알아보고
// 놓았다는 것이다: harness는 hook을 시작할 때 읽어서 그 실행에는 상태가 보이지 않는다. terminal은 감지된 터미널 참조(있으면 그 탭이 있는 창이 toast를 보인다).
export const hookResultSchema = z.strictObject({
  harness: z.string().min(1),
  label: z.string(),
  ok: z.boolean(),
  files: z.array(z.string()),
  message: z.string().optional(),
  running: z.boolean(),
  terminal: z.string().min(1).optional(),
});
export type HookResult = z.infer<typeof hookResultSchema>;

// 감지나 설치가 실패해도 오류가 아니라 값(discovery `unknown`·`error`, hook status `failed`)으로 보인다.
const errors = ["invalid_input", "unauthorized", "forbidden"] as const;

// 제품마다 감지 결과. 처음에만 감지하고 이후는 마지막 결과다.
export const codingAgentsList = defineRead({
  resource: "coding_agents",
  method: "list",
  name: "CodingAgentsList",
  input: z.strictObject({}),
  output: z.strictObject({ harnesses: z.array(harnessSettingsViewSchema) }),
  actors: ["user"],
  errors,
});

// 다시 감지한다. 사람이 [Detect again]을 누를 때만 부른다.
export const codingAgentsRefresh = defineMemory({
  resource: "coding_agents",
  method: "refresh",
  name: "CodingAgentsRefresh",
  changes: [],
  input: z.strictObject({}),
  output: z.strictObject({ harnesses: z.array(harnessSettingsViewSchema) }),
  actors: ["user"],
  errors,
});

// 제품마다 전역 hook이 놓였는지 본다(dry run이라 아무것도 쓰지 않는다).
export const codingAgentsHookStatus = defineRead({
  resource: "coding_agents",
  method: "hook_status",
  name: "CodingAgentsHookStatus",
  input: z.strictObject({}),
  output: z.strictObject({ hooks: z.array(harnessHookViewSchema) }),
  actors: ["user"],
  errors,
});

// 사람이 Settings에서 [Install hooks]를 누를 때만 부른다. 누른 것이 허락이라 다시 묻지 않는다. 실패는 결과의 status다.
export const codingAgentsInstallHooks = defineMemory({
  resource: "coding_agents",
  method: "install_hooks",
  name: "CodingAgentsInstallHooks",
  changes: [],
  input: z.strictObject({ harness: harnessIdSchema }),
  output: z.strictObject({ hook: harnessHookViewSchema }),
  actors: ["user"],
  errors,
});

// 사람이 Settings에서 [Uninstall hooks]를 누를 때만 부른다. 우리 항목만 지운다.
export const codingAgentsUninstallHooks = defineMemory({
  resource: "coding_agents",
  method: "uninstall_hooks",
  name: "CodingAgentsUninstallHooks",
  changes: [],
  input: z.strictObject({ harness: harnessIdSchema }),
  output: z.strictObject({ hook: harnessHookViewSchema }),
  actors: ["user"],
  errors,
});

export const CODING_AGENT_ROUTES = [
  codingAgentsList,
  codingAgentsRefresh,
  codingAgentsHookStatus,
  codingAgentsInstallHooks,
  codingAgentsUninstallHooks,
] as const;
