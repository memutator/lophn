import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { permissionDenialSchema } from "./denial.ts";
import { askedCallSchema } from "./gate-call.ts";

// runtime이 Gate가 걸리는 tool을 실행하기 직전에 core에 묻는 입구다. core가 판정, 사람에게 묻기, 결정 기다리기를
// 한 번에 하고 결과만 돌려준다. 호출자(그 session의 agent)와 origin은 core가 session과 turn으로 채운다.
// credential의 session·turn과 입력의 session·turn이 다르면 forbidden이다.
export const toolGateInputSchema = z.strictObject({
  session: idSchema("ses"),
  turn: idSchema("trn"),
  tool_call: idSchema("tcl"),
  tool: z.string().min(1),
  call: askedCallSchema,
});
export type ToolGateInput = z.infer<typeof toolGateInputSchema>;

// run만 실행해도 된다.
export const toolGateResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run") }),
  z.strictObject({
    kind: z.literal("denied"),
    denial: permissionDenialSchema,
  }),
  // by는 누가 거절했는지다. 팀 자식의 request는 부모가 푼다.
  z.strictObject({
    kind: z.literal("rejected"),
    reason: z.string().nullable(),
    by: z.enum(["person", "parent"]),
  }),
  z.strictObject({
    kind: z.literal("cancelled"),
    cause: z.enum(["turn_ended", "session_closed", "restart"]),
  }),
]);
export type ToolGateResult = z.infer<typeof toolGateResultSchema>;

export const toolGateCheck = defineMemory({
  resource: "tool_gate",
  method: "check",
  name: "CheckToolGate",
  changes: [],
  input: toolGateInputSchema,
  output: toolGateResultSchema,
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});
