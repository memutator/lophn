import { z } from "zod";
import {
  defineRead,
  idSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  readCursorSchema,
  runOutcomeOutputSchema,
  runRecordSchema,
  runStateSchema,
} from "./run-values.ts";

const runRef = { run: idSchema("run") };

export const runReadInputSchema = z.strictObject(runRef);

export const runListInputSchema = z.strictObject({
  assignment: idSchema("asg").optional(),
  state: runStateSchema.optional(),
  cursor: readCursorSchema.optional(),
});

export const runResultInputSchema = z.strictObject(runRef);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine", "coding_agent"] as const;

export const runRead = defineRead({
  resource: "runs",
  method: "read",
  name: "ReadRun",
  input: runReadInputSchema,
  output: withReadCommon(z.object({ run: runRecordSchema })).refine(
    (value) =>
      seqSchema.safeParse(value.run.state_seq).success &&
      seqSchema.safeParse(value.as_of_seq).success &&
      BigInt(value.run.state_seq) <= BigInt(value.as_of_seq),
    { message: "run state is newer than read snapshot" },
  ),
  actors: readActors,
  errors: [...readErrors],
});

export const runList = defineRead({
  resource: "runs",
  method: "list",
  name: "ListRuns",
  input: runListInputSchema,
  output: withReadCommon(z.object({ runs: z.array(runRecordSchema) })).refine(
    (value) =>
      seqSchema.safeParse(value.as_of_seq).success &&
      value.runs.every((run) =>
        seqSchema.safeParse(run.state_seq).success &&
        BigInt(run.state_seq) <= BigInt(value.as_of_seq)
      ),
    { message: "run state is newer than read snapshot" },
  ),
  actors: readActors,
  errors: [...readErrors],
});

export const runResult = defineRead({
  resource: "runs",
  method: "result",
  name: "ReadRunResult",
  input: runResultInputSchema,
  output: withReadCommon(z.object({
    run: idSchema("run"),
    state: runStateSchema,
    outcome: runOutcomeOutputSchema.nullable(),
    result: sha256Schema.nullable(),
  })).refine(
    (value) =>
      (value.outcome !== null) === (value.state === "finished") &&
      (value.result !== null) === (value.state === "finished"),
    {
      message: "only finished runs have a final outcome and result",
    },
  ),
  actors: readActors,
  errors: [...readErrors],
});

// 복구가 저장된 본문(run basis, model 응답, tool 결과)을 다시 읽는 길이다. 값은 core가 blob 바이트를
// 읽고 hash를 확인한 JSON 값이다. machine만 읽고 그 밖은 없는 대상과 똑같이 답한다.
// `handoff_content`는 handoff로 시작한 받는 run이 맡긴 내용(무엇·왜·제외·기대 결과)을 자기 요청으로
// 읽는 길이다. id는 받는 run이다.
export const RUN_BODY_KINDS = [
  "run_basis",
  "model_call_output",
  "tool_call_output",
  "handoff_content",
] as const;

const BODY_ID_PREFIX = {
  run_basis: "run_",
  model_call_output: "mcl_",
  tool_call_output: "tcl_",
  handoff_content: "run_",
} as const;

export const runBodyInputSchema = z.strictObject({
  kind: z.enum(RUN_BODY_KINDS),
  id: z.union([idSchema("run"), idSchema("mcl"), idSchema("tcl")]),
}).refine(
  (value) => value.id.startsWith(BODY_ID_PREFIX[value.kind]),
  { message: "body kind and id do not match" },
);

export const runBody = defineRead({
  resource: "runs",
  method: "body",
  name: "ReadRunBody",
  input: runBodyInputSchema,
  output: withReadCommon(z.object({
    kind: z.enum(RUN_BODY_KINDS),
    id: z.union([idSchema("run"), idSchema("mcl"), idSchema("tcl")]),
    run: idSchema("run"),
    hash: sha256Schema,
    size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    value: z.json(),
  })),
  actors: ["machine"],
  errors: [...readErrors],
});

// 사람 화면이 열어 보는 같은 저장 본문(run 근거·tool 입력·tool 결과)이다. ReadRunBody와 달리 사람만
// 읽고, core가 지금의 redaction(고정 검출 규칙과 알려진 secret 값)을 한 번 더 거친 값만 준다. 안전화를
// 끝내지 못하면 값을 주지 않는다. model 응답은 판단 요약이 아니라 사고 원문일 수 있어 사람에게 열지
// 않는다(observability#R22). 값이 상한을 넘으면 JSON 글의 앞부분만 주고 `truncated`로 알린다.
// 범위 밖 대상은 없는 대상과 똑같이 not_found다.
export const RUN_BODY_VIEW_KINDS = [
  "run_basis",
  "tool_call_input",
  "tool_call_output",
] as const;

const VIEW_ID_PREFIX = {
  run_basis: "run_",
  tool_call_input: "tcl_",
  tool_call_output: "tcl_",
} as const;

export const RUN_BODY_VIEW_MAX_BYTES = 64 * 1024;

export const runBodyViewInputSchema = z.strictObject({
  kind: z.enum(RUN_BODY_VIEW_KINDS),
  id: z.union([idSchema("run"), idSchema("tcl")]),
}).refine(
  (value) => value.id.startsWith(VIEW_ID_PREFIX[value.kind]),
  { message: "body kind and id do not match" },
);

export const runBodyView = defineRead({
  resource: "runs",
  method: "body-view",
  name: "ReadRunBodyView",
  input: runBodyViewInputSchema,
  output: withReadCommon(z.object({
    kind: z.enum(RUN_BODY_VIEW_KINDS),
    id: z.union([idSchema("run"), idSchema("tcl")]),
    run: idSchema("run"),
    size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    truncated: z.boolean(),
    value: z.json(),
  })),
  actors: ["user"],
  errors: [...readErrors],
});

export const RUN_READS = [
  runRead,
  runList,
  runResult,
  runBody,
  runBodyView,
] as const;
