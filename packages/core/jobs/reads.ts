import { err, ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import {
  jobHolds,
  jobList,
  jobRunList,
  jobRunOpen,
  type JobRunRecord,
  type JobTurn,
} from "../../protocol/jobs/mod.ts";
import type { AgentAtPlace } from "../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import { jobTargetsPort } from "./ports.ts";
import {
  loadHolds,
  loadJob,
  loadJobRuns,
  loadJobs,
  loadOpenRuns,
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
  holds: ReadDefinition<typeof jobHolds>;
  open: ReadDefinition<typeof jobRunOpen>;
} {
  return {
    list: {
      route: jobList,
      handle(snapshot, ctx, input) {
        const actor = parseActor(ctx.actor);
        let creator: AgentAtPlace | undefined;
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
        const page = loaded.value.slice(0, PAGE);
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
  };
}
