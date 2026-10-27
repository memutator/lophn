import type { Clock } from "../../../packages/base/mod.ts";
import { sessionSnapshotsList } from "../../../packages/protocol/events/mod.ts";
import { modelCallList } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../support/core/mod.ts";

// trial 하나의 role agent 비용 상한. judge와 사람 역할은 key 호출이 아니다.
export const TRIAL_CAP_USD = 50;

const PRICED = ["reported", "estimated", "free"];

// 요청 body를 읽는 collectSessions는 주기적으로 읽기에 무거워 model call 기록만 더한다. 규칙은 metricsOf의 cost_usd와 같다.
export async function roleSpendUsd(core: Core): Promise<number> {
  const { snapshots } = await core.call(sessionSnapshotsList, {});
  let sum = 0;
  for (const item of snapshots) {
    let cursor: string | undefined;
    do {
      const out = await core.call(modelCallList, {
        session: item.session,
        cursor,
      });
      for (const { cost } of out.calls) {
        if (
          PRICED.includes(cost.kind) &&
          cost.currency === "USD" &&
          cost.amount !== null
        )
          sum += Number(cost.amount);
      }
      cursor = out.next_cursor ?? undefined;
    } while (cursor !== undefined);
  }
  return sum;
}

// everyMs가 지나야 roleSpend를 다시 읽는다. 그 사이는 앞 값을 쓴다.
export function createSpendGuard(deps: {
  limitUsd: number;
  roleSpend: () => Promise<number>;
  clock: Clock;
  everyMs?: number;
}): { over(): Promise<string | null> } {
  const everyMs = deps.everyMs ?? 30_000;
  let readAt: number | null = null;
  let role = 0;
  return {
    async over() {
      const now = deps.clock.nowMs();
      if (readAt === null || now - readAt >= everyMs) {
        role = await deps.roleSpend();
        readAt = now;
      }
      return role > deps.limitUsd
        ? `trial 비용 $${role.toFixed(4)} > 상한 $${deps.limitUsd}`
        : null;
    },
  };
}
