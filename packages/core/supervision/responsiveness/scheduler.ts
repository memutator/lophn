import { err, ok, type Result } from "../../../base/mod.ts";

const IO_CONCURRENCY = 2;
const IO_QUEUE_LIMIT = 32;
const IO_PRINCIPAL_LIMIT = 4;
const IO_QUEUE_TIMEOUT_MS = 30_000;

type IoJob<T> = {
  result: Promise<Result<T>>;
  cancel(): void;
};
type IoScheduler = {
  submit<T>(
    principal: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Result<IoJob<T>>;
  close(): void;
  readonly active: number;
  readonly queued: number;
};

type Job = {
  principal: string;
  controller: AbortController;
  run(): Promise<void>;
  cancel(): void;
  timer?: ReturnType<typeof setTimeout>;
};

export function createIoScheduler(): IoScheduler {
  const queues = new Map<string, Job[]>();
  const principals: string[] = [];
  const active = new Set<Job>();
  const counts = new Map<string, number>();
  let queued = 0;
  let closed = false;

  function decrement(principal: string) {
    const count = counts.get(principal)! - 1;
    if (count === 0) counts.delete(principal);
    else counts.set(principal, count);
  }

  function remove(job: Job) {
    const queue = queues.get(job.principal);
    if (!queue) return;
    const index = queue.indexOf(job);
    if (index < 0) return;
    queue.splice(index, 1);
    queued--;
    decrement(job.principal);
    if (!queue.length) {
      queues.delete(job.principal);
      principals.splice(principals.indexOf(job.principal), 1);
    }
  }

  function pump() {
    while (!closed && active.size < IO_CONCURRENCY && principals.length) {
      const principal = principals.shift()!;
      const queue = queues.get(principal)!;
      const job = queue.shift()!;
      queued--;
      if (queue.length) principals.push(principal);
      else queues.delete(principal);
      clearTimeout(job.timer);
      active.add(job);
      void job.run().finally(() => {
        active.delete(job);
        decrement(principal);
        pump();
      });
    }
  }

  return {
    submit<T>(principal: string, work: (signal: AbortSignal) => Promise<T>) {
      if (!principal || typeof work !== "function") {
        return err({ code: "invalid_input" as const, message: "invalid job" });
      }
      if (
        closed ||
        queued >= IO_QUEUE_LIMIT ||
        (counts.get(principal) ?? 0) >= IO_PRINCIPAL_LIMIT
      ) {
        return err({
          code: "unavailable" as const,
          message: "worker capacity",
        });
      }
      let settle: (value: Result<T>) => void = () => {};
      let settled = false;
      const result = new Promise<Result<T>>((resolve) => (settle = resolve));
      function finish(value: Result<T>) {
        if (settled) return;
        settled = true;
        settle(value);
      }
      const controller = new AbortController();
      const job: Job = {
        principal,
        controller,
        async run() {
          try {
            finish(ok(await work(controller.signal)));
          } catch {
            finish(err({ code: "unavailable", message: "worker failed" }));
          }
        },
        cancel() {
          if (settled) return;
          controller.abort();
          clearTimeout(job.timer);
          remove(job);
          finish(err({ code: "unavailable", message: "worker cancelled" }));
          // Cancel cannot free a physical slot until the work really exits.
          pump();
        },
      };
      counts.set(principal, (counts.get(principal) ?? 0) + 1);
      if (!queues.has(principal)) {
        queues.set(principal, []);
        principals.push(principal);
      }
      queues.get(principal)!.push(job);
      queued++;
      job.timer = setTimeout(job.cancel, IO_QUEUE_TIMEOUT_MS);
      pump();
      return ok({ result, cancel: job.cancel });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const job of [...active, ...queues.values()].flat()) job.cancel();
    },
    get active() {
      return active.size;
    },
    get queued() {
      return queued;
    },
  };
}
