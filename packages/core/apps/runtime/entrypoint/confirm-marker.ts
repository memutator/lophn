// confirm 실행 marker. handler를 부르기 전에 접수한 inv ID를 메모리에
// 넣어 같은 proof가 두 번 와도 한 번만 실행한다. 프로세스당 한도에 닿으면 기존 marker를 버리지 않고
// 새 접수를 거절한다. 만료된 proof는 어차피 거절되므로 가득 찼을 때만 그런 marker를 비운다.
import { CONFIRM_MARKER_LIMIT } from "./limits.ts";

export type MarkerAdmission = "new" | "known" | "full";

export type ConfirmMarkers = {
  // 같은 inv ID가 있으면 known, 새 접수면 marker를 넣고 new, 자리가 없으면 full이다.
  // 판정과 삽입이 동기라 같은 proof를 동시에 보내도 new는 한 번이다.
  admit(invocation: string, expiresAt: string, now: string): MarkerAdmission;
  has(invocation: string): boolean;
  size(): number;
};

export function createConfirmMarkers(
  limit: number = CONFIRM_MARKER_LIMIT,
): ConfirmMarkers {
  // inv ID → proof 만료 시각. 시각은 모두 같은 UTC 형식이라 문자열로 비교한다.
  const markers = new Map<string, string>();
  return {
    admit(invocation, expiresAt, now) {
      if (markers.has(invocation)) return "known";
      if (markers.size >= limit) {
        for (const [known, expires] of markers) {
          if (expires <= now) markers.delete(known);
        }
        if (markers.size >= limit) return "full";
      }
      markers.set(invocation, expiresAt);
      return "new";
    },
    has: (invocation) => markers.has(invocation),
    size: () => markers.size,
  };
}
