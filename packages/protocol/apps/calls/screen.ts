import { z } from "zod";
import { defineFile } from "../../base/route.ts";
import { screenKeySchema } from "../channel-values.ts";
import { appApiTargetSchema } from "./call.ts";

// core가 UI bundle 사본의 byte를 내준다. path는 그 screen 아래 상대 경로다.
const appScreenFileInputSchema = z.strictObject({
  target: appApiTargetSchema,
  screen: screenKeySchema,
  path: z.string().min(1),
});
export type AppScreenFileInput = z.infer<typeof appScreenFileInputSchema>;

export const appScreenFile = defineFile({
  resource: "apps",
  method: "screen_file",
  name: "app.screen_file",
  input: appScreenFileInputSchema,
  // 실제 Content-Type은 파일 형식이다. 선언은 fallback이다.
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});
