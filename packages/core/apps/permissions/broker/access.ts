// broker 서비스가 요청마다 읽는 현재 실행 범위와 공통 거절 모양이다.
// 실행 범위 = 현재 release 선언 ∩ 현재 active grant. 읽는 쪽이 계산한 값을
// 요청마다 다시 받으므로 회수는 다음 사용부터 거절된다. 여기서 IO는 하지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { hostOf } from "../../../../protocol/apps/declaration/scope.ts";
import type { EffectiveScope } from "../effective.ts";
import type { BrokerChild } from "./invocations.ts";

export type AccessState = {
  release: string;
  scope: EffectiveScope;
  // 현재 고정 선언의 command key 전체.
  tools: readonly string[];
};

export interface BrokerAccess {
  // 앱을 모르거나 현재 release가 없으면 null이다. 매 요청마다 다시 읽는다.
  current(app: string): Promise<Result<AccessState | null>>;
}

type Permission = "net.fetch" | "secret.use";

// 거절은 필요한 permission 이름과 scope를 알린다. 선언 밖이든 grant 밖이든
// 같은 모양이라 어느 쪽이 빠졌는지를 앱 코드가 추측할 수 없다.
export function refuse(
  permission: Permission,
  scope: Record<string, unknown>,
): Result<never> {
  return err({
    code: "forbidden",
    message: `${permission} is not permitted for this scope`,
    details: { permission, scope },
  });
}

export function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

export function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 외부 접근(net·secret)은 운영 앱의 live 자식만 쓴다. 준비 모드·preview 자식은
// 같은 통로로 외부에 닿지 않는다.
export function liveOnly(
  child: BrokerChild,
  permission: Permission,
  scope: Record<string, unknown>,
): Result<never> | undefined {
  if (child.mode !== "live" || child.release === null) {
    return refuse(permission, scope);
  }
  return undefined;
}

// 자식이 시작한 release가 지금 release일 때만 그 선언을 기준으로 삼는다. 교체된 뒤의 옛
// 자식은 새 선언으로 접근을 얻지 못한다.
export async function currentAccess(
  access: BrokerAccess,
  child: BrokerChild,
): Promise<Result<AccessState | null>> {
  const found = await access.current(child.app);
  if (!found.ok) return found;
  if (found.value === null || found.value.release !== child.release) {
    return ok(null);
  }
  return found;
}

export function normalHost(value: string): string | undefined {
  if (hostOf(value) !== undefined) return undefined;
  return value.toLowerCase();
}

// 선언∩grant가 정확히 허락한 net.fetch의 host·port인지 본다. wildcard·0·전체 port는 모양에서
// 이미 없다.
export function netGranted(
  state: AccessState,
  host: string,
  port: number,
): boolean {
  return state.scope.access.some(
    (entry) =>
      entry.kind === "net.fetch" &&
      entry.scope.host === host &&
      entry.scope.port === port,
  );
}

export function secretGranted(state: AccessState, name: string): boolean {
  return state.scope.access.some(
    (entry) => entry.kind === "secret.use" && entry.scope.name === name,
  );
}
