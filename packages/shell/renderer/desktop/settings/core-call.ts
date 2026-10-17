// settings 통로들(일반·providers·agents)이 같이 쓰는 core 부르기와 보호 입력 창 열기. 응답은 main의
// contract client가 route output schema로 이미 검사했다. secret 값은 이 파일을 지나지 않는다: key는
// 보호 입력 창이 받고 여기서는 창 열기만 한다.
import type { CoreCall } from "../../../ipc/core.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type {
  SecretInputOpenApi,
  SecretInputPurpose,
} from "../../../ipc/secret-input.ts";
import type { CoreSource } from "../connection/connection.ts";
import type { SourceResult } from "./source.ts";

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

/** preload의 보호 입력 창 열기. 없는 창에서는 undefined다. */
export function windowSecretInputOpener():
  | SecretInputOpenApi["open"]
  | undefined {
  const shell = (globalThis as {
    lophnShell?: { openSecretInput?: SecretInputOpenApi["open"] };
  }).lophnShell;
  return typeof shell?.openSecretInput === "function"
    ? (input) => shell.openSecretInput!(input)
    : undefined;
}

/**
 * 보호 입력 창을 열고 닫힐 때까지 기다린다. `stored`면 `name`의 값이 올라가 있다. 값은 이 안을 지나지
 * 않는다. subject는 창에 보일 이름이라 제어 문자를 빼고 80자로 자른다.
 */
export async function enterSecret(
  open: SecretInputOpenApi["open"] | undefined,
  input: { name: string; purpose: SecretInputPurpose; subject: string },
): Promise<SourceResult<"stored" | "cancelled">> {
  if (open === undefined) return { ok: false, code: "unavailable" };
  try {
    const reply = await open({
      ...input,
      subject: input.subject.replace(/\p{Cc}/gu, "").slice(0, 80),
    });
    return reply.ok
      ? { ok: true, value: reply.result }
      : { ok: false, code: reply.code };
  } catch {
    return { ok: false, code: "unavailable" };
  }
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
