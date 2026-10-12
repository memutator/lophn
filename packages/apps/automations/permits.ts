// automation 전체 동시 invocation 한도의 메모리 permit이다(apps/automations#R5, R6). supervisor
// 프로세스가 앱 자식마다 같은 인스턴스를 쓴다. 대기열이 없다. 즉시 받지 못하면 그 회차는 건너뛴다.
// permit은 실제 handler 종료(앱의 release 요청)나 자식 종료 확인 때만 돌려받는다. timeout이나 취소
// 요청으로 풀지 않는다.
import { AUTOMATION_CONCURRENCY_LIMIT } from "../../protocol/apps/mod.ts";

export type PermitHolder = {
  // 자식 프로세스 구분값(process nonce).
  nonce: string;
  release: string;
  key: string;
};

export type PermitOutcome = "granted" | "busy" | "limit";

export type AutomationPermits = {
  // 같은 (nonce,release,key)가 이미 점유 중이면 busy, 전체 한도에 닿으면 limit이다.
  tryAcquire(holder: PermitHolder): PermitOutcome;
  // 점유를 풀면 true, 점유가 없으면(이미 풀었거나 다른 자식의 것이면) false다.
  release(holder: PermitHolder): boolean;
  // 자식 종료를 확인했다. 그 자식의 모든 점유를 푼다. 푼 수를 돌려준다.
  childExited(nonce: string): number;
  readonly inUse: number;
  readonly limit: number;
};

function slot(holder: PermitHolder): string {
  return JSON.stringify([holder.nonce, holder.release, holder.key]);
}

export function createAutomationPermits(
  options: { limit?: number } = {},
): AutomationPermits {
  const limit = options.limit ?? AUTOMATION_CONCURRENCY_LIMIT;
  const held = new Map<string, PermitHolder>();
  return {
    limit,
    get inUse() {
      return held.size;
    },
    tryAcquire(holder) {
      const id = slot(holder);
      if (held.has(id)) return "busy";
      if (held.size >= limit) return "limit";
      held.set(id, { ...holder });
      return "granted";
    },
    release(holder) {
      return held.delete(slot(holder));
    },
    childExited(nonce) {
      let freed = 0;
      for (const [id, holder] of held) {
        if (holder.nonce !== nonce) continue;
        held.delete(id);
        freed += 1;
      }
      return freed;
    },
  };
}
