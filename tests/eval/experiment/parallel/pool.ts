import { DEFAULT_LIMITS, type TrialKind } from "./kind.ts";

// createCap의 반환과 같은 모양. runner를 import하면 방향이 거꾸로라 구조로만 받는다.
export type Budget = {
  add(usd: number): void;
  exceeded(): boolean;
  total(): number;
};

export type Job<T> = {
  id: string;
  kind: TrialKind;
  run(): Promise<{ value: T; cost_usd: number }>;
};

export type JobResult<T> =
  | { status: "done"; id: string; value: T; cost_usd: number }
  | { status: "failed"; id: string; error: string }
  | { status: "skipped"; id: string; reason: "budget" | "stopped" };

export type Pool = {
  submit<T>(job: Job<T>): Promise<JobResult<T>>;
  stop(): void;
  halted(): "budget" | "stopped" | null;
  running(): Record<TrialKind, number>;
};

const KINDS = Object.keys(DEFAULT_LIMITS) as TrialKind[];

// 줄 안의 job은 type이 지워져 있다. submit이 자기 T로 되돌려 준다.
type Waiting = {
  start(): void;
  skip(reason: "budget" | "stopped"): void;
};

export function createPool(options: {
  budget: Budget;
  limits?: Partial<Record<TrialKind, number>>;
}): Pool {
  const { budget } = options;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const kind of KINDS) {
    if (!(limits[kind] >= 1)) {
      throw new Error(`limits.${kind}는 1 이상이어야 한다: ${limits[kind]}`);
    }
  }
  const queues: Record<TrialKind, Waiting[]> = { judgment: [], long: [] };
  const running: Record<TrialKind, number> = { judgment: 0, long: 0 };
  let stopped = false;

  const halted = () =>
    stopped ? "stopped" : budget.exceeded() ? "budget" : null;

  // 띄우기 직전에 확인한다. 긴 trial이 도는 동안 예산이 찰 수 있어서다.
  function pump() {
    for (const kind of KINDS) {
      const queue = queues[kind];
      while (queue.length > 0) {
        const reason = halted();
        if (reason) {
          queue.shift()!.skip(reason);
        } else if (running[kind] < limits[kind]) {
          running[kind]++;
          queue.shift()!.start();
        } else break;
      }
    }
  }

  return {
    submit<T>(job: Job<T>): Promise<JobResult<T>> {
      return new Promise((resolve) => {
        queues[job.kind].push({
          skip: (reason) => resolve({ status: "skipped", id: job.id, reason }),
          start: () => {
            // run이 동기로 던져도 같은 길로 failed가 된다.
            let ran: Promise<{ value: T; cost_usd: number }>;
            try {
              ran = job.run();
            } catch (e) {
              ran = Promise.reject(e);
            }
            ran.then(
              ({ value, cost_usd }) => {
                budget.add(cost_usd);
                return { status: "done", id: job.id, value, cost_usd } as const;
              },
              (e) => ({
                status: "failed",
                id: job.id,
                error: e instanceof Error ? e.message : String(e),
              } as const),
            ).then((result) => {
              running[job.kind]--;
              resolve(result);
              pump();
            });
          },
        });
        pump();
      });
    },
    stop() {
      stopped = true;
      pump();
    },
    halted,
    running: () => ({ ...running }),
  };
}
