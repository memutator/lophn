// 앱마다 하나만 도는 activation 상태. 메모리다. lophn이 꺼졌다 켜지면 사라지고
// Reactor가 cursor 뒤의 `TicketVerified`부터 다시 반응한다. 도는 앱에 온 새 요청은 거절한다.
import type {
  ActivationPhase,
  ActivationQueueEntry,
  ActivationStep,
} from "../../../../protocol/apps/mod.ts";

export type QueueEntry = {
  app: string;
  release: string;
  phase: ActivationPhase;
  approval: string | null;
  step: ActivationStep | null;
  migrationSteps: number;
  // 사람이 허락한 비교의 정규 값이다. 차례가 왔을 때 비교가 이와 달라졌으면 다시 묻는다.
  approved: string | null;
};

export function createActivationQueue() {
  const entries = new Map<string, QueueEntry>();
  // 앱마다 돌고 있는 job 하나.
  const jobs = new Map<string, Promise<void>>();
  const running = new Set<string>();

  function entryOf(
    app: string,
    release: string,
    phase: ActivationPhase,
  ): QueueEntry {
    return {
      app,
      release,
      phase,
      approval: null,
      step: null,
      migrationSteps: 0,
      approved: null,
    };
  }

  return {
    has(release: string): boolean {
      const entry = entries.get(release);
      return entry !== undefined && entry.phase !== "waiting_approval";
    },
    // 사람의 결정을 기다린다. 일하지 않는다.
    waitApproval(app: string, release: string, approval: string): void {
      const entry = entries.get(release);
      if (entry !== undefined && entry.phase !== "waiting_approval") return;
      entries.set(release, {
        ...entryOf(app, release, "waiting_approval"),
        approval,
      });
    },
    // 더 새 release의 activation이 시작되면 이전 release를 기다리던 것을 뺀다.
    dropWaiting(app: string, except: string): void {
      for (const [release, entry] of entries) {
        if (
          entry.app === app && entry.phase === "waiting_approval" &&
          release !== except
        ) entries.delete(release);
      }
    },
    // 곧바로 시작한다. 그 앱에 도는 job이 있거나 이 release가 이미 진행 중이면 시작하지 않고 false다.
    enqueue(
      app: string,
      release: string,
      approved: string | null,
      job: (entry: QueueEntry) => Promise<void>,
    ): boolean {
      if (jobs.has(app)) return false;
      const existing = entries.get(release);
      if (existing !== undefined && existing.phase !== "waiting_approval") {
        return false;
      }
      const entry = { ...entryOf(app, release, "running"), approved };
      entries.set(release, entry);
      running.add(release);
      const run = (async () => {
        try {
          await job(entry);
        } catch {
          // 실패는 ledger에 남는다.
        } finally {
          running.delete(release);
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
        if (entry.app !== app || entry.phase !== "running") continue;
        if (patch.step !== undefined) entry.step = patch.step;
        if (patch.migrationSteps !== undefined) {
          entry.migrationSteps = patch.migrationSteps;
        }
      }
    },
    running(release: string): boolean {
      return running.has(release);
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
        phase: entry.phase,
        approval: entry.approval,
        step: entry.phase === "running" ? entry.step : null,
        held_calls: entry.phase === "running" ? heldCalls(entry.app) : 0,
        migration_steps: entry.migrationSteps,
      } as ActivationQueueEntry));
    },
    async settled(): Promise<void> {
      while (jobs.size > 0) await Promise.all([...jobs.values()]);
    },
  };
}
