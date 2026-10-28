import { z } from "zod";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, readCursorSchema, seqSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  agentAddressSchema,
  agentAtPlaceOutputSchema,
  agentAtPlaceSchema,
  agentIdSchema,
} from "../lophn-agent/places.ts";
import {
  invocationIdSchema,
  jsonValueSchema,
  toolNameSchema,
} from "../apps/channel-values.ts";
import { appIdSchema } from "../projects/values.ts";

export const RUN_KINDS = ["agent", "tool"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_STATES = ["running", "done", "failed", "cancelled"] as const;
export type RunState = (typeof RUN_STATES)[number];

// run이 실패한 이유. 경계의 오류 코드(일곱)가 아니라 run 기록의 칸이다.
export const RUN_FAIL_REASONS = [
  "invalid_output", // schema를 주었는데 답이 JSON이 아니거나 schema에 맞지 않는다
  "no_answer", // turn이 completed로 끝났는데 그 turn의 답 글이 없다
  "turn_failed", // turn outcome이 failed다. message에 outcome reason
  "turn_interrupted", // turn이 user_stopped·session_ended로 끝났다
  "start_failed", // session을 열거나 메시지를 넣지 못했다. message에 오류 code
  "tool_failed", // 앱 handler 오류. message에 앱 오류 code와 글
  "tool_denied", // handler까지 가지 못했다. message에 denial code
  "tool_unknown", // 결과를 모른다. message에 unknown reason
  "lophn_restarted", // 끝나기 전에 lophn이 꺼졌다 켜졌다(turn이 restarted로 끝남 포함)
] as const;
export type RunFailReason = (typeof RUN_FAIL_REASONS)[number];

// run을 만들 때 기록하는 place. agent run은 그 agent의 place(lophn은 없다), tool run은 그 앱이다.
export const runPlaceSchema = z.union([
  z.strictObject({ project: idSchema("prj") }),
  z.strictObject({ app: idSchema("app") }),
]);
export type RunPlace = z.infer<typeof runPlaceSchema>;

const outputSchemaSchema = z.record(z.string(), z.json());

type RunTarget = { agent: unknown } | { app: string; tool: string };

// run 기록과 CreateRun 입력이 같이 쓴다. kind와 target, agent에만 있는 칸이 맞는가.
function kindFits(v: {
  kind: RunKind;
  target: RunTarget;
  session: string | null;
  session_opened: boolean;
  input_message: string | null;
  schema: unknown;
}): boolean {
  if (v.kind === "agent") return "agent" in v.target;
  return (
    "app" in v.target &&
    v.session === null &&
    !v.session_opened &&
    v.input_message === null &&
    v.schema === null
  );
}

const notJobAndInstance = (v: { job: unknown; instance: unknown }) =>
  v.job === null || v.instance === null;
const NOT_BOTH = { message: "a run has a job or an instance, not both" };

const KIND_MESSAGE = { message: "run kind does not fit its target and fields" };

export const runRecordSchema = z
  .object({
    id: idSchema("run"),
    kind: z.enum(RUN_KINDS),
    // agent: 이름을 푼 (agent, place). tool: 앱과 tool 이름.
    target: z.union([
      z.object({ agent: agentAtPlaceOutputSchema }),
      z.object({ app: appIdSchema, tool: toolNameSchema }),
    ]),
    session: idSchema("ses").nullable(), // agent만. run이 연 session 또는 --session
    session_opened: z.boolean(), // run이 session을 열었다. 화면은 이것만 run 아래에 묶는다
    input_message: idSchema("msg").nullable(), // agent만. run이 넣은 메시지
    turn: idSchema("trn").nullable(), // agent만. 그 메시지가 연 turn. 끝을 안 뒤에 채운다
    invocation: invocationIdSchema.nullable(), // tool만. 기록이 없는 성공한 읽기면 null
    schema: z.json().nullable(), // agent만. 출력 JSON Schema
    state: z.enum(RUN_STATES),
    // done의 값. agent: 답 글(string), schema가 있으면 읽은 JSON 값. tool: tool 결과.
    result: z.json().nullable(),
    error: z
      .object({
        reason: z.enum(RUN_FAIL_REASONS),
        message: z.string(),
      })
      .nullable(), // failed만
    job: idSchema("job").nullable(), // job이 연 run만 값이 있다
    instance: idSchema("wfi").nullable(), // flow instance가 연 run만 값이 있다
    created_at: atSchema,
    finished_at: atSchema.nullable(), // running이 아니면 있다
    state_seq: seqSchema,
  })
  .refine(
    (v) =>
      kindFits(v) &&
      (v.kind === "agent" || v.turn === null) &&
      (v.kind === "tool" || v.invocation === null),
    KIND_MESSAGE,
  )
  .refine(notJobAndInstance, NOT_BOTH)
  .refine((v) => (v.error !== null) === (v.state === "failed"), {
    message: "only failed runs have an error",
  })
  .refine((v) => (v.finished_at !== null) === (v.state !== "running"), {
    message: "only finished runs have finished_at",
  });
export type RunRecord = z.infer<typeof runRecordSchema>;

const runRef = { run: idSchema("run") };

const startRunInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("agent"),
    agent: agentAddressSchema.optional(), // session과 정확히 하나
    session: idSchema("ses").optional(), // 이어 쓰는 열린 session
    prompt: z.string().min(1),
    input: jsonValueSchema.optional(), // agent에게 보이는 입력 JSON
    schema: outputSchemaSchema.optional(), // 출력 JSON Schema 객체
  }),
  z.strictObject({
    kind: z.literal("tool"),
    app: z.string().min(1), // app id 또는 정확한 slug·이름
    tool: toolNameSchema,
    input: jsonValueSchema.optional(),
  }),
]);

