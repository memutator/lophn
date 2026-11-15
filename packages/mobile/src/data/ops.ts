// What the Jobs and Agents screens read. Jobs go through the desktop's Jobs source (names, runs, switch) and its wording
// (model.ts); agents are the core's agent list and card. On the sample computer the same calls are answered from made-up
// jobs and agents below, kept in memory, because the sample's own fake core (sample.ts) knows neither.
import { useMemo } from "react";
import type { Modality } from "../../../protocol/lophn-agent/agent-values.ts";
import {
  type AgentCard,
  type AgentRow,
  agentCard,
  agentList,
} from "../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type AgentId,
  isCodingBuiltin,
  isLophn,
  LOPHN_HOME_ID,
  type Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  type Loaded,
  readRoute,
  readsOf,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { JOB_HOLD_AGENT } from "../../../shell/renderer/desktop/connection/waiting/fake-source.ts";
import { coreJobsSource } from "../../../shell/renderer/desktop/jobs/core-source.ts";
import type {
  JobNames,
  JobRunView,
  JobView,
} from "../../../shell/renderer/desktop/jobs/source.ts";
import { codingFaceOf } from "../../../shell/renderer/workspace/agents/coding-face.ts";
import {
  useCurrentComputer,
  useInbox,
  useNames,
  useSampleConversation,
  useWorkspaces,
  type ConversationTarget,
} from "./hooks.tsx";
import type { Who } from "./workspaces.ts";

export type { JobNames, JobRunView, JobView, Loaded };
export {
  actionText,
  agentName,
  creatorText,
  MISSED_OPTIONS,
  nextText,
  runText,
  runWhen,
  sourceGoneText,
  STATE,
  whenOf,
  whenText,
} from "../../../shell/renderer/desktop/jobs/model.ts";

// Hermes (the dev build) has neither Intl.PluralRules, which every ICU `plural` in the catalog needs, nor
// Intl.RelativeTimeFormat, which `formatRelativeTime` ("21 hours ago") builds on. English only, like the catalog. Any
// screen with a plural needs them; whichever loads first gives them.
const scope = Intl as { PluralRules?: unknown; RelativeTimeFormat?: unknown };
scope.PluralRules ??= class {
  select(n: number): string {
    return n === 1 ? "one" : "other";
  }
};
scope.RelativeTimeFormat ??= class {
  format(value: number, unit: string): string {
    const near: Record<string, [string, string, string]> = {
      day: ["yesterday", "today", "tomorrow"],
      week: ["last week", "this week", "next week"],
      month: ["last month", "this month", "next month"],
      year: ["last year", "this year", "next year"],
      hour: ["", "this hour", ""],
      minute: ["", "this minute", ""],
      second: ["", "now", ""],
    };
    const word =
      Math.abs(value) <= 1 ? near[unit]?.[Math.sign(value) + 1] : undefined;
    if (word) return word;
    const n = Math.abs(value);
    const span = `${n} ${unit}${n === 1 ? "" : "s"}`;
    return value < 0 ? `${span} ago` : `in ${span}`;
  }
};

function useOpsCore(): CoreSource {
  const client = useEventClient();
  const sample = useSampleConversation() !== null;
  return useMemo(
    () => (sample ? sampleOps(client.core) : client.core),
    [client, sample],
  );
}

// What each computer's screens last read, so a screen opened while the computer is away (or still reading) shows that
// instead of nothing. Weak, so a removed computer takes its memory with it.
const LAST = new WeakMap<object, Map<string, unknown>>();

function useRemembered<T>(key: string, loaded: Loaded<T>): Loaded<T> {
  const client = useEventClient();
  const memory = LAST.get(client) ?? new Map<string, unknown>();
  LAST.set(client, memory);
  if (loaded.state === "ready") memory.set(key, loaded.value);
  else if (memory.has(key)) {
    return {
      state: "ready",
      value: memory.get(key) as T,
      staleSince: new Date(),
    };
  }
  return loaded;
}

/** The computer is not answering: what shows is what was last read, and nothing can be changed. */
function useLocked(): boolean {
  return useCurrentComputer()?.status !== "connected";
}

// ---- Jobs

export interface Jobs {
  readonly loaded: Loaded<{
    readonly jobs: readonly JobView[];
    readonly names: JobNames;
  }>;
  readonly locked: boolean;
  /** Whether a missed turn of this job waits for the person: only then Start now has something to run. */
  held(job: string): boolean;
  setEnabled(job: string, enabled: boolean): Promise<boolean>;
  /** Runs the job's missed turn now. */
  startNow(job: string): Promise<boolean>;
  reload(): void;
}

