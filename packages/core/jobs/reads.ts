import { err, ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import {
  type JobRunRecord,
  type JobTurn,
  jobActivity,
  jobHolds,
  jobList,
  jobPending,
  jobRunList,
  jobRunOpen,
} from "../../protocol/jobs/mod.ts";
import type { AgentAtWorkspace } from "../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import { jobEventPolicyPort, jobTargetsPort } from "./ports.ts";
import {
  hasActivity,
  loadHolds,
  loadJob,
  loadJobRuns,
  loadJobs,
  loadOpenRuns,
  loadPendingJobs,
} from "./store.ts";

const PAGE = 50;

// job run은 job과 같이 지워지므로 job이 없는 줄은 없다.
function turnsOf(
  sql: Pick<Sql, "get" | "all">,
  runs: JobRunRecord[],
): Result<JobTurn[]> {
  const turns: JobTurn[] = [];
  for (const job_run of runs) {
    const job = loadJob(sql, job_run.job);
    if (!job.ok) return job;
    if (job.value === null) {
      return err({ code: "internal", message: "job run without a job" });
    }
    turns.push({ job: job.value, job_run });
  }
  return ok(turns);
}

export function createJobReads(): {
  list: ReadDefinition<typeof jobList>;
  runList: ReadDefinition<typeof jobRunList>;
  pending: ReadDefinition<typeof jobPending>;
  holds: ReadDefinition<typeof jobHolds>;
  open: ReadDefinition<typeof jobRunOpen>;
  activity: ReadDefinition<typeof jobActivity>;
} {
  return {
    list: {
      route: jobList,
      handle(snapshot, ctx, input) {
        const actor = parseActor(ctx.actor);
        let creator: AgentAtWorkspace | undefined;
        if (actor?.kind === "agent") {
          creator = snapshot
            .port(jobTargetsPort)
            .creatorOf(actor.id as Id<"ses">);
          if (creator === undefined) {
            return err({
              code: "forbidden",
              message: "the session is not known",
            });
          }
        }
        const loaded = loadJobs(snapshot.sql, {
          ...(creator === undefined ? {} : { creator }),
          ...(input.cursor === undefined ? {} : { after: input.cursor }),
          limit: PAGE + 1,
        });
        if (!loaded.ok) return loaded;
        // event job의 앱이 지금 그 event를 내지 않으면 표시한다(읽을 때 선언을 한 번 본다).
        const policy = snapshot.port(jobEventPolicyPort);
        const page = loaded.value
          .slice(0, PAGE)
          .map((job) =>
            job.trigger?.app != null &&
            !policy.declares(job.trigger.app as Id<"app">, job.trigger.event)
              ? { ...job, source_gone: true }
              : job,
          );
        return ok({
          jobs: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            loaded.value.length > PAGE ? page[page.length - 1]!.id : null,
        });
      },
    },
    runList: {
      route: jobRunList,
      handle(snapshot, _ctx, input) {
        const job = loadJob(snapshot.sql, input.job);
        if (!job.ok) return job;
        if (job.value === null) {
          return err({ code: "not_found", message: "job not found" });
        }
        const loaded = loadJobRuns(snapshot.sql, input.job, {
          ...(input.cursor === undefined ? {} : { after: input.cursor }),
          limit: PAGE + 1,
        });
        if (!loaded.ok) return loaded;
        const page = loaded.value.slice(0, PAGE);
        return ok({
          job_runs: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            loaded.value.length > PAGE ? page[page.length - 1]!.id : null,
        });
      },
    },
    pending: {
      route: jobPending,
      handle(snapshot) {
        const loaded = loadPendingJobs(snapshot.sql);
        return loaded.ok
          ? ok({
              jobs: loaded.value,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            })
          : loaded;
      },
    },
    // job마다 하나라 쪽을 나누지 않는다.
    holds: {
      route: jobHolds,
      handle(snapshot) {
        const loaded = loadHolds(snapshot.sql);
        if (!loaded.ok) return loaded;
        const holds = turnsOf(snapshot.sql, loaded.value);
        return holds.ok
          ? ok({
              holds: holds.value,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            })
          : holds;
      },
    },
    open: {
      route: jobRunOpen,
      handle(snapshot) {
        const loaded = loadOpenRuns(snapshot.sql);
        if (!loaded.ok) return loaded;
        const open = turnsOf(snapshot.sql, loaded.value);
        return open.ok
          ? ok({
              open: open.value,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            })
          : open;
      },
    },
    activity: {
      route: jobActivity,
      handle(snapshot) {
        const busy = hasActivity(snapshot.sql);
        return busy.ok
          ? ok({
              busy: busy.value,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            })
          : busy;
      },
    },
  };
}
