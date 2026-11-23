import { err, ok, type Result } from "../../base/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import {
  type JobRunRecord,
  type JobTurn,
  jobClaimDue,
  jobDecideHold,
  jobRunEnded,
  jobRunStarted,
} from "../../protocol/jobs/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import {
  isJobTargetUnavailable,
  type JobTargetAvailability,
  jobHeld,
  jobMachinePort,
  jobsChanged,
  jobZonePort,
  targetAvailabilityOf,
} from "./ports.ts";
import { jobRunFromRow } from "./rows.ts";
import { dueTurns } from "./schedule.ts";
import {
  insertJobRun,
  loadJob,
  loadJobRun,
  replaceJobRun,
  setNextDue,
} from "./store.ts";

function fail(
  code: "forbidden" | "not_found" | "conflict",
  message: string,
): Result<never> {
  return err({ code, message });
}

const notMachine = (ctx: RequestContext) =>
  parseActor(ctx.actor)?.kind !== "machine";

// 켤 때 남은 도는 줄을 interrupted로 닫는다. workflow_start의 running 줄은 instance가 lophn 없이도 돌므로 둔다.
// queued인데 claimed_at이 있는 줄은 started를 적었는지 알 길이 없어 action과 상관없이 닫는다.
// 닫은 job마다 닫은 줄의 due_at 가운데 가장 큰 것을 돌려준다.
function closeLeftovers(
  tx: Tx,
  now: string,
  me: string,
): Result<Map<string, string>> {
  const closed = new Map<string, string>();
  const rows = tx.sql.all(
    `SELECT * FROM job_runs
     WHERE state = 'running' OR (state = 'queued' AND claimed_at IS NOT NULL)
     ORDER BY id`,
    [],
  );
  for (const row of rows) {
    const run = jobRunFromRow(row);
    if (!run.ok) return run;
    const job = loadJob(tx.sql, run.value.job, me);
    if (!job.ok) return job;
    if (job.value === null) continue;
    if (
      run.value.state === "running" &&
      job.value.action.kind === "workflow_start"
    )
      continue;
    replaceJobRun(tx.sql, run.value.id, {
      state: "interrupted",
      ended_at: now,
      reason: null,
    });
    const before = closed.get(run.value.job);
    if (before === undefined || before < run.value.due_at) {
      closed.set(run.value.job, run.value.due_at);
    }
    jobsChanged(tx);
  }
  return ok(closed);
}

function queuedRun(
  tx: Tx,
  job: string,
  dueAt: string,
  missed: number,
  now: string,
): void {
  const id = tx.newId("jbr");
  insertJobRun(tx.sql, {
    id,
    job,
    due_at: dueAt,
    missed_count: missed,
    state: "queued",
    reason: null,
    created_at: now,
  });
  // job이 돌게 되었으니 [Start now]를 기다릴 이유가 없다.
  const held = tx.sql.get(
    "SELECT id FROM job_runs WHERE job = ? AND state = 'held'",
    [job],
  );
  if (held !== undefined) {
    replaceJobRun(tx.sql, held.id as string, {
      state: "skipped",
      reason: "superseded",
      ended_at: now,
    });
  }
  jobsChanged(tx);
}

// 켜진 채 이만큼 넘게 늦게 처리한 차례는 켤 때와 같이 놓친 차례다(컴퓨터가 잠든 사이 timer가 늦은 경우).
const LATE_MS = 10 * 60_000;

