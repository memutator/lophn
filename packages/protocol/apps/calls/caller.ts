import { z } from "zod";
import { idSchema } from "../../base/ids.ts";
import { appIdSchema } from "../../projects/values.ts";
import {
  invocationIdSchema,
  opaqueSchema,
  releaseIdSchema,
  toolCallIdSchema,
} from "../channel-values.ts";

// app-api를 부른 쪽. kind가 호출 route의 actor와 맞는지는 core가 본다.
export const appApiCallerSchema = z.discriminatedUnion("kind", [
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
]);
export type AppApiCaller = z.infer<typeof appApiCallerSchema>;
