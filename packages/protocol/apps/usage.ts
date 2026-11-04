import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { defineRead } from "../base/route.ts";
import { appIdSchema, projectIdSchema } from "../projects/values.ts";
import { toolNameSchema } from "./channel-values.ts";

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 다른 앱·project가 쓰는 앱의 tool. place는 부른 agent가 놓인 곳이고 그 앱 자신은 싣지 않는다.
export const appToolUseSchema = z.object({
  app: appIdSchema,
  tool: toolNameSchema,
  place: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project"), id: projectIdSchema }),
    z.object({ kind: z.literal("app"), id: appIdSchema }),
  ]),
});
export type AppToolUse = z.infer<typeof appToolUseSchema>;

// agent는 lophn session만 읽는다.
export const appUsage = defineRead({
  resource: "apps",
  method: "usage",
  name: "app.usage",
  input: z.strictObject({ app: appIdSchema.optional() }),
  output: withReadCommon(z.object({ uses: z.array(appToolUseSchema) })),
  actors: ["user", "machine", "agent"],
  errors: readErrors,
});
