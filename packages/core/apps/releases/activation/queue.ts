// 앱마다 하나만 도는 activation 상태. 메모리다. 도는 것만 둔다: lophn이 꺼졌다 켜지면 사라지고
// 진행 중 시도는 recovery가, 허락한 동의 줄은 sweep이 다시 시작한다. 도는 앱에 온 새 요청은 거절한다.
import type {
  ActivationQueueEntry,
  ActivationStep,
} from "../../../../protocol/apps/mod.ts";

export type QueueEntry = {
  app: string;
  release: string;
  step: ActivationStep | null;
  migrationSteps: number;
  // 사람이 허락한 비교의 정규 값이다. 차례가 왔을 때 비교가 이와 달라졌으면 다시 묻는다.
  approved: string | null;
};

export function createActivationQueue() {
  const entries = new Map<string, QueueEntry>();
  // 앱마다 돌고 있는 job 하나.
  const jobs = new Map<string, Promise<void>>();

  return {
    // 곧바로 시작한다. 그 앱에 도는 job이 있거나 이 release가 이미 진행 중이면 시작하지 않고 false다.
    enqueue(
      app: string,
      release: string,
      approved: string | null,
      job: (entry: QueueEntry) => Promise<void>,
    ): boolean {
      if (jobs.has(app) || entries.has(release)) return false;
      const entry: QueueEntry = {
        app,
        release,
        step: null,
        migrationSteps: 0,
        approved,
      };
      entries.set(release, entry);
      const run = (async () => {
        try {
          await job(entry);
        } catch {
          // 실패는 ledger에 남는다.
        } finally {
          entries.delete(release);
          jobs.delete(app);
        }
      })();
      jobs.set(app, run);
      return true;
    },
    update(
      app: string,
      patch: { step?: ActivationStep; migrationSteps?: number },
    ): void {
      for (const entry of entries.values()) {
        if (entry.app !== app) continue;
        if (patch.step !== undefined) entry.step = patch.step;
        if (patch.migrationSteps !== undefined) {
          entry.migrationSteps = patch.migrationSteps;
        }
      }
    },
    // 그 앱에 도는 job. 없으면 undefined다.
    running(app: string): Promise<void> | undefined {
      return jobs.get(app);
    },
    get size(): number {
      return entries.size;
    },
    list(
      app: string | undefined,
      heldCalls: (app: string) => number,
    ): ActivationQueueEntry[] {
      return [...entries.values()].filter((entry) =>
        app === undefined || entry.app === app
      ).map((entry) => ({
        app: entry.app,
        release: entry.release,
        phase: "running",
        step: entry.step,
        held_calls: heldCalls(entry.app),
        migration_steps: entry.migrationSteps,
      }));
    },
    async settled(): Promise<void> {
      while (jobs.size > 0) await Promise.all([...jobs.values()]);
    },
  };
}
