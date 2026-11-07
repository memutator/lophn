import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { appIdSchema } from "../projects/values.ts";
import { releaseIdSchema } from "./channel-values.ts";

// 앱이 고정한 내장 SDK(@lophn/*)의 판과 lophn이 지금 가진 판의 차이다(`architecture/app-call.md`의 "SDK 상태").
// - required: 고정 판이 지원 하한(`lophn.supported_from`)보다 옛것이다. 앱이 못 뜨거나 곧 못 뜬다.
// - available: 하한 이상이지만 지금 판보다 옛것이다. 옛 판으로 돌고 새 기능만 못 쓴다.
// - current: 지금 판이다.
// notes는 `migrate-sdk` skill의 메모 file 이름이다(고정 판 다음부터 지금 판까지, 오래된 것이 먼저).
export const SDK_LEVELS = ["required", "available", "current"] as const;
export const sdkLevelSchema = z.enum(SDK_LEVELS);
export type SdkLevel = z.infer<typeof sdkLevelSchema>;

export const sdkStatusEntrySchema = z.object({
  sdk: z.string().min(1),
  pinned: z.string().min(1),
  current: z.string().min(1),
  supported_from: z.string().min(1).nullable(),
  level: sdkLevelSchema,
  notes: z.array(z.string().min(1)),
});
export type SdkStatusEntry = z.infer<typeof sdkStatusEntrySchema>;

export const appSdkStatusSchema = z.object({
  app: appIdSchema,
  name: z.string().min(1),
  release: releaseIdSchema,
  sdks: z.array(sdkStatusEntrySchema),
});
export type AppSdkStatus = z.infer<typeof appSdkStatusSchema>;

// 보관하지 않은, 켜진 release가 있는 앱만 싣는다. 보관한 앱과 없는 앱은 agent에게 not_found다.
// agent는 자기 범위의 앱만 본다(app workspace는 자기 앱).
export const appSdkStatus = defineRead({
  resource: "apps",
  method: "sdk_status",
  name: "app.sdk_status",
  input: z.strictObject({ app: appIdSchema.optional() }),
  output: z.object({ apps: z.array(appSdkStatusSchema) }),
  actors: ["user", "machine", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