export function useJobs(): Jobs {
  const core = useOpsCore();
  const source = useMemo(() => coreJobsSource(core), [core]);
  const read = useFollowedRead(() => source.list(), ["jobs"], "");
  const { reload } = read;
  const loaded = useRemembered("jobs", read.loaded);
  const inbox = useInbox();
  const locked = useLocked();
  const holdOf = (job: string) =>
    inbox.entries.find(
      (entry) => entry.kind === "job_hold" && entry.hold.job.id === job,
    );
  return {
    loaded,
    locked,
    held: (job) => holdOf(job) !== undefined,
    async setEnabled(job, enabled) {
      const sent = await source.setEnabled(job, enabled);
      reload();
      return sent.ok;
    },
    async startNow(job) {
      const entry = holdOf(job);
      if (entry === undefined || entry.kind !== "job_hold") return false;
      const done = await inbox.jobHold(entry, "run_now");
      reload();
      return done.ok;
    },
    reload,
  };
}

/** A job's runs, newest first. */
export function useJobRuns(job: string): Loaded<readonly JobRunView[]> {
  const core = useOpsCore();
  const source = useMemo(() => coreJobsSource(core), [core]);
  const read = useFollowedRead(
    () => source.runs(job),
    [{ name: "jobs", id: job }],
    job,
  ).loaded;
  return useRemembered(`runs:${job}`, read);
}

// ---- Agents

export type AgentScope =
  | { readonly kind: "home" }
  | { readonly kind: "every" }
  | { readonly kind: "in"; readonly name: string };

export interface AgentItem {
  readonly id: AgentId;
  readonly name: string;
  readonly face: Who["profile"];
  /** The Home lophn, which every computer has. */
  readonly builtIn: boolean;
  /** Claude Code, Codex: the person's own coding agents, not lophn's. */
  readonly coding: boolean;
  readonly scope: AgentScope;
  /** Where its sessions open: the project or app it is bound to, null when it works anywhere. */
  readonly workspace: Workspace | null;
  readonly description: string | null;
  /** The model the agent runs on, as the core names it. */
  readonly model: string | null;
  readonly skills: number | null;
  /** Needed to read its card. */
  readonly handle: string;
}

async function readAgents(core: CoreSource) {
  // No workspace asked: every agent of the computer, the Home lophn among them. Each project's and app's own lophn is
  // left out, as the desktop's Home list does; the rest is global or bound to one project or app.
  const read = await readRoute(core, agentList, {});
  return read.ok
    ? {
        ok: true as const,
        value: read.value.agents.filter(
          (row) => !isLophn(row.agent) || row.workspace === null,
        ),
      }
    : read;
}

export function useAgents(): {
  readonly loaded: Loaded<readonly AgentItem[]>;
  readonly locked: boolean;
  reload(): void;
} {
  const core = useOpsCore();
  const names = useNames();
  const locked = useLocked();
  const read = useFollowedRead(
    () => readAgents(core),
    ["agents", "models"],
    "",
  );
  const { reload } = read;
  const loaded = useRemembered("agents", read.loaded);
  const items = useMemo((): Loaded<readonly AgentItem[]> => {
    if (loaded.state !== "ready") return loaded;
    const nameOf = (workspace: NonNullable<AgentRow["workspace"]>) =>
      (workspace.kind === "app" ? names.apps : names.projects).get(
        workspace.id,
      ) ?? "";
    return {
      ...loaded,
      value: loaded.value.map((row) => ({
        id: row.agent,
        name: row.name,
        face:
          codingFaceOf(row.agent) ??
          (row.profile.kind === "character"
            ? row.profile
            : { kind: "initial", text: row.name.slice(0, 1) }),
        builtIn: row.agent === LOPHN_HOME_ID,
        coding: isCodingBuiltin(row.agent),
        scope:
          row.agent === LOPHN_HOME_ID
            ? { kind: "home" }
            : row.workspace === null
              ? { kind: "every" }
              : { kind: "in", name: nameOf(row.workspace) },
        workspace: row.workspace,
        description: row.description ?? null,
        model: row.model?.model_name ?? null,
        skills: row.counts.skills,
        handle: row.handle,
      })),
    };
  }, [loaded, names]);
  return { loaded: items, locked, reload };
}

