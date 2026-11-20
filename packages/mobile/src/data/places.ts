// What the project and app workspace screens read beyond the workspace list: a project's workflows, files and jobs, an app's
// runs and release: plain reads of the routes the phone may call. The sample computer answers them from its fake core.
import type { z } from "zod";
import { releasesListRecords } from "../../../protocol/apps/activation/activation.ts";
import { annotationSend } from "../../../protocol/apps/annotation.ts";
import { jobList } from "../../../protocol/jobs/jobs.ts";
import { lophnIdOf } from "../../../protocol/lophn-agent/workspaces.ts";
import { projectApi } from "../../../protocol/projects/project-api.ts";
import {
  type ProjectFileEntry,
  projectFilesList,
  projectFilesRead,
} from "../../../protocol/projects/project-files.ts";
import { runList } from "../../../protocol/runs/runs.ts";
import {
  type ReportLine,
  type WorkflowEntry,
  type WorkflowInstance,
  type WorkflowInstanceSummary,
  type WorkflowLine,
} from "../../../protocol/workflows/instances.ts";
import {
  workflowInstanceList,
  workflowInstanceRead,
  workflowList,
  workflowStart,
  workflowStop,
} from "../../../protocol/workflows/routes.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import {
  type ReadHandle,
  useFollowedRead,
} from "../../../shell/renderer/desktop/connection/core-read.ts";
import {
  useEventClient,
  useSessions,
} from "../../../shell/renderer/desktop/connection/events/hooks.tsx";
import { jobsOfProject } from "../../../shell/renderer/desktop/jobs/model.ts";
import type { JobView } from "../../../shell/renderer/desktop/jobs/source.ts";
import { ask } from "./ask.ts";
import type { ConversationTarget } from "./hooks.tsx";

export type { ReadHandle } from "../../../shell/renderer/desktop/connection/core-read.ts";
export type { ProjectFileEntry } from "../../../protocol/projects/project-files.ts";

const ok = <T>(value: T) => ({ ok: true, value }) as const;
const useCore = (): CoreSource => useEventClient().core;

// ---- a session to open from a workflow

/** Where to open a session that is only known by its id (a workflow hands its step to one). Null while the list has not got it. */
export function useSessionTarget(
  session: string | null,
): ConversationTarget | null {
  const { sessions } = useSessions();
  const found = sessions.find((one) => one.session === session);
  return found === undefined
    ? null
    : {
        session: found.session,
        agent: found.agent ?? lophnIdOf(found.workspace),
        workspace: found.workspace,
      };
}

// ---- workflows

export type WorkflowDefinition = WorkflowEntry;
export type WorkflowRunSummary = WorkflowInstanceSummary;

export interface WorkflowDetail {
  readonly instance: WorkflowInstance;
  /** The last report of each step. */
  readonly last_reports: Readonly<Record<string, ReportLine>>;
  readonly lines: readonly WorkflowLine[];
}

// Every list the core pages through is read to its end, up to this many pages.
const PAGE_LIMIT = 20;

export interface Workflows {
  readonly definitions: readonly WorkflowEntry[];
  /** Newest first, every workflow of the project. */
  readonly instances: readonly WorkflowInstanceSummary[];
}

export interface WorkflowsHandle extends ReadHandle<Workflows> {
  /** Starts a run of the workflow with the text its first step works on. Resolves to the new run's id, or null when it did not start. */
  start(entry: WorkflowEntry, text: string): Promise<string | null>;
}

