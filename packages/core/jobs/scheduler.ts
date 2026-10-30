import { ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { JobTurn } from "../../protocol/jobs/mod.ts";
import type { JobScheduler, JobSchedulerDeps } from "./ports.ts";

const MAX_SLEEP_MS = 60_000;
const RETRY_MS = 60_000;
const MIN_SLEEP_MS = 1_000;

// 깨어나는 길(timer, wake, 최대 잠)이 무엇이든 바퀴는 같다. 한 번에 한 바퀴만 돈다.
// 기록 event나 Bus에 얹지 않는다. 신호는 wiring이 wake()로 준다.
export function createJobScheduler(deps: JobSchedulerDeps): JobScheduler {
  const { clock, timers, store, starter, logger } = deps;
  let handle: { value: unknown } | undefined;
  let cycle: Promise<void> | undefined;
  let again = false;
  let started = false;
  let stopped = false;
  // claim이 한 번 성공할 때까지 true다. 켤 때 한 번의 일이 빠지지 않게 재시도도 startup이다.
  let startupDone = false;

  const clearTimer = () => {
    if (handle === undefined) return;
    timers.clear(handle.value);
    handle = undefined;
  };

  const sleep = (ms: number) => {
    clearTimer();
    if (stopped) return;
    const slot: { value: unknown } = { value: undefined };
    slot.value = timers.set(() => {
      if (handle === slot) handle = undefined;
      wake();
    }, ms);
    handle = slot;
  };

  // not_found(그 사이 job이 지워짐)와 conflict(켤 때 이미 닫힘)는 정상이다. 나머지는 다음 기동이 닫는다.
  const logUnlessGone = (what: string, done: Result<unknown>) => {
    if (done.ok) return;
    if (done.error.code === "not_found" || done.error.code === "conflict") {
      return;
    }
    logger.error({
      component: "jobs",
      event: "job_run_update_failed",
      message: `jobs: ${what} failed`,
      fields: {
        code: done.error.code,
        reason: done.error.message,
      },
    });
  };

  async function closeFinished(): Promise<void> {
    const open = await store.open();
    if (!open.ok) {
      logger.error({
        component: "jobs",
        event: "open_read_failed",
        message: "jobs: could not read open job runs",
        fields: { reason: open.error.message },
      });
      return;
    }
    for (const { job, job_run } of open.value) {
      if (job_run.state !== "running") continue;
      if (job.action.kind === "workflow_start") {
        if (job_run.instance === null) continue;
        const state = await starter.instanceState(
          job_run.instance as Id<"wfi">,
        );
        if (!state.ok || state.value === "running") continue;
        logUnlessGone(
          "closing a job run",
          await store.ended(
            job_run.id as Id<"jbr">,
            state.value === "ended" ? "done" : "cancelled",
          ),
        );
        continue;
      }
      // watch가 끝 기록을 못 적은 줄을 다시 닫는다. 켜는 첫 바퀴는 읽지 않는다: runs가 끊긴 run을
      // 이미 failed로 닫아 두어, 여기서 닫으면 startup claim의 interrupted와 놓친 차례 계산이 사라진다.
      if (!startupDone || job_run.run === null) continue;
      const state = await starter.runState(job_run.run as Id<"run">);
      if (!state.ok || state.value === "running") continue;
      logUnlessGone(
        "closing a job run",
        await store.ended(job_run.id as Id<"jbr">, state.value),
      );
    }
  }

  async function watch(run: Id<"run">, jobRun: Id<"jbr">): Promise<void> {
    const waited = await starter.waitRun(run);
    // 오류나 종료로 그치면 거짓 끝을 적지 않는다. 다음 기동이 interrupted로 닫는다.
    if (!waited.ok) return;
    logUnlessGone(
      "ending a job run",
      await store.ended(jobRun, waited.value.state),
    );
  }

  async function launch({ job, job_run }: JobTurn): Promise<void> {
    const found = await starter.start(job, job_run);
    if (!found.ok) {
      logUnlessGone(
        "ending a job run",
        await store.ended(
          job_run.id as Id<"jbr">,
          "failed",
          `${found.error.code}: ${found.error.message}`,
        ),
      );
      return;
    }
    logUnlessGone(
      "starting a job run",
      await store.started(job_run.id as Id<"jbr">, found.value),
    );
    if (found.value.run !== null) {
      void watch(found.value.run, job_run.id as Id<"jbr">);
    }
  }

  async function lap(): Promise<void> {
    await closeFinished();
    const claimed = await store.claimDue(!startupDone);
    if (!claimed.ok) {
      logger.error({
        component: "jobs",
        event: "claim_due_failed",
        message: "jobs: could not claim due jobs",
        fields: { reason: claimed.error.message },
      });
      sleep(RETRY_MS);
      return;
    }
    startupDone = true;
    for (const turn of claimed.value.start) await launch(turn);
    const due = claimed.value.next_due_at;
    sleep(
      due === null
        ? MAX_SLEEP_MS
        : Math.min(
            MAX_SLEEP_MS,
            Math.max(MIN_SLEEP_MS, Date.parse(due) - clock.nowMs()),
          ),
    );
  }

  function wake(): void {
    if (!started || stopped) return;
    if (cycle !== undefined) {
      again = true;
      return;
    }
    clearTimer();
    cycle = (async () => {
      do {
        again = false;
        try {
          await lap();
        } catch (e) {
          logger.error({
            component: "jobs",
            event: "lap_failed",
            fields: { error: String(e) },
          });
          sleep(RETRY_MS);
        }
      } while (again && !stopped);
    })().finally(() => {
      cycle = undefined;
    });
  }

  return {
    async start() {
      if (started) return ok(undefined);
      started = true;
      wake();
      await cycle;
      return ok(undefined);
    },
    wake,
    async stop() {
      stopped = true;
      clearTimer();
      await cycle;
    },
  };
}
