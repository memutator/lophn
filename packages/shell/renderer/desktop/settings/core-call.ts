// settings 통로들(일반·providers·agents)이 같이 쓰는 core 부르기와 보호 입력 창 열기. 응답은 main의
// contract client가 route output schema로 이미 검사했다. secret 값은 이 파일을 지나지 않는다: key는
// 보호 입력 창이 받고 여기서는 창 열기만 한다.
import type { z } from "zod";

import type { CommandRoute } from "../../../../protocol/base/route.ts";
import { type CommandBody, commandBody } from "../../command-call.ts";
import type { CoreCall } from "../../../ipc/core.ts";
import type { OAuthHandoffApi } from "../../../ipc/oauth-handoff.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type {
  SecretInputOpen,
  SecretInputOpenApi,
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

export function command<R extends CommandRoute>(
  core: CoreSource,
  route: R,
  body: CommandBody<R>,
): Promise<SourceResult<z.output<R["output"]>>> {
  return call(
    core,
    "command",
    route.resource,
    route.method,
    commandBody(route, body),
  );
}

/**
 * preload의 보호 입력 창 열기. 없는 창에서는 undefined다. `machine`을 주면 값과 읽기가 그 기계의 link로만 간다(범위의 기계).
 */
export function windowSecretInputOpener(
  machine: string | null = null,
): SecretInputOpenApi["open"] | undefined {
  const shell = (
    globalThis as {
      lophnShell?: { openSecretInput?: SecretInputOpenApi["open"] };
    }
  ).lophnShell;
  return typeof shell?.openSecretInput === "function"
    ? (input) =>
        shell.openSecretInput!(machine === null ? input : { ...input, machine })
    : undefined;
}

/**
 * 보호 입력 창을 열고 닫힐 때까지 기다린다. `stored`면 `name`의 값이 올라가 있다(provider 갈래면 이어졌다). 값은 이 안을
 * 지나지 않는다. subject는 창에 보일 이름이라 제어 문자를 빼고 80자로 자른다.
 */
export async function enterSecret(
  open: SecretInputOpenApi["open"] | undefined,
  input: SecretInputOpen,
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

/** 연결된 provider 몫의 secret 이름. `ConnectProvider`가 받는 이름이 이것뿐이다. */
export function providerSecretName(provider: string): string {
  return `provider.${provider.slice("pvd_".length)}`;
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

/** preload의 원격 loopback OAuth callback 받기. 없는 창이면 undefined다. */
export function windowOAuthHandoff():
  | OAuthHandoffApi["oauthHandoff"]
  | undefined {
  const shell = (globalThis as { lophnShell?: Partial<OAuthHandoffApi> })
    .lophnShell;
  return typeof shell?.oauthHandoff === "function"
    ? (request) => shell.oauthHandoff!(request)
    : undefined;
}
