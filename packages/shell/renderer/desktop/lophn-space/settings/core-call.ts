// settings 통로들(일반·providers·agents)이 같이 쓰는 core 부르기와 보호 창 열기. 응답은 main의
// contract client가 route output schema로 이미 검사했다. secret 값은 이 파일을 지나지 않는다: key·
// 로그인 응답은 보호 창이 받고 여기서는 창 열기만 한다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { OpenExternalApi } from "../../../../ipc/open-external.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type { SourceResult, WindowOutcome } from "./source.ts";

export async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  body: { input: unknown; compare?: unknown; key: string },
): Promise<SourceResult<T>> {
  return call<T>(core, "command", resource, method, {
    input: body.input,
    idempotency_key: body.key,
    ...(body.compare === undefined ? {} : { compare: body.compare }),
    prepared: [],
  });
}

export type SecretIntent = {
  readonly kind: "secret_input";
  readonly owner: string;
  readonly purpose: string;
  /** provider 연결(Connect)의 값 아닌 등록 정보. owner는 만들 provider의 ID다. */
  readonly connect?: {
    readonly name: string;
    /** 내장 정의 또는 직접 만든 정의. core의 RegisterProvider가 다시 검사한다. */
    readonly definition: unknown;
    readonly endpoint: string;
    readonly protocol: string;
    readonly kind: "api_key" | "oauth";
    /** OAuth만. 시작한 login handle이다. */
    readonly login?: string;
  };
  /** provider 끊기(Disconnect). owner는 끊을 provider의 ID다. */
  readonly disconnect?: true;
};

/** preload의 보호 창 열기. 없는 창에서는 undefined다. */
export type OpenSecretWindow = (
  intent: { request: SecretIntent; parentWindow: string },
) => Promise<unknown>;

export function windowSecretOpener(): OpenSecretWindow | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenSecretWindow };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

/** preload의 shell 링크 열기. 없는 창이면 undefined다. */
export function windowLinkOpener():
  | OpenExternalApi["openExternal"]
  | undefined {
  const shell = (globalThis as { lophnShell?: Partial<OpenExternalApi> })
    .lophnShell;
  return typeof shell?.openExternal === "function"
    ? (url) => shell.openExternal!(url)
    : undefined;
}

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다.
const PARENT_WINDOW = "requesting-window";

/** 보호 창을 연다. 열렸으면 ok, 창이 없거나 열지 못했으면 그 이유다. */
export async function openProtected(
  openWindow: OpenSecretWindow | undefined,
  intent: SecretIntent,
): Promise<WindowOutcome> {
  if (openWindow === undefined) return { ok: false, code: "unavailable" };
  try {
    const opened = await openWindow({
      request: intent,
      parentWindow: PARENT_WINDOW,
    }) as { windowId?: string; code?: string };
    return typeof opened?.windowId === "string"
      ? { ok: true, value: null }
      : { ok: false, code: opened?.code ?? "internal" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

const ULID_DIGITS = "0123456789abcdefghjkmnpqrstvwxyz";

/** contract provider id(`pvd_` + 소문자 ULID). 시각 48bit와 난수 80bit. */
export function newProviderId(nowMs: number): string {
  let time = "";
  let rest = nowMs;
  for (let index = 0; index < 10; index += 1) {
    time = ULID_DIGITS[rest % 32]! + time;
    rest = Math.floor(rest / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const random = [...bytes].map((byte) => ULID_DIGITS[byte % 32]).join("");
  return `pvd_${time}${random}`;
}
