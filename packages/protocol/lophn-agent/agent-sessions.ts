import { z } from "zod";
import { readCursorSchema, seqSchema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { modelChoiceOutputSchema } from "./models.ts";
import {
  agentRefOutputSchema,
  agentRefSchema,
  placeOutputSchema,
  rolePlaceFits,
} from "./places.ts";
import {
  compactionOutputSchema,
  forkOriginOutputSchema,
  openingContextOutputSchema,
  openingContextSchema,
  sessionTitleSchema,
} from "./sessions.ts";

// session 수명은 열림과 archive 둘이다. 지움은 상태가 아니라 record가 사라지는 것이다.
// archive, delete, fork, rename, compact, change model은 모양이 같아 sessions.ts 것을 쓴다.
const SESSION_LIFECYCLES = ["open", "archived"] as const;
const sessionLifecycleSchema = z.enum(SESSION_LIFECYCLES);

const agentSessionSchema = z.object({
  id: idSchema("ses"),
  agent: agentRefOutputSchema,
  // agent에서 나오는 편의 칸이다.
  place: placeOutputSchema.nullable(),
  title: sessionTitleSchema.nullable(),
  lifecycle: sessionLifecycleSchema,
  forked_from: forkOriginOutputSchema.nullable(),
  opening_context: openingContextOutputSchema.nullable(),
  // null이면 agent 기본값을 따른다. 다음 turn부터 resolve한다.
  model_selection: modelChoiceOutputSchema.nullable(),
  compaction: compactionOutputSchema.nullable(),
  state_seq: seqSchema,
}).refine(
  (value) =>
    rolePlaceFits(value.agent.role, value.place) &&
    (value.forked_from === null || value.forked_from.session !== value.id),
  { message: "session place does not fit its role or fork origin is itself" },
);
export type AgentSession = z.infer<typeof agentSessionSchema>;

const openAgentSessionInputSchema = z.strictObject({
  id: idSchema("ses"),
  agent: agentRefSchema,
  opening_context: openingContextSchema.nullable(),
});
const openAgentSessionCompareSchema = z.strictObject({});

const SESSION_ARCHIVED_CHOICES = ["exclude", "include", "only"] as const;
const listAgentSessionsInputSchema = z.strictObject({
  agent: agentRefSchema,
  archived: z.enum(SESSION_ARCHIVED_CHOICES).optional(),
  cursor: readCursorSchema.optional(),
});

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

export const openAgentSession = defineCommand({
  resource: "sessions",
  method: "open",
  name: "OpenSession",
  input: openAgentSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    lifecycle: z.literal("open"),
    place: placeOutputSchema.nullable(),
    state_seq: seqSchema,
  }),
  compare: openAgentSessionCompareSchema,
  actors: ["user"],
  errors: [...commandErrors],
});

export const agentSessionRead = defineRead({
  resource: "sessions",
  method: "read",
  name: "ReadSession",
  input: z.strictObject({ session: idSchema("ses") }),
  output: withReadCommon(z.object({ session: agentSessionSchema })),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

export const agentSessionList = defineRead({
  resource: "sessions",
  method: "list",
  name: "ListSessions",
  input: listAgentSessionsInputSchema,
  output: withReadCommon(z.object({ sessions: z.array(agentSessionSchema) })),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

// 옛 route와 이름이 같아 registry에는 올리지 않는다. places-sessions가 merge될 때 바꿔 끼운다.
export const AGENT_SESSION_ROUTES = [
  openAgentSession,
  agentSessionRead,
  agentSessionList,
] as const;
