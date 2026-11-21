import { z } from "zod";
import type { PhoneCapability } from "../apps/phone-request.ts";
import { appFileHandleSchema } from "../apps/app-files.ts";
import {
  APP_FILE_SAMPLE_IMAGE,
  APP_FILE_SAMPLE_TEXT,
} from "../apps/app-file-values.ts";
import { atSchema } from "../base/values.ts";

// 앱이 쓰는 폰 기능의 표 하나다. key는 선언 SDK의 이름 목록(`PHONE_CAPABILITIES`)과 같아야 한다: 이름이 표에 없거나 표에만
// 있으면 type 오류다. 기능을 더하면 이름 하나, 이 표의 항목 하나, 동의 글 하나, 폰의 handler 하나, SDK 함수 하나다.
// - `from`: 부를 수 있는 쪽. `backend`는 컴퓨터의 앱 backend가 broker와 core를 지나 묻는 길(`PHONE_KINDS`가 된다),
//   `screen`은 폰 화면(과 폰에서 도는 backend)이 host에 직접 묻는 길(`phone-screen.ts`)이다.
// - `interactive`: 사람의 손이 드는 기능. 한 번에 하나만 연다.
// - `stand_in`: live가 아닐 때(desktop preview, 폰의 preview 화면) 폰에 닿지 않고 돌려주는 값이다.

export type PhoneOrigin = "screen" | "backend";

// accuracy 기본은 balanced, max_age_ms 기본은 0(캐시 없이 새로 잰다). 기본은 폰이 적용한다.
export const locationGetInputSchema = z.strictObject({
  accuracy: z.enum(["low", "balanced", "high"]).optional(),
  max_age_ms: z.number().int().min(0).max(300_000).optional(),
});
export type LocationGetInput = z.infer<typeof locationGetInputSchema>;

export const locationSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0),
  at: atSchema,
});
export type Location = z.infer<typeof locationSchema>;

const emptySchema = z.strictObject({});

export const HAPTIC_KINDS = [
  "light",
  "medium",
  "heavy",
  "selection",
  "success",
  "warning",
  "error",
] as const;

export const LINK_SCHEMES = ["https", "http", "tel", "sms", "mailto", "geo"];

const linkUrlSchema = z
  .string()
  .refine(
    (url) =>
      LINK_SCHEMES.includes(
        /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? "",
      ),
    { message: `url scheme must be one of ${LINK_SCHEMES.join(", ")}` },
  );

const codeScanSchema = z.discriminatedUnion("cancelled", [
  z.strictObject({ cancelled: z.literal(true) }),
  z.strictObject({
    cancelled: z.literal(false),
    format: z.string(),
    text: z.string(),
  }),
]);

