import { z } from "zod";
import { readCursorSchema, seqSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { modelChoiceOutputSchema } from "./models.ts";
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

export const workspaceSessionSchema = z
  .object({
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
    state_seq: seqSchema,
  })
  .refine(
    (value) =>
      value.forked_from === null || value.forked_from.session !== value.id,
    { message: "fork origin is the session itself" },
  );
export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;

export const workspaceSessionOpen = defineCommand({
  resource: "sessions",
  method: "open",
  name: "OpenSession",
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
    z.object({ sessions: z.array(workspaceSessionSchema) }),
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
  workspaceSessionRead,
  workspaceSessionList,
  workspaceSessionCompactRequests,
] as const;
