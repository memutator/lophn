import { z } from "zod";
import {
  atSchema,
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  seqSchema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  agentRoleSchema,
  workPlaceOutputSchema,
  workPlaceSchema,
} from "./scope.ts";
import { positiveRevisionSchema, readCursorSchema } from "./run-values.ts";

const continuationFields = {
  session: idSchema("ses"),
  through_seq: seqSchema,
};

export const continuationSchema = z.strictObject(continuationFields);
export const continuationOutputSchema = z.object(continuationFields);

export const SESSION_STATES = ["open", "closed"] as const;
export const SESSION_CLOSED_REASONS = [
  "user_closed",
  "assignment_withdrawn",
] as const;

const sessionFields = {
  id: idSchema("ses"),
  assignment: idSchema("asg"),
  role: agentRoleSchema,
  work_place: workPlaceOutputSchema,
  work_place_revision: positiveRevisionSchema,
  state: z.enum(SESSION_STATES),
  continued_from: continuationOutputSchema.nullable(),
  closed_reason: z.enum(SESSION_CLOSED_REASONS).nullable(),
  closed_at: atSchema.nullable(),
  state_seq: seqSchema,
};

export const sessionRecordSchema = z.object(sessionFields).refine((value) => {
  const closed = value.state === "closed";
  if ((value.closed_reason !== null) !== closed) return false;
  if ((value.closed_at !== null) !== closed) return false;
  if (
    value.continued_from !== null &&
    value.continued_from.session === value.id
  ) return false;
  if (value.role === "app_engineer") {
    return value.work_place.kind === "app";
  }
  if (value.role === "operator") return value.work_place.kind !== "global";
  return true;
}, { message: "session close or work place is not coupled" });

export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type Session = SessionRecord;

export const openSessionInputSchema = z.strictObject({
  id: idSchema("ses"),
  assignment: idSchema("asg"),
  role: agentRoleSchema,
  work_place: workPlaceSchema,
  continued_from: continuationSchema.nullable(),
}).refine(
  (value) =>
    value.continued_from === null || value.continued_from.session !== value.id,
  { message: "a session cannot continue from itself" },
).refine((value) => {
  if (value.role === "app_engineer") return value.work_place.kind === "app";
  if (value.role === "operator") return value.work_place.kind !== "global";
  return true;
}, { message: "work place is outside the role" });

export const openSessionCompareSchema = z.strictObject({
  assignment_revision: positiveRevisionSchema,
  assignment_state: z.enum(["enabled", "paused"]),
});

export const changeSessionWorkPlaceInputSchema = z.strictObject({
  session: idSchema("ses"),
  work_place: workPlaceSchema,
});

export const changeSessionWorkPlaceCompareSchema = z.strictObject({
  state_seq: seqSchema,
  work_place_revision: positiveRevisionSchema,
  role: z.enum(["lophn", "context_engineer"]),
});

export const closeSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
  reason: z.enum(SESSION_CLOSED_REASONS),
});

export const closeSessionCompareSchema = z.strictObject({
  state_seq: seqSchema,
  state: z.literal("open"),
});

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unauthorized",
] as const;

export const openSession = defineCommand({
  resource: "sessions",
  method: "open",
  name: "OpenSession",
  input: openSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    state: z.literal("open"),
    work_place: workPlaceOutputSchema,
    work_place_revision: z.literal(1),
    state_seq: seqSchema,
  }),
  compare: openSessionCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const changeSessionWorkPlace = defineCommand({
  resource: "sessions",
  method: "change-work-place",
  name: "ChangeSessionWorkPlace",
  input: changeSessionWorkPlaceInputSchema,
  output: z.object({
    id: idSchema("ses"),
    work_place: workPlaceOutputSchema,
    work_place_revision: positiveRevisionSchema,
    state_seq: seqSchema,
  }),
  compare: changeSessionWorkPlaceCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const closeSession = defineCommand({
  resource: "sessions",
  method: "close",
  name: "CloseSession",
  input: closeSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    state: z.literal("closed"),
    reason: z.enum(SESSION_CLOSED_REASONS),
    closed_at: atSchema,
    state_seq: seqSchema,
  }),
  compare: closeSessionCompareSchema,
  actors: ["user", "machine"],
  errors: [
    "conflict",
    "forbidden",
    "unauthorized",
    "invalid_input",
    "not_found",
  ],
});

export const sessionRead = defineRead({
  resource: "sessions",
  method: "read",
  name: "ReadSession",
  input: z.strictObject({ session: idSchema("ses") }),
  output: withReadCommon(z.object({ session: sessionRecordSchema })).refine(
    (value) =>
      seqSchema.safeParse(value.session.state_seq).success &&
      seqSchema.safeParse(value.as_of_seq).success &&
      BigInt(value.session.state_seq) <= BigInt(value.as_of_seq),
    { message: "session state is newer than read snapshot" },
  ),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const sessionList = defineRead({
  resource: "sessions",
  method: "list",
  name: "ListSessions",
  input: z.strictObject({
    assignment: idSchema("asg").optional(),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(z.object({ sessions: z.array(sessionRecordSchema) }))
    .refine(
      (value) =>
        seqSchema.safeParse(value.as_of_seq).success &&
        value.sessions.every((session) =>
          seqSchema.safeParse(session.state_seq).success &&
          BigInt(session.state_seq) <= BigInt(value.as_of_seq)
        ),
      { message: "session state is newer than read snapshot" },
    ),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

const sessionSubject = idSchema("ses");

export const sessionOpened = defineEvent("SessionOpened", {
  subject: sessionSubject,
  payload: z.object({
    assignment: idSchema("asg"),
    role: agentRoleSchema,
    work_place: workPlaceOutputSchema,
    work_place_revision: z.literal(1),
    continued_from: continuationOutputSchema.nullable(),
  }),
});

export const sessionWorkPlaceChanged = defineEvent("SessionWorkPlaceChanged", {
  subject: sessionSubject,
  payload: z.object({
    before: z.object({
      work_place: workPlaceOutputSchema,
      work_place_revision: positiveRevisionSchema,
    }),
    after: z.object({
      work_place: workPlaceOutputSchema,
      work_place_revision: positiveRevisionSchema,
    }),
  }),
});

export const sessionClosed = defineEvent("SessionClosed", {
  subject: sessionSubject,
  payload: z.object({
    reason: z.enum(SESSION_CLOSED_REASONS),
    closed_at: atSchema,
  }),
});

export const SESSION_COMMANDS = [
  openSession,
  changeSessionWorkPlace,
  closeSession,
  sessionRead,
  sessionList,
] as const;

export const SESSION_EVENTS = [
  sessionOpened,
  sessionWorkPlaceChanged,
  sessionClosed,
] as const;
