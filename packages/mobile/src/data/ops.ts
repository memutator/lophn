// What the Jobs and Agents screens read. Jobs go through the desktop's Jobs source (names, runs, switch) and its wording
// (model.ts); agents are the core's agent list and card.
import { useMemo } from "react";
import type { Modality } from "../../../protocol/lophn-agent/agent-values.ts";
import {
  type AgentRow,
  agentCard,
  agentList,
} from "../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type AgentId,
  isCodingBuiltin,
  isLophn,
  LOPHN_HOME_ID,
  lophnIdOf,
  type Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import type { AgentProfile } from "../../../shell/renderer/conversation/agent-tab-source.ts";
import {
  type Loaded,
  readRoute,
  readsOf,
  useCoreRead,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import { useEventClient } from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
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
  sourceGoneText,
  STATE,
  whenOf,
  whenText,
} from "../../../shell/renderer/desktop/jobs/model.ts";

const useOpsCore = (): CoreSource => useEventClient().core;

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

// ---- who can start a session in a workspace

export interface AgentChoice {
  readonly agent: AgentId;
  readonly name: string;
  readonly profile: AgentProfile;
  /** Bound to one project or app; false when it works in every workspace. */
  readonly scoped: boolean;
}

const sameWorkspace = (
  a: { kind: string; id: string } | null,
  b: Workspace | null,
) => (a === null ? b === null : b !== null && a.kind === b.kind && a.id === b.id);

/**
 * The lophn agents that can work in this workspace: its own lophn first, then the global agents and the ones scoped to
 * it. Coding agents are left out; the phone does not run them yet.
 */
export function useAgentChoices(
  workspace: Workspace | null,
): readonly AgentChoice[] {
  const read = useCoreRead(
    agentList,
    workspace === null ? {} : { workspace },
  ).loaded;
  return useMemo(() => {
    if (read.state !== "ready") return [];
    const own = lophnIdOf(workspace);
    return read.value.agents
      .filter((row) =>
        isLophn(row.agent)
          ? row.agent === own
          : !isCodingBuiltin(row.agent) &&
            (row.workspace === null || sameWorkspace(row.workspace, workspace)),
      )
      .map((row) => ({
        agent: row.agent,
        name: row.name,
        profile:
          row.profile.kind === "character"
            ? row.profile
            : { kind: "initial" as const, text: row.name.slice(0, 1) },
        scoped: row.workspace !== null,
      }))
      .sort((a, b) => Number(b.agent === own) - Number(a.agent === own));
  }, [read, workspace]);
}
