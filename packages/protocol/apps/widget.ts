import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import {
  appIdSchema,
  processNonceSchema,
  runtimeModeSchema,
} from "./channel-values.ts";
import { trayToneSchema } from "./tray.ts";

// 앱 위젯 값. 앱 process가 `@lophn/cap-notify`의 setWidget으로 내는, 정해진 node 넷으로 된 data다. 폰의 native 위젯이 그린다.
// node가 넷뿐인 것은 위젯이 Android RemoteViews로만 그려지기 때문이다. web이나 RN 화면을 위젯에 띄울 수 없으므로 앱이 모양을
// 정하지 못하고, 폰이 머리(앱 이름, 위젯 label)와 꼬리(가져온 시각)를 직접 그린다. 앱은 rows 밖에 그리지 못한다.
// core는 (앱, key)마다 마지막 값을 메모리에만 두고(tray와 같다. lophn을 다시 켜면 사라지고 앱이 시작할 때 다시 낸다) 저장하지 않는다.
// 앱은 입력에 없다. 앱 자식 credential이 고정한 앱이다. 값이 바뀌면 `app_widget.set`의 `changes`대로 `StateChanged` `widgets`가 난다.

export const WIDGET_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
// 앱 하나가 선언하는 위젯 수의 상한. 선언 검사(declaration)는 같은 숫자를 literal로 쓴다.
export const WIDGETS_MAX = 4;
export const WIDGET_VALUE_MAX_BYTES = 4096;

export const widgetToneSchema = trayToneSchema;
export type WidgetTone = z.infer<typeof widgetToneSchema>;

const str = (max: number) => z.string().trim().min(1).max(max);
const keySchema = z.string().regex(WIDGET_KEY_PATTERN);

export const widgetNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    text: str(48),
    tone: widgetToneSchema.optional(),
    style: z.enum(["title", "body", "caption"]),
  }),
  z.strictObject({
    kind: z.literal("stat"),
    value: str(12),
    label: str(24),
    tone: widgetToneSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("progress"),
    value: z.number().min(0).max(1),
    label: str(24).optional(),
    tone: widgetToneSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("list"),
    items: z
      .array(
        z.strictObject({
          text: str(32),
          trail: str(12).optional(),
          tone: widgetToneSchema.optional(),
        }),
      )
      .min(1)
      .max(5),
  }),
]);
export type WidgetNode = z.infer<typeof widgetNodeSchema>;

export const widgetValueSchema = z
  .strictObject({
    v: z.literal(1),
    tone: widgetToneSchema.optional(),
    rows: z.array(widgetNodeSchema).min(1).max(6),
  })
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <=
      WIDGET_VALUE_MAX_BYTES,
    { message: `widget value is over ${WIDGET_VALUE_MAX_BYTES} bytes` },
  );
export type WidgetValue = z.infer<typeof widgetValueSchema>;

// value가 null이면 이 앱의 이 위젯 값을 지운다(clearWidget).
const widgetInputSchema = z.strictObject({
  key: keySchema,
  value: widgetValueSchema.nullable(),
});
export type AppWidgetSetInput = z.infer<typeof widgetInputSchema>;

// broker가 받는 앱 process의 요청. 자식 연결이 정한 nonce·mode를 함께 싣는다(brokerTrayInputSchema와 같다).
export const brokerWidgetInputSchema = widgetInputSchema.extend({
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
});

// active 앱의 active release가 선언한 위젯마다 한 줄이다. 값이 아직 없으면 value·at이 null이다.
// 위젯 머리에 앱 아이콘이 없어 icon 칸이 없다.
export const appWidgetSchema = z.strictObject({
  app: appIdSchema,
  app_name: z.string(),
  key: keySchema,
  label: z.string(),
  screen: z.string().nullable(),
  value: widgetValueSchema.nullable(),
  at: atSchema.nullable(),
});
export type AppWidget = z.infer<typeof appWidgetSchema>;

export const appWidgetSet = defineMemory({
  resource: "app_widget",
  method: "set",
  name: "app_widget.set",
  changes: ["widgets"],
  input: widgetInputSchema,
  output: z.object({ set: z.literal(true) }),
  actors: ["app"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const appWidgetsList = defineMemory({
  resource: "app_widgets",
  method: "list",
  name: "app_widgets.list",
  input: z.strictObject({}),
  output: z.object({ widgets: z.array(appWidgetSchema) }),
  reads: ["widgets", "apps", "releases"],
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const APP_WIDGET_ROUTES = [appWidgetSet, appWidgetsList] as const;