// agent·session이 정확히 하나인지와 schema를 읽을 수 있는지는 core가 본다.
// 그 판정을 두 곳에 두지 않으려고 입력 schema에 refine을 두지 않는다.
// 이름을 다 풀고 나서 session을 연다. 안 풀린 시도는 session도 run도 남기지 않는다.
export const runStart = defineMemory({
  resource: "runs",
  method: "start",
  name: "StartRun",
  input: startRunInputSchema,
  output: z.object({ run: runRecordSchema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "not_found",
    "conflict",
    "forbidden",
    "unauthorized",
    "unavailable",
  ],
});

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const runRead = defineRead({
  resource: "runs",
  method: "read",
  name: "ReadRun",
  input: z.strictObject(runRef),
  output: withReadCommon(z.object({ run: runRecordSchema })),
  actors: ["user"],
  errors: [...readErrors],
});

// 새것이 앞이다. 화면이 project sidebar와 앱 공간마다 session event 때 읽고 job이 run을 많이 만들어서,
// 거르기를 core에서 해 읽기를 작게 둔다. `agent`는 그 agent의 run(place와 상관없다), `place`는 만들 때
// 기록한 place다(그 place의 agent run과 그 앱의 tool run). 준 칸은 모두 맞아야 한다(AND).
export const runList = defineRead({
  resource: "runs",
  method: "list",
  name: "ListRuns",
  input: z.strictObject({
    session: idSchema("ses").optional(),
    agent: agentIdSchema.optional(),
    place: runPlaceSchema.optional(),
    state: z.enum(RUN_STATES).optional(),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(z.object({ runs: z.array(runRecordSchema) })),
  actors: ["user"],
  errors: [...readErrors],
});

// 끝났거나 timeout_ms가 지나면 돌려준다(그때는 running).
export const RUN_WAIT_MAX_MS = 60_000;

export const runWait = defineMemory({
  resource: "runs",
  method: "wait",
  name: "WaitRun",
  input: z.strictObject({
    ...runRef,
    timeout_ms: z.number().int().min(1).max(RUN_WAIT_MAX_MS),
  }),
  output: z.object({ run: runRecordSchema }),
  actors: ["user"],
  errors: [...readErrors],
});

export const runCancel = defineMemory({
  resource: "runs",
  method: "cancel",
  name: "CancelRun",
  input: z.strictObject(runRef),
  output: z.object({ run: runRecordSchema }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

const createTargetSchema = z.union([
  z.strictObject({ agent: agentAtPlaceSchema }),
  z.strictObject({ app: appIdSchema, tool: toolNameSchema }),
]);

// agent_key와 place_key는 target에서 만든다. run 기록에는 place를 싣지 않는다.
export const runCreate = defineCommand({
  resource: "runs",
  method: "create",
  name: "CreateRun",
  input: z
    .strictObject({
      id: idSchema("run"),
      kind: z.enum(RUN_KINDS),
      target: createTargetSchema,
      session: idSchema("ses").nullable(),
      session_opened: z.boolean(),
      input_message: idSchema("msg").nullable(),
      schema: outputSchemaSchema.nullable(),
      job: idSchema("job").nullable(),
      instance: idSchema("wfi").nullable(),
    })
    .refine(kindFits, KIND_MESSAGE)
    .refine(notJobAndInstance, NOT_BOTH),
  output: z.object({ run: runRecordSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "conflict"],
});

export const runSettle = defineCommand({
  resource: "runs",
  method: "settle",
  name: "SettleRun",
  input: z
    .strictObject({
      ...runRef,
      state: z.enum(["done", "failed", "cancelled"]),
      turn: idSchema("trn").optional(),
      invocation: invocationIdSchema.nullable().optional(),
      result: z.json().optional(),
      error: z
        .strictObject({
          reason: z.enum(RUN_FAIL_REASONS),
          message: z.string(),
        })
        .optional(),
    })
    .refine((v) => (v.error !== undefined) === (v.state === "failed"), {
      message: "only failed runs have an error",
    })
    .refine((v) => v.result === undefined || v.state === "done", {
      message: "only done runs have a result",
    }),
  output: z.object({ run: runRecordSchema }),
  compare: z.strictObject({ state: z.literal("running") }),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ],
});

export const RUN_ROUTES = [
  runStart,
  runRead,
  runList,
  runWait,
  runCancel,
  runCreate,
  runSettle,
] as const;
