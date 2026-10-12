// 준비 worker slot 감독. crash한 slot은 같은 이름의 새 프로세스로 채운다
// (architecture/documents 2.1). 재시작은 한도(3)와 backoff(1·2·4초) 뒤다.
// 한도를 넘긴 slot은 다시 띄우지 않는다. 시각과 sleep은 주입받는다.
import type { ChildSession } from "../../../supervision/responsiveness/mod.ts";

// platform 감독의 재기동과 같은 고정 값이다. 설정으로 늘리지 않는다.
export const RESTART_DELAYS_MS = [1_000, 2_000, 4_000];
export const RESTART_LIMIT = RESTART_DELAYS_MS.length;

export type SlotSupervisor = {
  // slot의 살아있는 세션을 돌려준다. crash한 slot은 backoff 뒤 새 프로세스로 채운다.
  // 한도를 넘기면 거절한다.
  acquire(name: string): Promise<ChildSession>;
  // 세션이 끊겼다. 다음 acquire가 새 프로세스를 띄운다.
  release(name: string): void;
  // 재시작 한도를 넘긴 slot. 그 slot은 다시 채우지 않는다.
  unavailable(name: string): boolean;
  stop(): Promise<void>;
};

export type SlotSupervisorOptions = {
  spawn(name: string): Promise<ChildSession>;
  sleep?: (ms: number) => Promise<void>;
  // 테스트가 한도를 줄일 때만 쓴다.
  restartLimit?: number;
};

export function supervisePreparationSlots(
  options: SlotSupervisorOptions,
): SlotSupervisor {
  const sleep = options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const limit = options.restartLimit ?? RESTART_LIMIT;
  const held = new Map<string, ChildSession>();
  const failures = new Map<string, number>();
  let stopped = false;

  return {
    async acquire(name) {
      if (stopped) throw new Error("supervisor stopped");
      const current = held.get(name);
      if (current) return current;
      const failed = failures.get(name) ?? 0;
      if (failed >= limit) throw new Error("restart limit reached");
      if (failed > 0) await sleep(RESTART_DELAYS_MS[failed - 1] ?? 0);
      if (stopped) throw new Error("supervisor stopped");
      // sleep 사이 다른 배분이 이 slot을 채웠으면 그것을 쓴다.
      const raced = held.get(name);
      if (raced) return raced;
      const session = await options.spawn(name);
      held.set(name, session);
      return session;
    },
    release(name) {
      if (!held.delete(name)) return;
      failures.set(name, (failures.get(name) ?? 0) + 1);
    },
    unavailable(name) {
      return (failures.get(name) ?? 0) >= limit && !held.has(name);
    },
    stop() {
      stopped = true;
      held.clear();
      return Promise.resolve();
    },
  };
}
