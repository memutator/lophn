import { z } from "zod";
import { idSchema } from "../../base/ids.ts";
import { appIdSchema } from "../../projects/values.ts";
import {
  invocationIdSchema,
  opaqueSchema,
  releaseIdSchema,
  toolCallIdSchema,
} from "../channel-values.ts";

// tool을 부른 쪽. kind가 호출 route의 actor와 맞는지는 core가 본다.
export const appToolCallerSchema = z.discriminatedUnion("kind", [
  // 앱 화면을 연 사람. 앱·release·mode는 호출 입력의 target이 싣는다.
  z.strictObject({ kind: z.literal("person"), view_session: opaqueSchema }),
  z.strictObject({
    kind: z.literal("agent"),
    session: idSchema("ses"),
    turn: idSchema("trn"),
    tool_call: toolCallIdSchema,
  }),
  z.strictObject({
    kind: z.literal("app"),
    app: appIdSchema,
    release: releaseIdSchema,
    parent_invocation: invocationIdSchema.nullable(),
  }),
  // job이 연 tool run의 호출. job·run 모양은 core가 만든 자격과 맞춰 본다.
  z.strictObject({
    kind: z.literal("program"),
    job: idSchema("job"),
    job_run: idSchema("jbr"),
  }),
]);
export type AppToolCaller = z.infer<typeof appToolCallerSchema>;
