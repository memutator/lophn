import { z } from "zod";
import { compareVersions, err, ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import { jsonValueSchema } from "../base/json-values.ts";
import { sha256Schema } from "../base/values.ts";

// 앱의 폰 화면(React Native)이 core, 폰 앱의 host, 폰의 guest runtime 사이에서 지키는 모양이다. 이 file이 고정하는 것:
// 화면이 import할 수 있는 host module 목록, 화면 bundle의 manifest(`screens/<key>/phone.json`)와 폰의 호환 검사,
// host와 guest가 주고받는 bridge 메시지, base bundle이 내는 전역 이름.
// 쓰는 곳: 화면 build(`phone.js`와 `phone.json`을 짓고 모듈 목록을 external로 둔다), core의 `apps/phone_screens` 읽기
// (manifest를 싣는다), 폰 앱의 host(호환 검사, bridge 구현)와 guest base bundle(메시지, 전역).
// 폰 앱은 Metro로 `packages/protocol`을 직접 읽으므로 이 file은 zod와 `packages/base`만 import한다.

// 화면 source가 import할 수 있는 bare module의 전부다. 폰의 base bundle이 `globalThis.require`로 이 이름들만 내주고
// 화면 build는 이 이름들만 external로 둔다. 목록을 바꾸면 폰 앱 판이 올라가야 한다(`PHONE_BASE_FORMAT`).
export const PHONE_HOST_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-native",
  "react-native-svg",
  "react-native-safe-area-context",
  "lucide-react-native",
  "@lophn/ui-native",
  "@lophn/app-ui-native",
] as const;

// base bundle의 약속(전역 이름, 메시지)이 바뀔 때 올린다.
export const PHONE_BASE_FORMAT = 1;

// guest의 base bundle이 내는 전역 이름이다. 화면 bundle의 진입은 `__lophnMount(Screen)`을 부르고 평가 전체를
// `try{…}catch(e){__lophnFatal(e)}`로 감싼다(평가 중 예외는 host process를 죽인다).
export const PHONE_GUEST_GLOBALS = {
  mount: "__lophnMount",
  fatal: "__lophnFatal",
  require: "require",
} as const;

// `callOperation`의 input 상한이다(core의 `app_views/call`과 같다).
export const PHONE_CALL_INPUT_MAX_BYTES = 64 * 1024;
// 메시지 하나(JSON 문자열)의 상한이다. reply의 value 상한이 `CALL_RESULT_MAX_BYTES`(8 MiB)다.
export const PHONE_MESSAGE_MAX_BYTES = 8 * 1024 * 1024 + 1024;
// guest는 `init`이 올 때까지 이 간격으로 최대 이 횟수만큼 `ready`를 다시 보낸다(첫 메시지가 떨어진 적이 있다).
export const PHONE_READY_RETRY_MS = 200;
export const PHONE_READY_RETRY_MAX = 25;

const versionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){2}$/);

export const phoneManifestSchema = z.strictObject({
  format: z.literal(1),
  entry: z.literal("phone.js"),
  // phone.js의 byte 수와 sha256
  size: z.number().int().nonnegative(),
  sha256: sha256Schema,
  // 이 화면이 요구하는 `PHONE_BASE_FORMAT`(build 때의 값)
  base: z.number().int().positive(),
  // build 때 화면이 기댄 kit 판
  kit: z.strictObject({
    "@lophn/ui-native": versionSchema,
    "@lophn/app-ui-native": versionSchema,
  }),
  // phone.js가 실제로 require하는 host module(build는 PHONE_HOST_MODULES의 부분집합만 낸다). 새 폰 목록에서
  // 지은 화면이 옛 폰에서도 읽혀서 phone_too_old가 되도록 이름은 열어 둔다.
  modules: z.array(z.string()),
});
export type PhoneManifest = z.infer<typeof phoneManifestSchema>;

// 폰이 알리는 자기 모양이다. 폰 앱이 두 package.json의 판을 읽어 채운다.
export const phoneHostInfoSchema = z.strictObject({
  base: z.number().int().positive(),
  kit: versionSchema,
  app_ui_native: versionSchema,
  modules: z.array(z.string()),
});
export type PhoneHostInfo = z.infer<typeof phoneHostInfoSchema>;

export type PhoneCanRun =
  | { ok: true }
  // phone_too_old: 폰 앱을 올려야 한다. screen_too_old: 컴퓨터에서 앱을 새 판으로 다시 지어야 한다.
  // 둘 다 해당하면 phone_too_old가 앞선다.
  | { ok: false; reason: "phone_too_old" | "screen_too_old" };

const major = (version: string) => Number(version.split(".")[0]);

