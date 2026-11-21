// 앱이 사람의 폰 기능을 쓴다. 두 길이 있다.
// - 폰 화면(과 폰에서 도는 backend, desktop의 폰 화면 preview)에서는 `globalThis.lophnApp.phone`이 있고 요청이 그 폰의 host로
//   직접 간다(컴퓨터를 거치지 않는다). 화면이 쓸 수 있는 기능의 전부가 이 길이다.
// - 컴퓨터에서 도는 앱 backend에서는 broker로 간다. 위치와 연결 상태만 이 길이 열려 있다. 폰 앱이 앞에 떠 있을 때만 답한다.
import { CapabilityError, fromBroker, missingHost } from "./errors.ts";
import { type CapHost, readHost } from "./host.ts";

export const PHONE_REQUEST_PATH = "/_lophn/broker/phone/request";

// 폰 화면의 `lophnApp.phone`의 모양이다(protocol/shell/app-bridge-types.ts의 `LophnAppPhone`. SDK는 protocol을 import할 수 없어
// 사본으로 둔다). 실패는 `Error("<code>: <message>")`이고 폰의 guest에서는 `code`, `reason`, `permission`, `scope`도 달려 온다.
export type PhoneApp = {
  capabilities: readonly string[];
  standIn: boolean;
  request(capability: string, input: unknown): Promise<unknown>;
};

// 이 목록과 아래 값들은 protocol의 표(`phone/capabilities.ts`)와 같아야 한다. `capabilities_test.ts`가 맞춰 본다.
export const PHONE_CAPABILITY_NAMES = [
  "location.get",
  "network.get",
  "haptics.play",
  "clipboard.read",
  "clipboard.write",
  "code.scan",
  "link.open",
  "share.text",
] as const;
export type PhoneCapabilityName = (typeof PHONE_CAPABILITY_NAMES)[number];

// 컴퓨터의 backend가 broker로 부를 수 있는 기능이다(protocol/phone/capabilities.ts의 `from`에 backend가 든 것과 같다).
export const BACKEND_CAPABILITIES: readonly string[] = [
  "location.get",
  "network.get",
];

// protocol/phone/capabilities.ts의 입력·답과 같은 모양이다(SDK는 protocol을 import할 수 없어 사본으로 둔다).
const ACCURACIES = ["low", "balanced", "high"] as const;
export const MAX_AGE_MS_MAX = 300_000;
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

export type LocationAccuracy = (typeof ACCURACIES)[number];
export type HapticKind = (typeof HAPTIC_KINDS)[number];

export type LocationOptions = {
  // 기본은 balanced다(폰이 적용한다).
  accuracy?: LocationAccuracy;
  // 이 시간 안에 잰 위치면 새로 재지 않고 쓴다. 0..300000 정수, 기본은 0(새로 잰다).
  maxAgeMs?: number;
};

// live가 아니면(preview, test) 폰에 닿지 않고 정해진 값을 돌려주며 `standIn: true`가 붙는다.
type StandIn = { standIn?: true };

export type PhoneLocation = StandIn & {
  lat: number;
  lon: number;
  accuracyM: number;
  // ISO 8601 UTC 시각이다.
  at: string;
};

export type PhoneNetwork = StandIn & {
  online: boolean;
  type: "wifi" | "cellular" | "other" | "none";
};

export type PhoneClipboardText = StandIn & {
  // 클립보드에 글이 없으면 null이다.
  text: string | null;
};

// 사람이 스캐너를 닫으면 `cancelled: true`다(오류가 아니다).
export type PhoneScan =
  | (StandIn & { cancelled: true })
  | (StandIn & { cancelled: false; format: string; text: string });

// 값이 없는 기능(진동, 클립보드 쓰기, 링크 열기, 공유)의 결과다.
export type PhoneDone = StandIn;

export type PhoneAccess = {
  // 지금 이 코드가 쓸 수 있는 기능이다. 폰 화면과 그 preview에서만 안다(허락 ∩ 이 폰이 가진 것). 컴퓨터의 backend는
  // 비어 있다: 불러 보고 `forbidden`·`unavailable`을 다룬다.
  capabilities: readonly PhoneCapabilityName[];
  standIn: boolean;
};