export function useWorkflows(project: string): WorkflowsHandle {
  const core = useCore();
  const read = useFollowedRead<Workflows>(
    async () => {
      const definitions = await ask(core, workflowList, { project });
      if (!definitions.ok) return { ok: false };
      const instances: WorkflowInstanceSummary[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const read = await ask(core, workflowInstanceList, {
          project,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!read.ok) return { ok: false };
        instances.push(...read.value.instances);
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return ok({ definitions: definitions.value.workflows, instances });
    },
    ["workflow_instances"],
    project,
  );
  return {
    ...read,
    async start(entry, text) {
      const started = await ask(core, workflowStart, {
        workflow: entry.key,
        text,
      });
      if (!started.ok) return null;
      read.reload();
      return started.value.instance.id;
    },
  };
}

export interface WorkflowRun extends ReadHandle<WorkflowDetail> {
  stop(): Promise<boolean>;
}

export function useWorkflowRun(instance: string): WorkflowRun {
  const core = useCore();
  const read = useFollowedRead<WorkflowDetail>(
    async () => {
      const lines: WorkflowLine[] = [];
      let cursor: string | undefined;
      let last: Awaited<ReturnType<typeof readOnce>> | null = null;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const one = await readOnce(core, instance, cursor);
        if (!one.ok) return { ok: false };
        last = one;
        lines.push(...one.value.lines);
        if (one.value.next_cursor === null) break;
        cursor = one.value.next_cursor;
      }
      return last?.ok === true
        ? ok({
            instance: last.value.instance,
            last_reports: last.value.last_reports,
            lines,
          })
        : { ok: false };
    },
    [{ name: "workflow_instances", id: instance }],
    instance,
  );
  return {
    ...read,
    async stop() {
      const stopped = await ask(core, workflowStop, { instance });
      read.reload();
      return stopped.ok;
    },
  };
}

// A run's lines come 200 at a time, oldest first.
const readOnce = (core: CoreSource, instance: string, cursor?: string) =>
  ask(core, workflowInstanceRead, {
    instance,
    ...(cursor === undefined ? {} : { cursor }),
  });

// ---- files

export interface ProjectFolder {
  /** Absolute, on the computer. */
  readonly path: string;
  /** Its last name, as the folder pick shows it. */
  readonly name: string;
}

/** The project's registered folders, in its order; the first is the one a file without a folder is read from. */
export function useProjectFolders(
  project: string,
): ReadHandle<readonly ProjectFolder[]> {
  const core = useCore();
  return useFollowedRead<readonly ProjectFolder[]>(
    async () => {
      const read = await ask(core, projectApi.get, {
        project: project as `prj_${string}`,
      });
      return read.ok
        ? ok(
            read.value.project.folders.map((folder) => ({
              path: folder.path,
              name: folder.path.split(/[\\/]/).filter(Boolean).at(-1) ?? folder.path,
            })),
          )
        : { ok: false };
    },
    [{ name: "projects", id: project }],
    project,
  );
}

/** `folder` (absolute, null for the project's first): only a project with more than one folder has to say. */
const inFolder = (folder: string | null | undefined) =>
  folder === null || folder === undefined ? {} : { folder };

/** The folder `path` (relative to `folder`, the first when not given; "" for its root): folders first, then files by name. */
export function useProjectFiles(
  project: string,
  path: string,
  folder?: string | null,
): ReadHandle<readonly ProjectFileEntry[]> {
  const core = useCore();
  return useFollowedRead<readonly ProjectFileEntry[]>(
    async () => {
      const listed = await ask(core, projectFilesList, {
        project,
        ...inFolder(folder),
        ...(path === "" ? {} : { path }),
      });
      return listed.ok ? ok(listed.value.entries) : { ok: false };
    },
    [],
    `${project}\0${folder ?? ""}\0${path}`,
  );
}

export type FileContent =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly truncated: boolean;
    }
  /** The core only reads UTF-8 text; anything else is opened on the computer. */
  | { readonly kind: "not-text" };

export function useProjectFile(
  project: string,
  path: string,
  folder?: string,
): ReadHandle<FileContent> {
  const core = useCore();
  return useFollowedRead<FileContent>(
    async () => {
      const read = await ask(core, projectFilesRead, {
        project,
        path,
        ...inFolder(folder),
      });
      if (read.ok) return ok({ kind: "text", ...read.value } as const);
      return read.code === "invalid_input"
        ? ok({ kind: "not-text" } as const)
        : { ok: false };
    },
    [],
    `${project}\0${folder ?? ""}\0${path}`,
  );
}