export function phoneCanRun(
  manifest: PhoneManifest,
  host: PhoneHostInfo,
): PhoneCanRun {
  const kits = [
    [manifest.kit["@lophn/ui-native"], host.kit],
    [manifest.kit["@lophn/app-ui-native"], host.app_ui_native],
  ] as const;
  if (
    manifest.base > host.base ||
    kits.some(([screen, phone]) => compareVersions(screen, phone) > 0) ||
    manifest.modules.some((name) => !host.modules.includes(name))
  ) {
    return { ok: false, reason: "phone_too_old" };
  }
  if (kits.some(([screen, phone]) => major(screen) < major(phone))) {
    return { ok: false, reason: "screen_too_old" };
  }
  return { ok: true };
}

const callInputSchema = jsonValueSchema.refine(
  (value) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
    PHONE_CALL_INPUT_MAX_BYTES,
  { message: "call input is over 64 KiB" },
);

// guest -> host. guest가 누구인지는 host가 view로 안다. 메시지에 싣지 않는다.
export const phoneGuestMessageSchema = z.discriminatedUnion("type", [
  // guest가 시작했다. host는 같은 view의 ready를 여러 번 받아도 init을 다시 보낼 뿐이다.
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({
    type: z.literal("call"),
    id: z.number().int(),
    operation: z.string(),
    input: callInputSchema,
  }),
  // guest의 root가 잡은 오류나 화면 bundle 평가 중의 오류(`__lophnFatal`)
  z.strictObject({ type: z.literal("fatal"), message: z.string().max(2000) }),
]);
export type PhoneGuestMessage = z.infer<typeof phoneGuestMessageSchema>;

const schemeSchema = z.enum(["light", "dark"]);

// guest가 받아 `lophnApp.place`에 세우는 값이다. `app_views/open`의 workspace와 같은 모양이고, protocol의 다른
// file을 끌어오지 않으려고 칸을 여기 따로 둔다.
const phonePlaceSchema = z.strictObject({
  place: z.literal("phone"),
  params: z.record(z.string(), jsonValueSchema),
  workspace: z
    .strictObject({
      kind: z.enum(["project", "home", "app"]),
      id: z.string().min(1),
      folders: z.array(z.string()),
    })
    .nullable(),
});
export type PhonePlace = z.infer<typeof phonePlaceSchema>;

// host -> guest
export const phoneHostMessageSchema = z.discriminatedUnion("type", [
  // guest의 root는 이것을 받을 때까지 화면을 그리지 않는다(`lophnApp.place`가 첫 render 전에 서 있어야 한다).
  z.strictObject({
    type: z.literal("init"),
    place: phonePlaceSchema,
    scheme: schemeSchema,
    locale: z.string(),
  }),
  // `app_views/call`의 outcome 그대로다. 앱 오류 code는 일곱 code가 아니라 그대로 간다.
  z.strictObject({
    type: z.literal("reply"),
    id: z.number().int(),
    outcome: z.union([
      z.strictObject({ ok: z.literal(true), value: jsonValueSchema }),
      z.strictObject({
        ok: z.literal(false),
        error: z.strictObject({ code: z.string(), message: z.string() }),
      }),
    ]),
  }),
  // 앱 event 하나. guest가 구독했는지는 guest가 거른다.
  z.strictObject({
    type: z.literal("event"),
    source: z.string(),
    event: z.string(),
    payload: jsonValueSchema,
  }),
  z.strictObject({ type: z.literal("appearance"), scheme: schemeSchema }),
]);
export type PhoneHostMessage = z.infer<typeof phoneHostMessageSchema>;

// guest가 만드는 `globalThis.lophnApp`의 모양이다. `callOperation`은 실패를 `"<code>: <message>"` Error로
// reject한다(desktop의 `lophnApp`과 같고 `@lophn/app-ui`의 use-operation이 기댄다). commands, setTabHead,
// setKeepAlive, agent, sessions, agents, projects, openExternal은 없다.
export type PhoneLophnApp = {
  place: PhonePlace;
  callOperation(operation: string, input: unknown): Promise<unknown>;
  events: {
    subscribe(
      source: string,
      event: string,
      listener: (payload: unknown) => void,
    ): () => void;
  };
};

function parseMessage<T>(
  schema: z.ZodType<T>,
  raw: string,
): Result<T, LophnError> {
  const invalid = (message: string) =>
    err<LophnError>({ code: "invalid_input", message });
  if (new TextEncoder().encode(raw).byteLength > PHONE_MESSAGE_MAX_BYTES) {
    return invalid("message too large");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid("message is not JSON");
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? ok(parsed.data)
    : invalid("message has a wrong shape");
}

export const parsePhoneGuestMessage = (raw: string) =>
  parseMessage(phoneGuestMessageSchema, raw);
export const parsePhoneHostMessage = (raw: string) =>
  parseMessage(phoneHostMessageSchema, raw);