/** What the agent takes in: its card says it, the list does not. Null until read. */
export function useAgentTakes(
  agent: AgentItem | undefined,
): readonly Modality[] | null {
  const core = useOpsCore();
  const input = {
    handle: agent?.handle ?? "",
    ...(agent?.workspace == null ? {} : { workspace: agent.workspace }),
  };
  const { loaded } = useFollowedRead(
    async () => {
      if (agent === undefined) return { ok: false as const };
      const read = await readRoute(core, agentCard, input);
      return read.ok
        ? { ok: true as const, value: read.value.card.modality.input }
        : read;
    },
    readsOf(agentCard, input),
    `${agent?.id ?? ""}`,
  );
  return loaded.state === "ready" ? loaded.value : null;
}

export interface AgentSession {
  readonly target: ConversationTarget;
  readonly title: string | null;
  /** The project or app the session lives in; null for Home. */
  readonly workspaceName: string | null;
  /** Last activity in epoch ms. */
  readonly at: number;
  readonly working: boolean;
}

/** Every session the phone lists (open ones and the last week's), newest first, with the agent that runs it. */
export function useAgentSessions(): ReadonlyMap<
  AgentId,
  readonly AgentSession[]
> {
  const workspaces = useWorkspaces();
  return useMemo(() => {
    const by = new Map<AgentId, AgentSession[]>();
    for (const view of workspaces) {
      for (const row of [
        ...view.groups.flatMap((g) => g.rows),
        ...view.recent,
      ]) {
        if (row.agent === null) continue;
        by.set(row.agent, [
          ...(by.get(row.agent) ?? []),
          {
            target: {
              session: row.id,
              agent: row.agent,
              workspace: row.workspace,
            },
            title: row.title,
            workspaceName: view.name,
            at: row.at,
            working: row.status === "working",
          },
        ]);
      }
    }
    for (const rows of by.values()) rows.sort((a, b) => b.at - a.at);
    return by;
  }, [workspaces]);
}

// ---- the sample computer's jobs and agents

// The ids sample.ts gives its project, apps and Experiment planner, so sessions and names line up with these.
const PHRONER = "prj_01h455vb4pex5v6nkc6gd5f001";
const ORDERS = "app_01h455vb4pex5v6nkc6gd5fd01";
const PLANNER = "agt_01h455vb4pex5v6nkc6gd5p001";
const EVAL = "agt_01h455vb4pex5v6nkc6gd5p002";
const BUDGET = "agt_01h455vb4pex5v6nkc6gd5p003";

const ago = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

const profile = (shape: string, color: string) => ({
  kind: "character",
  shape,
  color,
});
const agentRow = (
  agent: string,
  name: string,
  look: ReturnType<typeof profile>,
  extra: Record<string, unknown>,
) => ({
  agent,
  handle: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  workspace: null,
  profile: look,
  model: { provider: "pvd_sample", model_name: "Sonnet 5.5", source: "global" },
  issues: [],
  counts: { skills: 5, mcp: 2 },
  ...extra,
});

function sampleJobs(): JobView[] {
  const held = JOB_HOLD_AGENT().job as JobView;
  const base = {
    trigger: null,
    fired_count: 0,
    skipped_count: 0,
    last_fired_at: null,
    last_skipped_at: null,
    last_skip_reason: null,
    source_gone: false,
    missed_policy: "run",
    enabled: true,
    approved_at: ago(24 * 30),
    at: null,
    every: null,
  } as const;
  return [
    {
      ...held,
      action: {
        kind: "agent_run",
        agent: LOPHN_HOME_ID,
        agent_workspace: null,
        prompt:
          "Summarize yesterday’s finished tasks and list the open questions for today.",
      },
      next_due_at: ago(-3),
    },
    {
      ...base,
      id: "job_sample_usage",
      title: "Wrap up at the usage limit",
      creator: { agent: BUDGET, workspace: { kind: "app", id: ORDERS } },
      trigger: {
        source: "orders",
        event: "usage.limit",
        min_interval: "5m",
        pass_event: false,
      },
      fired_count: 3,
      last_fired_at: ago(2),
      action: {
        kind: "agent_run",
        agent: BUDGET,
        agent_workspace: { kind: "app", id: ORDERS },
        prompt: "Wrap up the open work and write down where you stopped.",
      },
      next_due_at: null,
      last_run: {
        job_run: "jbr_s1",
        state: "done",
        due_at: ago(2),
        started_at: ago(2),
      },
    },
    {
      ...base,
      id: "job_sample_weekly",
      title: "Weekly review",
      creator: { agent: LOPHN_HOME_ID, workspace: null },
      every: "7d",
      at: "10:00",
      action: {
        kind: "workflow_start",
        project: PHRONER,
        workflow: "weekly-review",
      },
      next_due_at: ago(-24 * 4),
      last_run: {
        job_run: "jbr_s2",
        state: "done",
        due_at: ago(72),
        started_at: ago(72),
      },
    },
    {
      ...base,
      id: "job_sample_export",
      title: "Export orders nightly",
      creator: { agent: LOPHN_HOME_ID, workspace: null },
      every: "1d",
      at: "02:00",
      enabled: false,
      action: { kind: "tool_run", app: ORDERS, tool: "orders.export_csv" },
      next_due_at: null,
      last_run: {
        job_run: "jbr_s3",
        state: "done",
        due_at: ago(24 * 6),
        started_at: ago(24 * 6),
      },
    },
  ] as JobView[];
}

