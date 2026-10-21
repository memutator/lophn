// preview 대역이 같이 쓰는 거절과 mode 검사. 거절은 운영 broker와 같은 모양(필요한 permission
// 이름과 scope)이라 어느 쪽이 빠졌는지를 앱 코드가 추측할 수 없다.
import { err, type Result } from "../../../../base/mod.ts";
import type { BrokerChild } from "../../permissions/mod.ts";

export function refuse(
  permission: string,
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

// 대역은 preview 자식만 받는다. 운영(live) 자식 요청이 대역에 닿으면 실제 효과와 대역의
// 성공을 섞게 되므로 거절한다.
export function standInOnly(
  child: BrokerChild,
  permission: string,
  scope: Record<string, unknown>,
): Result<never> | undefined {
  if (child.mode === "live") return refuse(permission, scope);
  return undefined;
}
