import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { defineMemory } from "../base/route.ts";
import { effectSchema } from "./grants.ts";
import {
  gateDenyReasonSchema,
  intentKindSchema,
  intentTargetSchema,
} from "./intent.ts";

// runtime이 Gate가 걸리는 tool을 실행하기 직전에 core에 묻는 입구다. core가 판정, 사람에게 묻기, 결정 기다리기,
// 허락 소비를 한 번에 하고 결과만 돌려준다. 호출자(그 session의 agent)와 origin은 core가 session과 turn으로 채운다.
// credential의 session·turn과 입력의 session·turn이 다르면 forbidden이다.
export const toolGateInputSchema = z.strictObject({
  session: idSchema("ses"),
  turn: idSchema("trn"),
  tool_call: idSchema("tcl"),
  tool: z.string().min(1),
  intent: z.strictObject({
    kind: intentKindSchema,
    target: intentTargetSchema,
    effect: effectSchema,
    // 정규화한 입력. agent가 쓴 설명 글은 넣지 않는다.
    input: jsonObjectSchema,
  }).refine((value) => value.kind === value.target.kind, {
    message: "intent kind does not match target kind",
  }),
});
export type ToolGateInput = z.infer<typeof toolGateInputSchema>;

// run만 실행해도 된다. changed는 허락 뒤 실행 직전에 intent가 달라졌거나 허락이 이미 쓰였다는 뜻이다.
export const toolGateResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run") }),
  z.strictObject({ kind: z.literal("denied"), reason: gateDenyReasonSchema }),
  z.strictObject({
    kind: z.literal("rejected"),
    reason: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("cancelled"),
    cause: z.enum(["turn_ended", "session_closed", "restart"]),
  }),
  z.strictObject({ kind: z.literal("changed") }),
]);
export type ToolGateResult = z.infer<typeof toolGateResultSchema>;

export const toolGateCheck = defineMemory({
  resource: "tool_gate",
  method: "check",
  name: "CheckToolGate",
  input: toolGateInputSchema,
  output: toolGateResultSchema,
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// registry에는 lead가 올린다.
export const TOOL_GATE_ROUTES = [toolGateCheck] as const;