// 한 job의 차례를 줄로 만든다.
function turnFor(
  tx: Tx,
  id: string,
  startup: boolean,
  closed: Map<string, string>,
  now: string,
  zone: string,
  me: string,
  availability: JobTargetAvailability,
): Result<void> {
  const loaded = loadJob(tx.sql, id, me);
  if (!loaded.ok) return loaded;
  const job = loaded.value;
  // 승인 전 job은 돌지 않는다. 켤 때 닫힌 줄이 있어도 차례를 만들지 않는다. 주인이 이 기계가 아닌 job도 같다.
  if (
    job === null ||
    !job.runs_here ||
    !job.enabled ||
    job.approved_at === null
  ) {
    return ok(undefined);
  }
  // event job은 때가 없다. 켤 때 닫힌 줄이 있어도 놓친 차례를 만들지 않는다(event는 꺼진 사이를 따라잡지 않는다).
  if (job.every === null) return ok(undefined);
  const spec = { every: job.every, at: job.at, zone };
  const came = job.next_due_at !== null && job.next_due_at <= now;
  const turns = came ? dueTurns(spec, job.next_due_at!, now) : null;
  // 보관된 앱·project의 job은 enabled를 건드리지 않고 실행 줄을 만들지 않으며 next_due_at만 다음 주기로 민다.
  // 보관 해제하면 역방향 수정 없이 다음 주기부터 저절로 다시 돈다.
  if (isJobTargetUnavailable(job, availability)) {
    if (turns !== null) {
      setNextDue(tx.sql, id, turns.next);
      jobsChanged(tx);
    }
    return ok(undefined);
  }
  const count = turns?.count ?? 0;
  const interrupted = closed.has(id) ? 1 : 0;
  // 기준은 가장 오래된 온 차례(next_due_at)다. 잠든 사이 여럿이 쌓여도 잡힌다.
  const late = came && Date.parse(now) - Date.parse(job.next_due_at!) > LATE_MS;
  const missedNow = startup || late;
  const missed = missedNow ? count + interrupted : Math.max(count - 1, 0);
  const dueAt = turns?.last ?? closed.get(id)!;

  const open = tx.sql.get(
    "SELECT id FROM job_runs WHERE job = ? AND state IN ('queued', 'running')",
    [id],
  );
  if (open !== undefined) {
    const skipped = tx.newId("jbr");
    insertJobRun(tx.sql, {
      id: skipped,
      job: id,
      due_at: dueAt,
      missed_count: missed,
      state: "skipped",
      reason: "overlap",
      created_at: now,
    });
    replaceJobRun(tx.sql, skipped, { ended_at: now });
    jobsChanged(tx);
  } else if (missedNow && job.missed_policy === "hold") {
    const held = tx.sql.get(
      "SELECT id, missed_count FROM job_runs WHERE job = ? AND state = 'held'",
      [id],
    );
    if (held === undefined) {
      const created = tx.newId("jbr");
      insertJobRun(tx.sql, {
        id: created,
        job: id,
        due_at: dueAt,
        missed_count: missed,
        state: "held",
        reason: null,
        created_at: now,
      });
      jobHeld(tx, { job: id, run: created, job_title: job.title });
      jobsChanged(tx);
    } else {
      replaceJobRun(tx.sql, held.id as string, {
        due_at: dueAt,
        missed_count: Number(held.missed_count) + missed,
      });
      jobsChanged(tx);
    }
  } else {
    queuedRun(tx, id, dueAt, missed, now);
  }
  if (turns !== null) {
    setNextDue(tx.sql, id, turns.next);
    jobsChanged(tx);
  }
  return ok(undefined);
}

// claimed_at이 없는 queued 줄을 한 번만 넘긴다.
// 주인이 이 기계가 아닌 job의 줄은 넘기지 않는다.
function handOut(tx: Tx, now: string, me: string): Result<JobTurn[]> {
  const start: JobTurn[] = [];
  const ids = tx.sql.all(
    `SELECT id FROM job_runs
     WHERE state = 'queued' AND claimed_at IS NULL
       AND job IN (SELECT id FROM jobs WHERE machine = ?)
     ORDER BY id`,
    [me],
  );
  for (const row of ids) {
    tx.sql.run("UPDATE job_runs SET claimed_at = ? WHERE id = ?", [
      now,
      row.id as string,
    ]);
    const run = loadJobRun(tx.sql, row.id as string);
    if (!run.ok) return run;
    const job = loadJob(tx.sql, run.value!.job, me);
    if (!job.ok) return job;
    start.push({ job: job.value!, job_run: run.value! });
  }
  return ok(start);
}

function reload(tx: Tx, id: string): Result<{ job_run: JobRunRecord }> {
  const run = loadJobRun(tx.sql, id);
  return run.ok ? ok({ job_run: run.value! }) : run;
}