// ---- a project's jobs

/** The jobs that belong to a project (made in it, asking its agents, starting its workflows), read-only. */
export function useProjectJobs(
  project: string,
): ReadHandle<readonly JobView[]> {
  const core = useCore();
  return useFollowedRead<readonly JobView[]>(
    async () => {
      const jobs: JobView[] = [];
      let cursor: string | undefined;
      // 20 pages of 50 are far more jobs than a phone list can show.
      for (let page = 0; page < 20; page += 1) {
        const read = await ask(
          core,
          jobList,
          cursor === undefined ? {} : { cursor },
        );
        if (!read.ok) return { ok: false };
        jobs.push(...(read.value.jobs as readonly JobView[]));
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return ok(jobsOfProject(jobs, project));
    },
    ["jobs"],
    project,
  );
}

// ---- an app's runs and release

export interface ActivityRun {
  readonly id: string;
  /** The tool a tool run called; null for an agent run. */
  readonly tool: string | null;
  readonly state: "running" | "done" | "failed" | "cancelled";
  readonly at: string;
  /** A job started it. */
  readonly job: boolean;
  /** Why a failed run failed. */
  readonly error: string | null;
  /** The session an agent run opened (lophn opens one when a run fails). */
  readonly session: string | null;
}

/** The newest runs in the app's workspace, newest first. */
export function useAppActivity(
  app: string,
): ReadHandle<readonly ActivityRun[]> {
  const core = useCore();
  return useFollowedRead<readonly ActivityRun[]>(
    async () => {
      const read = await ask(core, runList, { workspace: { app } });
      return read.ok
        ? ok(
            read.value.runs.map((run) => ({
              id: run.id,
              tool: "tool" in run.target ? run.target.tool : null,
              state: run.state,
              at: run.created_at,
              job: run.job !== null,
              error: run.error?.message ?? null,
              session: run.session,
            })),
          )
        : { ok: false };
    },
    ["runs"],
    app,
  );
}

export interface AppRelease {
  readonly id: string;
  readonly number: number;
  readonly activatedAt: string;
}

/** The release that is live, or null before the app has one. */
export function useAppRelease(app: string): ReadHandle<AppRelease | null> {
  const core = useCore();
  return useFollowedRead<AppRelease | null>(
    async () => {
      const read = await ask(core, releasesListRecords, {
        app,
        status: "active",
        limit: 1,
      });
      if (!read.ok) return { ok: false };
      const live = read.value.releases[0];
      return ok(
        live === undefined
          ? null
          : {
              id: live.id,
              number: live.number,
              activatedAt: live.activated_at ?? live.created_at,
            },
      );
    },
    [{ name: "releases", id: app }],
    app,
  );
}

/** Sends a single screen annotation to the app's agent session on the computer. */
export function useSendAppAnnotation() {
  const core = useCore();
  return async (input: {
    app: string;
    release: string;
    screen: string;
    note: string;
    xRatio: number;
    yPx: number;
  }): Promise<{ ok: true; session: string } | { ok: false }> => {
    const sent = await ask(core, annotationSend, {
      target: { kind: "app", app: input.app },
      session: null,
      annotations: [
        {
          n: 1,
          kind: "region",
          note: input.note,
          screenshot: null,
          component: null,
          element: { role: null, name: null, text: null },
          rect: {
            x_ratio: Math.max(0, Math.min(1, input.xRatio)),
            width_ratio: 0.1,
            y_px: Math.max(0, Math.round(input.yPx)),
            height_px: 44,
            scroll_x: 0,
            scroll_y: 0,
          },
          view: { screen: input.screen, path: "" },
          release: input.release,
          preview_bundle: null,
        },
      ],
    });
    return sent.ok ? { ok: true, session: sent.value.session } : { ok: false };
  };
}
