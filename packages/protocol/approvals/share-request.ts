import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { agentIdSchema } from "../lophn-agent/workspaces.ts";
import { appIdSchema, slugSchema } from "../projects/values.ts";

// 앱 공유 요청. 앱 workspace의 agent가 "이 앱을 agent A, B(와 coding agent)에게 할당"을 청하면 사람이 대기 목록에서 한 번 승인한다.
// 승인하면 core가 그 agent 정의 파일의 `apps`에 앱 slug를 더하고(할당 쓰기 길 그대로), coding agent를 골랐으면
// 설정 `coding-agent.shared_apps`에 slug를 더한다. 이미 뺀 command(`permissions.deny`)는 건드리지 않는다.
// 요청은 ledger 표에 남아 turn과 재시작을 넘는다. 앱마다 열린 요청은 하나이고 새 요청이 옛 것을 대신한다.
// 남지 않는 event(`packages/protocol/events/transient.ts`): ShareRequestOpened { app, app_name },
//   ShareRequestClosed { app, outcome: "approve" | "reject" }.
// 설정이 바뀌면 SettingsChanged의 keys에 SHARED_APPS_SETTING_KEY가 실린다. coding agent 쪽 사본이 그 신호를 듣는다.

// coding agent에게 준 앱 slug 목록. 사람이 승인할 때만 더한다.
export const SHARED_APPS_SETTING_KEY = "coding-agent.shared_apps";
export const sharedAppsSettingSchema = z.array(slugSchema);
export const DEFAULT_SHARED_APPS_SETTING: z.infer<
  typeof sharedAppsSettingSchema
> = [];

const reasonSchema = z.string().trim().max(200);

export const shareRequestSchema = z.object({
  app: appIdSchema,
  // 사람에게 보일 이름. 알림과 대기 목록이 id 대신 쓴다.
  app_name: z.string().min(1),
  // 받을 agent. 이름은 읽을 때 푼 것이다.
  agents: z.array(z.object({ id: agentIdSchema, name: z.string().min(1) })),
  coding_agents: z.boolean(),
  reason: reasonSchema,
  // 요청을 연 session.
  session: idSchema("ses"),
  // 승인하면 다른 agent가 받게 되는 것. 지금 active 선언의 공개 skill과 공개 command 수다.
  public_skills: z.number().int().min(0),
  public_commands: z.number().int().min(0),
  requested_at: atSchema,
});
export type ShareRequest = z.infer<typeof shareRequestSchema>;

const CHOICES = ["approve", "reject"] as const;
const choiceSchema = z.enum(CHOICES);

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

// 앱은 입력에 없다. 앱 workspace의 credential이 고정한 앱이다(agent 자격만, 앱 workspace 밖이면 forbidden).
// 받을 agent도 coding agent도 없는 요청은 받지 않는다.
export const shareRequestOpen = defineCommand({
  resource: "share_requests",
  method: "open",
  name: "share_request.open",
  changes: [{ name: "share_requests", id: (_input, output) => output.app }],
  input: z
    .strictObject({
      agents: z.array(agentIdSchema).max(20),
      coding_agents: z.boolean(),
      reason: reasonSchema,
    })
    .refine((input) => input.agents.length > 0 || input.coding_agents, {
      message: "name at least one agent or coding agents",
    }),
  output: z.object({ app: appIdSchema, requested_at: atSchema }),
  actors: ["agent"],
  errors: [...errors],
});

// 사람만 정한다. compare의 requested_at이 지금 열린 요청의 값과 다르거나 요청이 없으면 conflict다
// (그 사이 새 요청이 대신했거나 이미 정해졌다). 거절은 이유를 싣지 않는다.
export const shareRequestDecide = defineCommand({
  resource: "share_requests",
  method: "decide",
  name: "share_request.decide",
  changes: [{ name: "share_requests", id: (input) => input.app }, "agents"],
  input: z.strictObject({ app: appIdSchema, choice: choiceSchema }),
  compare: z.strictObject({ requested_at: atSchema }),
  output: z.object({ app: appIdSchema, outcome: choiceSchema }),
  actors: ["user"],
  errors: [...errors],
});

export const shareRequestList = defineRead({
  resource: "share_requests",
  method: "list",
  name: "share_requests.list",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ requests: z.array(shareRequestSchema) })),
  actors: ["user", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const SHARE_REQUEST_ROUTES = [
  shareRequestOpen,
  shareRequestDecide,
  shareRequestList,
] as const;
