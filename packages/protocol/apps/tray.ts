import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import {
  appIdSchema,
  processNonceSchema,
  runtimeModeSchema,
} from "./channel-values.ts";

// 앱 tray 값. 앱 process가 `@lophn/cap-notify`의 setTray로 내는 짧은 글과 tone이다. core는 앱마다 마지막 값을 메모리에만
// 두고(lophn을 다시 켜면 사라진다. 앱이 시작할 때 다시 낸다) 저장하지 않는다. 앱은 입력에 없다. 앱 자식 credential이 고정한 앱이다.
// 권한(`notify.send` grant)은 broker가 요청마다 판정하고, 이 route는 그 뒤에서 값만 바꾼다.
// 남지 않는 event(`packages/protocol/events/transient.ts`): AppTrayChanged { app }.

export const TRAY_TEXT_MAX = 16;
export const trayToneSchema = z.enum(["neutral", "good", "warn", "bad"]);
export type TrayTone = z.infer<typeof trayToneSchema>;
export const trayTextSchema = z.string().trim().min(1).max(TRAY_TEXT_MAX);

export const trayValueSchema = z.strictObject({
  app: appIdSchema,
  text: trayTextSchema,
  tone: trayToneSchema,
  at: atSchema,
});
export type TrayValue = z.infer<typeof trayValueSchema>;

// text가 null이면 이 앱의 값을 지운다(clearTray).
const trayInputSchema = z.strictObject({
  text: trayTextSchema.nullable(),
  tone: trayToneSchema.optional(),
});
export type AppTraySetInput = z.infer<typeof trayInputSchema>;

// broker가 받는 앱 process의 요청. 자식 연결이 정한 nonce·mode를 함께 싣는다(brokerNotifyInputSchema와 같다).
export const brokerTrayInputSchema = trayInputSchema.extend({
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
});

export const appTraySet = defineMemory({
  resource: "app_tray",
  method: "set",
  name: "app_tray.set",
  changes: ["tray"],
  input: trayInputSchema,
  output: z.object({ set: z.literal(true) }),
  actors: ["app"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const appTrayList = defineMemory({
  resource: "app_tray",
  method: "list",
  name: "app_tray.list",
  input: z.strictObject({}),
  output: z.object({ values: z.array(trayValueSchema) }),
  reads: ["tray"],
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const APP_TRAY_ROUTES = [appTraySet, appTrayList] as const;