export function createDueCommands(): {
  claimDue: CommandDefinition<typeof jobClaimDue>;
  started: CommandDefinition<typeof jobRunStarted>;
  ended: CommandDefinition<typeof jobRunEnded>;
  decideHold: CommandDefinition<typeof jobDecideHold>;
} {
  return {
    claimDue: {
      route: jobClaimDue,
      handle(tx, ctx, input) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core claims due jobs");
        }
        const now = tx.now();
        const zone = tx.port(jobZonePort).zone();
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const me = machine.value;
        let closed = new Map<string, string>();
        if (input.startup) {
          // 이 칸이 없던 때의 job은 새 판의 첫 기동이 이 기계 것으로 찍는다. 그 뒤 복사된 root는 원래 기계의 id를 들고 간다.
          tx.sql.run("UPDATE jobs SET machine = ? WHERE machine IS NULL", [me]);
          const result = closeLeftovers(tx, now, me);
          if (!result.ok) return result;
          closed = result.value;
        }
        const ids = new Set([
          ...tx.sql
            .all(
              `SELECT id FROM jobs
             WHERE enabled = 1 AND approved_at IS NOT NULL AND machine = ?
               AND next_due_at IS NOT NULL AND next_due_at <= ?`,
              [me, now],
            )
            .map((row) => row.id as string),
          ...closed.keys(),
        ]);
        const availability = targetAvailabilityOf(tx);
        for (const id of [...ids].sort()) {
          const turn = turnFor(
            tx,
            id,
            input.startup,
            closed,
            now,
            zone,
            me,
            availability,
          );
          if (!turn.ok) return turn;
        }
        const start = handOut(tx, now, me);
        if (!start.ok) return start;
        const next = tx.sql.get(
          "SELECT min(next_due_at) AS next FROM jobs WHERE enabled = 1 AND machine = ?",
          [me],
        );
        return ok({
          start: start.value,
          next_due_at: (next?.next as string | null | undefined) ?? null,
        });
      },
    },
    started: {
      route: jobRunStarted,
      handle(tx, ctx, input) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core records a job run start");
        }
        const current = loadJobRun(tx.sql, input.job_run);
        if (!current.ok) return current;
        if (current.value === null) {
          return fail("not_found", "job run not found");
        }
        if (current.value.state !== "queued") {
          return fail("conflict", "job run is not queued");
        }
        replaceJobRun(tx.sql, input.job_run, {
          state: "running",
          run: input.run,
          instance: input.instance,
          session: input.session,
          started_at: tx.now(),
        });
        jobsChanged(tx);
        return reload(tx, input.job_run);
      },
    },
    ended: {
      route: jobRunEnded,
      handle(tx, ctx, input) {
        if (notMachine(ctx)) {
          return fail("forbidden", "only core records a job run end");
        }
        const current = loadJobRun(tx.sql, input.job_run);
        if (!current.ok) return current;
        if (current.value === null) {
          return fail("not_found", "job run not found");
        }
        if (
          current.value.state !== "queued" &&
          current.value.state !== "running"
        ) {
          return fail("conflict", "job run is not open");
        }
        replaceJobRun(tx.sql, input.job_run, {
          state: input.state,
          ended_at: tx.now(),
          reason: input.reason,
        });
        jobsChanged(tx);
        return reload(tx, input.job_run);
      },
    },
    decideHold: {
      route: jobDecideHold,
      handle(tx, _ctx, input) {
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const current = loadJobRun(tx.sql, input.job_run);
        if (!current.ok) return current;
        if (current.value === null) {
          return fail("not_found", "job run not found");
        }
        const hold = current.value;
        if (hold.state !== "held") {
          return fail("conflict", "job run is not held");
        }
        if (input.choice === "skip") {
          replaceJobRun(tx.sql, hold.id, {
            state: "skipped",
            reason: "person",
            ended_at: tx.now(),
          });
        } else {
          const job = loadJob(tx.sql, hold.job, machine.value);
          if (!job.ok) return job;
          if (job.value?.runs_here === false) {
            return fail("conflict", "the job belongs to another computer");
          }
          if (job.value?.approved_at === null) {
            return fail("conflict", "the job waits for approval");
          }
          const open = tx.sql.get(
            "SELECT id FROM job_runs WHERE job = ? AND state IN ('queued', 'running')",
            [hold.job],
          );
          if (open !== undefined) {
            return fail("conflict", "the job is already running");
          }
          replaceJobRun(tx.sql, hold.id, { state: "queued" });
        }
        jobsChanged(tx);
        return reload(tx, hold.id);
      },
    },
  };
}
