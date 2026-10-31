// JobsSource를 core의 job route로 만든다. 응답은 main의 contract client가 route output schema로 이미
// 검사했다. 이름은 project와 앱 목록을 한 번씩 읽어 풀고, 못 읽으면 표가 비어 화면이 짧은 id를 보인다.
import {
  jobDelete,
  jobList,
  jobRunList,
  jobUpdate,
} from "../../../../protocol/jobs/jobs.ts";
import { agentList } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { coreAppsSource } from "../../apps/core-source.ts";
import type { CoreSource } from "../connection/connection.ts";
import { readProjects } from "../places/projects/core-source.ts";
import { call, command } from "../settings/core-call.ts";
import type {
  JobNames,
  JobRunView,
  JobsSource,
  JobView,
  SourceResult,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

async function readAll<T>(
  core: CoreSource,
  route: { readonly resource: string; readonly method: string },
  input: Record<string, unknown>,
  field: string,
): Promise<SourceResult<T[]>> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const read = await call<
      { next_cursor: string | null } & Record<string, T[]>
    >(
      core,
      "read",
      route.resource,
      route.method,
      cursor === undefined ? input : { ...input, cursor },
    );
    if (!read.ok) return read;
    rows.push(...read.value[field]!);
    if (read.value.next_cursor === null) break;
    cursor = read.value.next_cursor;
  }
  return { ok: true, value: rows };
}

const key = (method: string) => `jobs-${method}-${crypto.randomUUID()}`;

export function coreJobsSource(core: CoreSource): JobsSource {
  async function write(
    sent: Promise<SourceResult<unknown>>,
  ): Promise<SourceResult<null>> {
    const result = await sent;
    return result.ok ? { ok: true, value: null } : result;
  }

  return {
    watch: (listener) => core.subscribe(listener),

    async list() {
      const jobs = await readAll<JobView>(core, jobList, {}, "jobs");
      if (!jobs.ok) return jobs;
      // place를 주지 않으면 모든 자리의 agent가 온다. 한 번에 오고 cursor는 받지 않는다.
      const [projects, apps, agents] = await Promise.all([
        readProjects(core),
        coreAppsSource(core).list(),
        call<{ agents: { agent: string; name: string }[] }>(
          core,
          "read",
          agentList.resource,
          agentList.method,
          {},
        ),
      ]);
      const names: JobNames = {
        projects: projects.ok
          ? Object.fromEntries(projects.value.map((one) => [one.id, one.title]))
          : {},
        apps: apps.ok
          ? Object.fromEntries(apps.value.map((one) => [one.id, one.name]))
          : {},
        agents: agents.ok
          ? Object.fromEntries(
              agents.value.agents.map((row) => [row.agent, row.name]),
            )
          : {},
      };
      return { ok: true, value: { jobs: jobs.value, names } };
    },

    runs: (job) => readAll<JobRunView>(core, jobRunList, { job }, "job_runs"),

    setEnabled: (job, enabled) =>
      write(
        command(core, jobUpdate, {
          input: { job, enabled },
          compare: {},
          key: key(jobUpdate.method),
        }),
      ),

    update: (job, patch) =>
      write(
        command(core, jobUpdate, {
          input: { job, ...patch },
          compare: {},
          key: key(jobUpdate.method),
        }),
      ),

    remove: (job) =>
      write(
        command(core, jobDelete, {
          input: { job },
          compare: {},
          key: key(jobDelete.method),
        }),
      ),
  };
}
