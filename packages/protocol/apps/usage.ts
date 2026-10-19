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

// 다른 project가 쓰는 앱의 tool. project는 쓰는 쪽이고 앱 자신의 project는 싣지 않는다.
// grant는 열려 있는 쪽이고 invocation은 실제로 부른 쪽이다.
export const appToolUseSchema = z.object({
  app: appIdSchema,
  tool: toolNameSchema,
  project: projectIdSchema,
  source: z.enum(["grant", "invocation"]),
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
