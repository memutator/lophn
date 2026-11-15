import type { Clock, Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";

// TUI 탭이 열린 harness session의 hold다. 임대라서 shell이 죽거나 core가 다시 떠도 저절로 풀리고 다시 맞춰진다.
// 열 때 30초 예약(첫 heartbeat까지의 틈)하고, TUI 탭 목록에 실려 오면 10초로 갱신한다. 목록은 `/host-link`의 `hello`·`visible`이 마지막으로
// 보낸 것을 core가 연결이 열린 동안 주기로 다시 넣거나(연결이 닫히면 멈춰 10초 뒤 풀린다), shell main이 이어 부르는 take(옛 길, 기다림은 5초 이하)가 싣는다.
// 목록에 한 번 실렸던 session이 빠지면 바로 풀고, 한 번도 실리지 않았으면 예약이 끝나는 30초에 풀린다.
const RESERVE_MS = 30_000;
const BEAT_MS = 10_000;

type Lease = { until: number; confirmed: boolean };

export function createHold(deps: { clock: Clock }) {
  const leases = new Map<Id<"ses">, Lease>();
  const held = (session: Id<"ses">) => {
    const lease = leases.get(session);
    return lease !== undefined && lease.until > deps.clock.nowMs();
  };
  return {
    held,
    reserve(session: Id<"ses">): void {
      leases.set(session, {
        until: deps.clock.nowMs() + RESERVE_MS,
        confirmed: false,
      });
    },
    beat(sessions: readonly Id<"ses">[]): void {
      const now = deps.clock.nowMs();
      const listed = new Set(sessions);
      for (const session of listed) {
        leases.set(session, { until: now + BEAT_MS, confirmed: true });
      }
      for (const [session, lease] of leases) {
        if (lease.confirmed && !listed.has(session)) leases.delete(session);
        else if (lease.until <= now) leases.delete(session);
      }
    },
  };
}

export type Hold = ReturnType<typeof createHold>;

// harness wiring이 내는 port다. host-queue wiring이 부른다. `open`은 `tabs/open`의 tui에서, 걸러서 통과하면 그 자리에서 hold를 걸고
// CLI를 다시 열 값(harness는 adapter id)을 돌려준다. `heartbeat`는 연결이나 `host/take`에 실려 온 TUI 탭이 열린 session 전부다.
export type HarnessHold = {
  heartbeat(sessions: readonly Id<"ses">[]): void;
  open(
    session: Id<"ses">,
  ): Result<{ harness: string; external_session: string }>;
};
