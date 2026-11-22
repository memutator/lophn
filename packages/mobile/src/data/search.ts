// Search: one box finds sessions, workflows, files, jobs and agents of the computer on screen. The phone already holds the
// session list (`useWorkspaces`), and reads the job and agent lists and each project's workflow runs once and follows them;
// those are filtered here as the person types. Files are the only read that depends on the words (`project.search`, the same
// keyword search the desktop palette uses), so only that read waits for a pause in typing.
import { t } from "@lophn/i18n";
import { useEffect, useMemo, useState } from "react";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import { agentList } from "../../../protocol/lophn-agent/agent-definitions.ts";
import { jobList, type JobRecord } from "../../../protocol/jobs/jobs.ts";
import { projectSearch } from "../../../protocol/projects/project-search.ts";
import { workflowInstanceList } from "../../../protocol/workflows/routes.ts";
import type { WorkflowInstanceSummary } from "../../../protocol/workflows/instances.ts";
import {
  readRoute,
  readsOf,
  useCoreRead,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import { whenOf } from "../../../shell/renderer/desktop/jobs/model.ts";
import { useMachineNameOf, useNames, useWorkspaces } from "./hooks.tsx";
import { type SessionRow, type Who, whoOf } from "./workspaces.ts";

const SESSIONS_SHOWN = 20;
const OTHERS_SHOWN = 10;
// One letter would match every file; the read starts from two.
const FILES_FROM = 2;
const FILES_PER_PROJECT = 6;
const PAUSE_MS = 300;

export interface SessionHit {
  readonly row: SessionRow;
  readonly workspaceName: string;
}

export interface WorkflowHit {
  readonly project: string;
  readonly projectName: string;
  readonly run: string;
  readonly workflow: string;
  readonly state: "human" | "running" | "ended" | "stopped";
}

export interface FileHit {
  readonly project: string;
  readonly projectName: string;
  /** The registered folder it is in (absolute); a project may have more than one. */
  readonly folder: string;
  /** Relative to `folder`, as the file place takes it. */
  readonly path: string;
  readonly name: string;
  /** The folders above it, joined by " / ". Empty for a file at the top. */
  readonly folders: string;
}

export interface JobHit {
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly enabled: boolean;
}

export interface AgentHit {
  readonly id: AgentId;
  readonly name: string;
  readonly sub: string;
  readonly who: Who;
}

export interface SearchResults {
  readonly sessions: readonly SessionHit[];
  readonly workflows: readonly WorkflowHit[];
  readonly files: readonly FileHit[];
  readonly jobs: readonly JobHit[];
  readonly agents: readonly AgentHit[];
}

/** The value after it stopped changing for `ms`. */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const has = (text: string | null | undefined, needle: string) =>
  text?.toLowerCase().includes(needle) === true;

function workflowStateOf(run: WorkflowInstanceSummary): WorkflowHit["state"] {
  return run.state === "running" && run.current?.human_turn === true
    ? "human"
    : run.state;
}

export function useSearch(query: string): SearchResults {
  const needle = query.trim().toLowerCase();
  const workspaces = useWorkspaces();
  const names = useNames();
  const machineNameOf = useMachineNameOf();
  const projects = names.list.projects;

  const jobs = useCoreRead(jobList, {}).loaded;
  const agents = useCoreRead(agentList, {}).loaded;

  // The newest runs of every project, one read each; the person's words pick among them.
  const runs = useFollowedRead<WorkflowInstanceSummary[]>(
    async (core) => {
      const found = await Promise.all(
        projects.map(async (project) => {
          const read = await readRoute(core, workflowInstanceList, {
            project: project.id,
          });
          return read.ok ? read.value.instances : [];
        }),
      );
      return { ok: true as const, value: found.flat() };
    },
    projects.flatMap((project) =>
      readsOf(workflowInstanceList, { project: project.id }),
    ),
    projects.map((project) => project.id).join(),
  ).loaded;

  const settled = useSettled(needle, PAUSE_MS);
  const files = useFollowedRead<FileHit[]>(
    async (core) => {
      if (settled.length < FILES_FROM) return { ok: true as const, value: [] };
      const found = await Promise.all(
        projects.map(async (project) => {
          const read = await readRoute(core, projectSearch, {
            project: project.id,
            query: settled,
            limit: FILES_PER_PROJECT * 4,
          });
          if (!read.ok) return [];
          // Matches come per line; a file with many lines is one hit.
          const files = new Map(
            read.value.matches.map((m) => [`${m.folder_path}\0${m.path}`, m]),
          );
          return [...files.values()].slice(0, FILES_PER_PROJECT).map(({ folder_path, path }): FileHit => {
            const parts = path.split("/");
            return {
              project: project.id,
              projectName: project.title,
              folder: folder_path,
              path,
              name: parts.at(-1) ?? path,
              folders: parts.slice(0, -1).join(" / "),
            };
          });
        }),
      );
      return { ok: true as const, value: found.flat() };
    },
    [],
    `${projects.map((project) => project.id).join()}|${settled}`,
  ).loaded;

  return useMemo(() => {
    if (needle === "") {
      return { sessions: [], workflows: [], files: [], jobs: [], agents: [] };
    }
    const home = t("left-sidebar.label.home");
    const sessions = workspaces
      .flatMap((workspace) =>
        [...workspace.groups.flatMap((group) => group.rows), ...workspace.recent]
          .filter((row) => has(row.title ?? t("left-sidebar.label.untitled"), needle))
          .map((row) => ({ row, workspaceName: workspace.name ?? home })),
      )
      .sort((a, b) => b.row.at - a.row.at)
      .slice(0, SESSIONS_SHOWN);

    // The newest run of each workflow.
    const seen = new Set<string>();
    const workflows: WorkflowHit[] = [];
    if (runs.state === "ready") {
      for (const run of [...runs.value].sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      )) {
        const key = `${run.project}\0${run.workflow}`;
        if (seen.has(key) || !has(run.workflow, needle)) continue;
        seen.add(key);
        workflows.push({
          project: run.project,
          projectName:
            projects.find((project) => project.id === run.project)?.title ??
            run.project,
          run: run.id,
          workflow: run.workflow,
          state: workflowStateOf(run),
        });
      }
    }

    const jobHits =
      jobs.state === "ready"
        ? jobs.value.jobs
            .filter((job: JobRecord) => has(job.title, needle))
            .map((job) => ({
              id: job.id,
              title: job.title,
              when: whenOf(job, machineNameOf),
              enabled: job.enabled,
            }))
        : [];

    const agentHits =
      agents.state === "ready"
        ? agents.value.agents
            .filter((row) => has(row.name, needle) || has(row.handle, needle))
            .flatMap((row) => {
              const who = whoOf(row.agent, {
                titles: new Map(),
                agents: new Map([
                  [row.agent, { name: row.name, avatar: row.avatar }],
                ]),
              });
              return who === null
                ? []
                : [
                    {
                      id: row.agent,
                      name: row.name,
                      sub:
                        row.description ??
                        (row.workspace === null
                          ? home
                          : (projects.find((p) => p.id === row.workspace?.id)
                              ?.title ??
                            names.apps.get(row.workspace.id) ??
                            home)),
                      who,
                    },
                  ];
            })
        : [];

    return {
      sessions,
      workflows: workflows.slice(0, OTHERS_SHOWN),
      // A file read for words the person has since changed is not shown.
      files:
        files.state === "ready" && settled === needle
          ? files.value.slice(0, OTHERS_SHOWN)
          : [],
      jobs: jobHits.slice(0, OTHERS_SHOWN),
      agents: agentHits.slice(0, OTHERS_SHOWN),
    };
  }, [
    needle,
    settled,
    workspaces,
    runs,
    jobs,
    agents,
    files,
    projects,
    names,
    machineNameOf,
  ]);
}
