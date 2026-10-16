// 앱마다 하나씩 줄에 세워 진행하는 activation 줄. 줄은 메모리다. lophn이 꺼졌다 켜지면 사라지고
// Reactor가 cursor 뒤의 `TicketVerified`부터 다시 반응한다. 앱 사이는 서로 기다리지 않는다.
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

export type ActivationQueue = ReturnType<typeof createActivationQueue>;

export function createActivationQueue() {
  const entries = new Map<string, QueueEntry>();
  const lanes = new Map<string, Promise<void>>();
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
    // 사람의 결정을 기다린다. 줄에서 일하지 않는다.
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
    // 줄에 세운다. 이미 줄에 있거나 도는 release는 다시 세우지 않는다. 앱마다 한 번에 하나씩 job을 돈다.
    enqueue(
      app: string,
      release: string,
      approved: string | null,
      job: (entry: QueueEntry) => Promise<void>,
    ): boolean {
      const existing = entries.get(release);
      if (existing !== undefined && existing.phase !== "waiting_approval") {
        return false;
      }
      const entry = { ...entryOf(app, release, "queued"), approved };
      entries.set(release, entry);
      const lane = (lanes.get(app) ?? Promise.resolve()).then(async () => {
        entry.phase = "running";
        running.add(release);
        try {
          await job(entry);
        } catch {
          // 한 job의 실패가 같은 앱의 다음 job을 막지 않는다. 실패는 ledger에 남는다.
        } finally {
          running.delete(release);
          entries.delete(release);
        }
      });
      lanes.set(app, lane);
      void lane.finally(() => {
        if (lanes.get(app) === lane) lanes.delete(app);
      });
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
      while (lanes.size > 0) await Promise.all([...lanes.values()]);
    },
  };
}