export type PhoneClient = {
  getLocation(options?: LocationOptions): Promise<PhoneLocation>;
  getNetwork(): Promise<PhoneNetwork>;
  playHaptic(kind: HapticKind): Promise<PhoneDone>;
  readClipboard(): Promise<PhoneClipboardText>;
  writeClipboard(text: string): Promise<PhoneDone>;
  scanCode(): Promise<PhoneScan>;
  openLink(url: string): Promise<PhoneDone>;
  shareText(text: string, options?: { title?: string }): Promise<PhoneDone>;
  getPhoneAccess(): PhoneAccess;
};

export type PhoneClientDeps = { host?: CapHost; phone?: PhoneApp };

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

function checkLocation(options: LocationOptions): void {
  if (
    options.accuracy !== undefined &&
    !ACCURACIES.includes(options.accuracy)
  ) {
    throw invalid("accuracy must be low, balanced or high");
  }
  if (
    options.maxAgeMs !== undefined &&
    (!Number.isInteger(options.maxAgeMs) ||
      options.maxAgeMs < 0 ||
      options.maxAgeMs > MAX_AGE_MS_MAX)
  ) {
    throw invalid(`maxAgeMs must be an integer from 0 to ${MAX_AGE_MS_MAX}`);
  }
}

function checkText(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string") throw invalid(`${name} must be a string`);
}

function checkUrl(url: unknown): asserts url is string {
  checkText("url", url);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined || !LINK_SCHEMES.includes(scheme)) {
    throw invalid(`url scheme must be one of ${LINK_SCHEMES.join(", ")}`);
  }
}

function bad(capability: string): CapabilityError {
  return new CapabilityError({
    code: "internal",
    message: `phone returned ${capability} in an unexpected shape`,
  });
}

