import { z } from "zod";
import { readCursorSchema, seqSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { modelChoiceOutputSchema } from "./models.ts";
import { HARNESS_RUNTIMES } from "./agent-values.ts";
import {
  agentIdSchema,
  workspaceSchema,
  workspaceOutputSchema,
} from "./workspaces.ts";
import {
  compactionOutputSchema,
  forkOriginOutputSchema,
  sessionTitleSchema,
} from "./sessions.ts";

// session 수명은 열림과 archive 둘이다. 지움은 상태가 아니라 record가 사라지는 것이다.
// archive, delete, fork, rename, compact, change model은 모양이 같아 sessions.ts 것을 쓴다.
const SESSION_LIFECYCLES = ["open", "archived"] as const;
const sessionLifecycleSchema = z.enum(SESSION_LIFECYCLES);

const SESSION_ARCHIVED_CHOICES = ["exclude", "include", "only"] as const;
const commandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unauthorized",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const workspaceSessionObject = z.object({
  id: idSchema("ses"),
  agent: agentIdSchema,
  // null이면 home이다. session을 열 때 정해지고 바뀌지 않는다.
  workspace: workspaceOutputSchema.nullable(),
  title: sessionTitleSchema.nullable(),
  lifecycle: sessionLifecycleSchema,
  forked_from: forkOriginOutputSchema.nullable(),
  // null이면 agent 기본값을 따른다. 다음 turn부터 resolve한다.
  model_selection: modelChoiceOutputSchema.nullable(),
  compaction: compactionOutputSchema.nullable(),
  // 사람이 켠 동안 이 session의 turn은 허락을 묻지 않는다(deny는 막는다). 바꾸면 다음 turn부터 닿는다.
  skip: z.boolean(),
  // 다른 workspace의 session이 불러 열린 session이면 그 workspace. home에 열린 그런 session은 폴더를 읽지 않는다.
  called_from: workspaceOutputSchema.nullable(),
  // `team spawn`으로 열린 session이면 연 session(팀의 부모). 열 때 정해 바뀌지 않는다. null이면 팀 밖이거나 팀의 root다.
  spawned_by: idSchema("ses").nullable(),
  // 앱이 열었으면 그 앱. 앱은 자기가 연 session만 끝낼 수 있다. 앱 화면이 연 session은 turn 끝 알림을 거른다. 열 때 정해 바뀌지 않는다.
  opened_by_app: idSchema("app").nullable(),
  // runtime이 harness인 agent의 session이면 그 harness. 열 때 정해 바뀌지 않는다.
  harness: z.enum(HARNESS_RUNTIMES).nullable(),
  state_seq: seqSchema,
});

// extend는 refine을 단 schema에 못 쓰므로 refine을 따로 둔다.
const forkOriginIsOther = {
  check: (value: z.infer<typeof workspaceSessionObject>) =>
    value.forked_from === null || value.forked_from.session !== value.id,
  message: { message: "fork origin is the session itself" },
};

export const workspaceSessionSchema = workspaceSessionObject.refine(
  forkOriginIsOther.check,
  forkOriginIsOther.message,
);
export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;

// 목록은 session마다 마지막 활동 시각을 더 준다. 화면이 session마다 turn을 읽지 않게 한다.
export const workspaceSessionListItemSchema = workspaceSessionObject
  .extend({
    // 마지막 turn이 끝난(없으면 시작한) 시각. turn이 없으면 null이다.
    last_active_at: z.string().nullable(),
  })
  .refine(forkOriginIsOther.check, forkOriginIsOther.message);
export type WorkspaceSessionListItem = z.infer<
  typeof workspaceSessionListItemSchema
>;

export const workspaceSessionOpen = defineCommand({
  resource: "sessions",
  method: "open",
  name: "OpenSession",
  changes: [{ name: "sessions", id: (_input, output) => output.id }],
  input: z.strictObject({
    id: idSchema("ses"),
    agent: agentIdSchema,
    workspace: workspaceSchema.nullable(),
  }),
  output: z.object({
    id: idSchema("ses"),
    lifecycle: z.literal("open"),
    workspace: workspaceOutputSchema.nullable(),
    state_seq: seqSchema,
  }),
  compare: z.strictObject({}),
  actors: ["user"],
  errors: [...commandErrors],
});

// 앱 화면이 연 session. `opened_by_app`을 다는 길은 이것뿐이다(앱은 자기가 연 session만 끝낼 수 있어 사람 자격의 OpenSession이 표시를 달 수
// 있으면 안 된다). core의 앱 wiring이 앱을 정해 core 안 machine 자격으로 부른다.
export const workspaceSessionAppOpen = defineCommand({
  resource: "sessions",
  method: "app-open",
  name: "OpenAppSession",
  changes: [{ name: "sessions", id: (_input, output) => output.id }],
  input: z.strictObject({
    id: idSchema("ses"),
    agent: agentIdSchema,
    workspace: workspaceSchema,
    app: idSchema("app"),
  }),
  output: z.object({
    id: idSchema("ses"),
    lifecycle: z.literal("open"),
    workspace: workspaceOutputSchema.nullable(),
    state_seq: seqSchema,
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: [...commandErrors],
});

export const workspaceSessionRead = defineRead({
  resource: "sessions",
  method: "read",
  name: "ReadSession",
  input: z.strictObject({ session: idSchema("ses") }),
  output: withReadCommon(z.object({ session: workspaceSessionSchema })),
  actors: ["user", "agent", "machine"],
  errors: [...readErrors],
});

export const workspaceSessionList = defineRead({
  resource: "sessions",
  method: "list",
  name: "ListSessions",
  input: z.strictObject({
    agent: agentIdSchema,
    workspace: workspaceSchema.nullable(),
    archived: z.enum(SESSION_ARCHIVED_CHOICES).optional(),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(
    z.object({ sessions: z.array(workspaceSessionListItemSchema) }),
  ),
  actors: ["user", "agent", "machine"],
  errors: [...readErrors],
});

export const workspaceSessionCompactRequests = defineRead({
  resource: "sessions",
  method: "compact-requests",
  name: "ListSessionCompactRequests",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      requests: z.array(
        z.object({
          session: idSchema("ses"),
          agent: agentIdSchema,
          workspace: workspaceOutputSchema.nullable(),
          request_seq: seqSchema,
        }),
      ),
    }),
  ),
  actors: ["machine"],
  errors: [...readErrors],
});

export const WORKSPACE_SESSION_ROUTES = [
  workspaceSessionOpen,
  workspaceSessionAppOpen,
  workspaceSessionRead,
  workspaceSessionList,
  workspaceSessionCompactRequests,
] as const;