// 사진·file을 내는 기능의 답: 취소했거나 file 손잡이(bytes가 아니다. 앱 file은 `apps/app-files.ts`)다. 한 번에 고르는 수는 10까지다.
const PICK_MAX = 10;
const pickMaxSchema = z.number().int().min(1).max(PICK_MAX).optional();
const pickedFilesSchema = z.discriminatedUnion("cancelled", [
  z.strictObject({ cancelled: z.literal(true) }),
  z.strictObject({
    cancelled: z.literal(false),
    files: z.array(appFileHandleSchema).min(1).max(PICK_MAX),
  }),
]);
// content type이나 `image/*` 같은 무늬다.
const filePatternSchema = z
  .string()
  .max(127)
  .regex(/^[A-Za-z0-9!#$&^_.+-]+\/(\*|[A-Za-z0-9!#$&^_.+-]+)$/);

type Spec<O extends z.ZodType> = {
  input: z.ZodType;
  output: O;
  deadline_ms: number;
  interactive: boolean;
  from: readonly [PhoneOrigin, ...PhoneOrigin[]];
  stand_in: z.infer<O>;
};

// `from`의 literal을 지키려고 `const` 인자로 받는다(`PHONE_KINDS`가 backend로 열린 항목만 type으로 고른다).
const entry = <
  I extends z.ZodType,
  O extends z.ZodType,
  const F extends readonly [PhoneOrigin, ...PhoneOrigin[]],
>(
  spec: Spec<O> & { input: I; from: F },
) => spec;

export const PHONE_CAPABILITY_TABLE = {
  "location.get": entry({
    input: locationGetInputSchema,
    output: locationSchema,
    deadline_ms: 20_000,
    interactive: false,
    from: ["screen", "backend"],
    // 서울시청이다.
    stand_in: {
      lat: 37.5663,
      lon: 126.9779,
      accuracy_m: 50,
      at: "2026-01-01T00:00:00.000Z",
    },
  }),
  "network.get": entry({
    input: emptySchema,
    output: z.strictObject({
      online: z.boolean(),
      type: z.enum(["wifi", "cellular", "other", "none"]),
    }),
    deadline_ms: 5_000,
    interactive: false,
    from: ["screen", "backend"],
    stand_in: { online: true, type: "wifi" },
  }),
  "haptics.play": entry({
    input: z.strictObject({ kind: z.enum(HAPTIC_KINDS) }),
    output: emptySchema,
    deadline_ms: 5_000,
    interactive: false,
    from: ["screen"],
    stand_in: {},
  }),
  "clipboard.read": entry({
    input: emptySchema,
    // 글만 읽는다. 클립보드에 글이 없으면 null이다.
    output: z.strictObject({ text: z.string().nullable() }),
    deadline_ms: 5_000,
    interactive: false,
    from: ["screen"],
    stand_in: { text: "Sample text from the clipboard" },
  }),
  "clipboard.write": entry({
    input: z.strictObject({ text: z.string() }),
    output: emptySchema,
    deadline_ms: 5_000,
    interactive: false,
    from: ["screen"],
    stand_in: {},
  }),
  "code.scan": entry({
    input: emptySchema,
    output: codeScanSchema,
    // 사람이 스캐너를 닫지 않으면 이 시간 뒤 닫힌다.
    deadline_ms: 300_000,
    interactive: true,
    from: ["screen"],
    stand_in: { cancelled: false, format: "qr", text: "https://example.com" },
  }),
  "link.open": entry({
    input: z.strictObject({ url: linkUrlSchema }),
    output: emptySchema,
    deadline_ms: 10_000,
    interactive: false,
    from: ["screen"],
    stand_in: {},
  }),
  "share.text": entry({
    input: z.strictObject({ text: z.string(), title: z.string().optional() }),
    output: emptySchema,
    deadline_ms: 10_000,
    interactive: false,
    from: ["screen"],
    stand_in: {},
  }),
  // 사람의 손이 드는 기능이고 file을 옮길 수 있어 deadline이 길다(고른 file이 컴퓨터로 올라간 뒤에 답한다).
  "camera.capture": entry({
    input: emptySchema,
    output: z.discriminatedUnion("cancelled", [
      z.strictObject({ cancelled: z.literal(true) }),
      z.strictObject({
        cancelled: z.literal(false),
        file: appFileHandleSchema,
      }),
    ]),
    deadline_ms: 600_000,
    interactive: true,
    from: ["screen"],
    stand_in: { cancelled: false, file: APP_FILE_SAMPLE_IMAGE.handle },
  }),
  "photos.pick": entry({
    input: z.strictObject({ max: pickMaxSchema }),
    output: pickedFilesSchema,
    deadline_ms: 600_000,
    interactive: true,
    from: ["screen"],
    stand_in: { cancelled: false, files: [APP_FILE_SAMPLE_IMAGE.handle] },
  }),
  "files.pick": entry({
    input: z.strictObject({
      types: z.array(filePatternSchema).max(10).optional(),
      max: pickMaxSchema,
    }),
    output: pickedFilesSchema,
    deadline_ms: 600_000,
    interactive: true,
    from: ["screen"],
    stand_in: { cancelled: false, files: [APP_FILE_SAMPLE_TEXT.handle] },
  }),
  "share.file": entry({
    input: z.strictObject({
      file: appFileHandleSchema,
      title: z.string().optional(),
    }),
    output: emptySchema,
    deadline_ms: 600_000,
    interactive: true,
    from: ["screen"],
    stand_in: {},
  }),
} satisfies Record<PhoneCapability, Spec<z.ZodType>>;

export type PhoneCapabilityTable = typeof PHONE_CAPABILITY_TABLE;

// `from`에 backend가 든 기능의 이름이다.
export type BackendCapability = {
  [K in PhoneCapability]: "backend" extends PhoneCapabilityTable[K]["from"][number]
    ? K
    : never;
}[PhoneCapability];

export const isPhoneCapability = (name: string): name is PhoneCapability =>
  Object.hasOwn(PHONE_CAPABILITY_TABLE, name);

// 이 기능을 이 쪽에서 부를 수 있는가.
export const capabilityFrom = (
  capability: PhoneCapability,
  origin: PhoneOrigin,
): boolean =>
  (PHONE_CAPABILITY_TABLE[capability].from as readonly PhoneOrigin[]).includes(
    origin,
  );