function num(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && value >= min && value <= max;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function location(value: unknown): PhoneLocation {
  const v = record(value);
  if (
    v &&
    num(v.lat, -90, 90) &&
    num(v.lon, -180, 180) &&
    num(v.accuracy_m, 0, Number.POSITIVE_INFINITY) &&
    typeof v.at === "string"
  ) {
    return { lat: v.lat, lon: v.lon, accuracyM: v.accuracy_m, at: v.at };
  }
  throw bad("a location");
}

function network(value: unknown): PhoneNetwork {
  const v = record(value);
  if (
    v &&
    typeof v.online === "boolean" &&
    (v.type === "wifi" ||
      v.type === "cellular" ||
      v.type === "other" ||
      v.type === "none")
  ) {
    return { online: v.online, type: v.type };
  }
  throw bad("the network state");
}

function clipboardText(value: unknown): PhoneClipboardText {
  const v = record(value);
  if (v && (v.text === null || typeof v.text === "string")) {
    return { text: v.text };
  }
  throw bad("the clipboard");
}

function scan(value: unknown): PhoneScan {
  const v = record(value);
  if (v?.cancelled === true) return { cancelled: true };
  if (
    v?.cancelled === false &&
    typeof v.format === "string" &&
    typeof v.text === "string"
  ) {
    return { cancelled: false, format: v.format, text: v.text };
  }
  throw bad("a scan");
}

const done = (): PhoneDone => ({});

// preview·test는 사람의 폰에 닿지 않는다. broker 길의 stand-in이다(폰 화면 길은 host가 표의 같은 값을 준다).
export const BROKER_STAND_IN: Record<string, () => unknown> = {
  // 서울시청의 고정 위치다.
  "location.get": () => ({
    lat: 37.5663,
    lon: 126.9779,
    accuracy_m: 50,
    at: new Date().toISOString(),
  }),
  "network.get": () => ({ online: true, type: "wifi" }),
};

const CODES = new Set([
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
]);

// 폰 화면 길의 실패를 오류로 바꾼다. guest는 `code` 등을 달고, desktop preview는 message의 앞 `<code>: `만 건넨다.
function fromPhone(thrown: unknown, capability: string): CapabilityError {
  const e = (thrown ?? {}) as Record<string, unknown>;
  const message = typeof e.message === "string" ? e.message : String(thrown);
  const prefixed = /^([a-z_]+): ([\s\S]*)$/.exec(message);
  const code =
    typeof e.code === "string" && CODES.has(e.code)
      ? e.code
      : prefixed && CODES.has(prefixed[1] as string)
        ? (prefixed[1] as string)
        : "internal";
  return fromBroker(
    {
      error: {
        code,
        message:
          prefixed && CODES.has(prefixed[1] as string) ? prefixed[2] : message,
        details: { reason: e.reason, permission: e.permission, scope: e.scope },
      },
    },
    { permission: "phone.use", scope: { capability } },
  );
}

export function createPhoneClient(deps: PhoneClientDeps = {}): PhoneClient {
  const phoneApp = (): PhoneApp | undefined =>
    deps.phone ??
    (globalThis as { lophnApp?: { phone?: PhoneApp } }).lophnApp?.phone;

  // 값을 `parse`로 읽는다. 폰 화면 길이 있으면 그 길, 없으면 broker 길(backend가 부를 수 있는 기능만)이다.
  async function ask<T extends StandIn>(
    capability: PhoneCapabilityName,
    input: Record<string, unknown>,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const app = phoneApp();
    if (app) {
      let value: unknown;
      try {
        value = await app.request(capability, input);
      } catch (thrown) {
        throw fromPhone(thrown, capability);
      }
      return app.standIn ? { ...parse(value), standIn: true } : parse(value);
    }
    if (!BACKEND_CAPABILITIES.includes(capability)) {
      throw new CapabilityError({
        code: "unavailable",
        message: `${capability} works only in a phone screen`,
      });
    }
    const host = deps.host ?? readHost();
    if (!host) throw missingHost();
    if (host.mode !== "live") {
      return { ...parse(BROKER_STAND_IN[capability]?.()), standIn: true };
    }
    let response;
    try {
      response = await host.post(PHONE_REQUEST_PATH, { capability, input });
    } catch {
      throw new CapabilityError({
        code: "unavailable",
        message: "phone could not reach the broker",
      });
    }
    if (response.status !== 200) {
      throw fromBroker(response.body, {
        permission: "phone.use",
        scope: { capability },
      });
    }
    return parse(record(response.body)?.value);
  }

  return {
    async getLocation(options = {}) {
      checkLocation(options);
      return ask(
        "location.get",
        {
          ...(options.accuracy === undefined
            ? {}
            : { accuracy: options.accuracy }),
          ...(options.maxAgeMs === undefined
            ? {}
            : { max_age_ms: options.maxAgeMs }),
        },
        location,
      );
    },
    getNetwork: () => ask("network.get", {}, network),
    async playHaptic(kind) {
      if (!HAPTIC_KINDS.includes(kind)) {
        throw invalid(`kind must be one of ${HAPTIC_KINDS.join(", ")}`);
      }
      return ask("haptics.play", { kind }, done);
    },
    readClipboard: () => ask("clipboard.read", {}, clipboardText),
    async writeClipboard(text) {
      checkText("text", text);
      return ask("clipboard.write", { text }, done);
    },
    scanCode: () => ask("code.scan", {}, scan),
    async openLink(url) {
      checkUrl(url);
      return ask("link.open", { url }, done);
    },
    async shareText(text, options = {}) {
      checkText("text", text);
      if (options.title !== undefined) checkText("title", options.title);
      return ask(
        "share.text",
        {
          text,
          ...(options.title === undefined ? {} : { title: options.title }),
        },
        done,
      );
    },
    getPhoneAccess() {
      const app = phoneApp();
      return {
        capabilities: (app?.capabilities ?? []) as PhoneCapabilityName[],
        standIn: app?.standIn ?? false,
      };
    },
  };
}

// 앱 코드가 쓰는 기본 client다. host는 호출할 때 읽는다.
const shared = createPhoneClient();

export const getLocation = (options?: LocationOptions) =>
  shared.getLocation(options);
export const getNetwork = () => shared.getNetwork();
export const playHaptic = (kind: HapticKind) => shared.playHaptic(kind);
export const readClipboard = () => shared.readClipboard();
export const writeClipboard = (text: string) => shared.writeClipboard(text);
export const scanCode = () => shared.scanCode();
export const openLink = (url: string) => shared.openLink(url);
export const shareText = (text: string, options?: { title?: string }) =>
  shared.shareText(text, options);
export const getPhoneAccess = () => shared.getPhoneAccess();