function sampleRuns(job: JobView): JobRunView[] {
  const run = (
    n: number,
    state: JobRunView["state"],
    hours: number,
    extra: Partial<JobRunView> = {},
  ): JobRunView => ({
    id: `jbr_sample_${job.id}_${n}`,
    due_at: ago(hours),
    missed_count: 0,
    state,
    reason: null,
    instance: null,
    session: null,
    started_at: state === "held" || state === "skipped" ? null : ago(hours),
    ...extra,
  });
  return job.last_run?.state === "held"
    ? [
        run(0, "held", 9),
        run(1, "done", 21, { session: "ses_01h455vb4pex5v6nkc6gd5p001" }),
        run(2, "done", 45),
        run(3, "skipped", 72, { reason: "person", missed_count: 1 }),
      ]
    : [run(1, "done", 24 * 3)];
}

const SAMPLE_OPS = new WeakMap<CoreSource, CoreSource>();

function sampleOps(inner: CoreSource): CoreSource {
  const found = SAMPLE_OPS.get(inner);
  if (found !== undefined) return found;
  const jobs = sampleJobs();
  const reply = (value: unknown) =>
    Promise.resolve({ ok: true as const, value });
  const COMMON = { as_of_seq: "0", next_cursor: null };
  const core: CoreSource = {
    ...inner,
    subscribe: inner.subscribe.bind(inner),
    call(input) {
      const key = `${input.resource}/${input.method}`;
      // A read's body is its input; a command's body wraps it as `input`.
      const body = (input.body ?? {}) as {
        job?: string;
        input?: { job: string; enabled?: boolean };
      };
      switch (key) {
        case "jobs/list":
          return reply({ ...COMMON, jobs });
        case "job_runs/list": {
          const job = jobs.find((one) => one.id === body.job);
          return reply({
            ...COMMON,
            job_runs: job === undefined ? [] : sampleRuns(job),
          });
        }
        case "jobs/update": {
          const at = jobs.findIndex((one) => one.id === body.input?.job);
          const job = jobs[at];
          if (job === undefined) {
            return Promise.resolve({
              ok: false as const,
              error: { code: "not_found", message: "sample" },
            });
          }
          const enabled = body.input?.enabled ?? job.enabled;
          jobs[at] = {
            ...job,
            enabled,
            next_due_at: enabled ? ago(-6) : null,
          };
          return reply({ job: jobs[at] });
        }
        case "agents/list":
          return reply({
            ...COMMON,
            agents: [
              agentRow(LOPHN_HOME_ID, "lophn", profile("square", "coral"), {
                handle: "lophn",
              }),
              agentRow(EVAL, "Eval analyst", profile("pear", "lavender"), {}),
              agentRow(
                PLANNER,
                "Experiment planner",
                profile("round", "blue"),
                {
                  workspace: { kind: "project", id: PHRONER },
                  description:
                    "Plans the next eval experiment from the findings, cheapest first, and writes the plan where the runner picks it up.",
                },
              ),
              agentRow(BUDGET, "Budget reviewer", profile("arch", "sage"), {
                workspace: { kind: "app", id: ORDERS },
              }),
              agentRow(
                "coding_claude",
                "Claude Code",
                profile("square", "coral"),
                {
                  model: null,
                  counts: { skills: null, mcp: null },
                  handle: "claude",
                },
              ),
              agentRow("coding_codex", "Codex", profile("square", "coral"), {
                model: null,
                counts: { skills: null, mcp: null },
                handle: "codex",
              }),
            ],
          });
        case "agents/card":
          return reply({
            card: {
              modality: { input: ["text", "image", "file"], output: ["text"] },
            } satisfies Pick<AgentCard, "modality">,
          });
        default:
          return inner.call(input);
      }
    },
  };
  SAMPLE_OPS.set(inner, core);
  return core;
}
