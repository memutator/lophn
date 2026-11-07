import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineRead } from "../base/route.ts";
import { readCursorSchema, sha256Schema } from "../base/values.ts";
import {
  turnOutcomeOutputSchema,
  turnRecordSchema,
  turnStateSchema,
} from "./turn-values.ts";

const turnRef = { turn: idSchema("trn") };

const turnReadInputSchema = z.strictObject(turnRef);

const turnListInputSchema = z.strictObject({
  session: idSchema("ses").optional(),
  state: turnStateSchema.optional(),
  cursor: readCursorSchema.optional(),
});

const turnResultInputSchema = z.strictObject(turnRef);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine"] as const;

export const turnRead = defineRead({
  resource: "turns",
  method: "read",
  name: "ReadTurn",
  input: turnReadInputSchema,
  output: withReadCommon(z.object({ turn: turnRecordSchema })),
  actors: readActors,
  errors: [...readErrors],
});

export const turnList = defineRead({
  resource: "turns",
  method: "list",
  name: "ListTurns",
  input: turnListInputSchema,
  output: withReadCommon(z.object({ turns: z.array(turnRecordSchema) })),
  actors: readActors,
  errors: [...readErrors],
});

export const turnResult = defineRead({
  resource: "turns",
  method: "result",
  name: "ReadTurnResult",
  input: turnResultInputSchema,
  output: withReadCommon(
    z.object({
      turn: idSchema("trn"),
      state: turnStateSchema,
      outcome: turnOutcomeOutputSchema.nullable(),
      result: sha256Schema.nullable(),
    }),
  ).refine(
    (value) =>
      (value.outcome !== null) === (value.state === "finished") &&
      (value.result !== null) === (value.state === "finished"),
    {
      message: "only finished turns have a final outcome and result",
    },
  ),
  actors: readActors,
  errors: [...readErrors],
});

// 복구가 저장된 본문(turn basis, model 응답, tool 결과)을 다시 읽는 길이다. 값은 core가 blob 바이트를
// 읽고 hash를 확인한 JSON 값이다. machine만 읽고 그 밖은 없는 대상과 똑같이 답한다.
// `turn_resolved`는 turn 기준이 hash로 가리키는 resolved agent의 전체 값이다. `turn_history`는 turn이 마지막
// checkpoint에 남긴 turn 안 이력이다(다음 turn의 이전 대화가 읽는다).
const TURN_BODY_KINDS = [
  "turn_basis",
  "turn_resolved",
  "turn_history",
  "model_call_output",
  "tool_call_output",
] as const;

const BODY_ID_PREFIX = {
  turn_basis: "trn_",
  turn_resolved: "trn_",
  turn_history: "trn_",
  model_call_output: "mcl_",
  tool_call_output: "tcl_",
} as const;

export const turnBodyInputSchema = z
  .strictObject({
    kind: z.enum(TURN_BODY_KINDS),
    id: z.union([idSchema("trn"), idSchema("mcl"), idSchema("tcl")]),
  })
  .refine((value) => value.id.startsWith(BODY_ID_PREFIX[value.kind]), {
    message: "body kind and id do not match",
  });

export const turnBody = defineRead({
  resource: "turns",
  method: "body",
  name: "ReadTurnBody",
  input: turnBodyInputSchema,
  output: withReadCommon(
    z.object({
      kind: z.enum(TURN_BODY_KINDS),
      id: z.union([idSchema("trn"), idSchema("mcl"), idSchema("tcl")]),
      turn: idSchema("trn"),
      hash: sha256Schema,
      size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      value: z.json(),
    }),
  ),
  actors: ["machine"],
  errors: [...readErrors],
});

// 사람 화면이 열어 보는 같은 저장 본문(turn 근거·tool 입력·tool 결과)이다. ReadTurnBody와 달리 사람만
// 읽고, core가 지금의 redaction(고정 검출 규칙과 알려진 secret 값)을 한 번 더 거친 값만 준다. 안전화를
// 끝내지 못하면 값을 주지 않는다. model 응답은 판단 요약이 아니라 사고 원문일 수 있어 사람에게 열지
// 않는다. 값이 상한을 넘으면 JSON 글의 앞부분만 주고 `truncated`로 알린다.
// 범위 밖 대상은 없는 대상과 똑같이 not_found다.
const TURN_BODY_VIEW_KINDS = [
  "turn_basis",
  "tool_call_input",
  "tool_call_output",
] as const;

const VIEW_ID_PREFIX = {
  turn_basis: "trn_",
  tool_call_input: "tcl_",
  tool_call_output: "tcl_",
} as const;

export const TURN_BODY_VIEW_MAX_BYTES = 64 * 1024;

export const turnBodyViewInputSchema = z
  .strictObject({
    kind: z.enum(TURN_BODY_VIEW_KINDS),
    id: z.union([idSchema("trn"), idSchema("tcl")]),
  })
  .refine((value) => value.id.startsWith(VIEW_ID_PREFIX[value.kind]), {
    message: "body kind and id do not match",
  });

export const turnBodyView = defineRead({
  resource: "turns",
  method: "body-view",
  name: "ReadTurnBodyView",
  input: turnBodyViewInputSchema,
  output: withReadCommon(
    z.object({
      kind: z.enum(TURN_BODY_VIEW_KINDS),
      id: z.union([idSchema("trn"), idSchema("tcl")]),
      turn: idSchema("trn"),
      size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      truncated: z.boolean(),
      value: z.json(),
    }),
  ),
  actors: ["user"],
  errors: [...readErrors],
});

export const TURN_READS = [
  turnRead,
  turnList,
  turnResult,
  turnBody,
  turnBodyView,
] as const;
