// 제품 core 통로의 WorkspaceSource. token·port는 main에 있고 이 쪽은 route 이름과 입력만 보낸다.
// 응답은 main의 contract client가 route output schema로 이미 검사했다. 아래 응답 모양은
// projects.get, documents.list·get, files.list schema에서 작업대가 읽는 field만
// 옮긴 것이다. layout 저장·복원은 preload의 lophnLayout이 있을 때만 main 통로를 쓴다.
// bridge가 없으면 읽지 못함으로 답하고 작업대는 빈 배치로 시작한다.

import { jobList } from "../../../protocol/jobs/jobs.ts";
import { projectApi } from "../../../protocol/projects/project-api.ts";
import type { FileReply, FilesApi } from "../../ipc/files.ts";
import { commandCall } from "../command-call.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import {
  readProjects,
  windowFolderPicker,
} from "../desktop/workspaces/projects/core-source.ts";
import { createLayoutSource } from "../shell/layout-source.ts";
import { coreAgentsSource } from "./agents/core-source.ts";
import { coreFileSearchSource } from "./search/core-source.ts";
import type {
  FileOpResult,
  FileRow,
  ProjectView,
  ReadResult,
  WorkflowEntryView,
  WorkflowInstanceFilter,
  WorkflowInstanceSummaryView,
  WorkflowInstanceView,
  WorkflowLineView,
  WorkflowStartedBy,
  WorkspaceSource,
} from "./source.ts";

interface DocumentRow {
  id: string;
  title: string;
}

interface ProjectGetValue {
  project: {
    id: string;
    identity: string;
    former_identities?: string[];
    title: string;
    revision: string;
    folders?: {
      path: string;
      description?: string;
      found?: boolean;
    }[];
  };
}

/** core가 주는 started_by. 제목은 화면이 `job.list`로 붙인다. */
type RawStartedBy = { kind: "user" } | { kind: "job"; job: string };

interface WorkflowListValue {
  workflows: (Omit<WorkflowEntryView, "invalid"> & {
    state: "ok" | "invalid";
  })[];
}

interface WorkflowInstanceListValue {
  instances: (Omit<WorkflowInstanceSummaryView, "started_by"> & {
    started_by: RawStartedBy;
  })[];
  next_cursor: string | null;
}

interface WorkflowReadValue {
  instance: Omit<WorkflowInstanceView, "started_by"> & {
    started_by: RawStartedBy;
  };
  last_reports: Record<string, WorkflowLineView>;
  lines: WorkflowLineView[];
  next_cursor: string | null;
}

interface DocumentListValue {
  documents: { document: { id: string; title: string } }[];
  next_cursor: string | null;
}

interface DocumentGetValue {
  document: {
    id: string;
    title: string;
    file_source?:
      | { kind: "project_file"; project: string; path: string }
      | { kind: "instruction_file"; path: string }
      | null;
  };
}

interface FileListValue {
  targets: { kind: string; project?: string; path?: string }[];
  next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;
/** 파일과 문서를 잇느라 문서마다 읽는 상한. 넘는 문서의 파일은 팔레트에 없다. */
const FILE_DOCUMENT_LIMIT = 200;

type Page<T> = { items: T[]; next: string | null };

type JobTitles = ReadonlyMap<string, string>;

// job 제목 표. 제목은 꾸밈이라 읽기에 실패하면 빈 표로 두고 run·instance 읽기는 그대로 간다.
async function readJobTitles(core: CoreSource): Promise<JobTitles> {
  const read = await collect<{ id: string; title: string }>(
    core,
    jobList.resource,
    jobList.method,
    {},
    (value) => {
      const page = value as {
        jobs: { id: string; title: string }[];
        next_cursor: string | null;
      };
      return { items: page.jobs, next: page.next_cursor };
    },
  );
  return new Map(
    read.ok ? read.value.map((job) => [job.id, job.title] as const) : [],
  );
}

// job이 하나도 없으면 `job.list`를 읽지 않는다.
async function titlesFor(
  core: CoreSource,
  jobs: readonly (string | null)[],
): Promise<JobTitles> {
  return jobs.some((job) => job !== null)
    ? await readJobTitles(core)
    : new Map();
}

function startedByOf(by: RawStartedBy, titles: JobTitles): WorkflowStartedBy {
  return by.kind === "user"
    ? by
    : { kind: "job", job: by.job, title: titles.get(by.job) ?? null };
}

const jobOf = (started: RawStartedBy) =>
  started.kind === "job" ? started.job : null;

async function collect<T>(
  core: CoreSource,
  resource: string,
  method: string,
  body: Record<string, unknown>,
  page: (value: unknown) => Page<T>,
): Promise<ReadResult<T[]>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < PAGE_LIMIT; index += 1) {
    const reply = await core.call({
      kind: "read",
      resource,
      method,
      body: cursor === undefined ? body : { ...body, cursor },
    });
    if (!reply.ok) {
      return { ok: false, message: reply.error?.code ?? "internal" };
    }
    const value = page(reply.value);
    items.push(...value.items);
    if (value.next === null) break;
    cursor = value.next;
  }
  return { ok: true, value: items };
}

function projectDocuments(
  core: CoreSource,
  project: string,
): Promise<ReadResult<DocumentRow[]>> {
  return collect(
    core,
    "documents",
    "list",
    { workspace: { kind: "project", id: project }, status: "active" },
    (value) => {
      const page = value as DocumentListValue;
      return {
        items: page.documents.map((entry) => ({
          id: entry.document.id,
          title: entry.document.title,
        })),
        next: page.next_cursor,
      };
    },
  );
}

/** 파일이 놓인 등록 폴더와 그 폴더 기준 상대 경로. 어느 폴더 안도 아니면 null이다. */
function locateInFolders(
  path: string,
  folders: readonly { path: string }[],
): { folder: string; relative: string } | null {
  // 가장 깊은 등록 폴더를 고른다.
  const roots = folders
    .map((folder) => ({
      folder: folder.path,
      root: folder.path.replace(/\/+$/, ""),
    }))
    .filter((item) => path.startsWith(`${item.root}/`))
    .sort((left, right) => right.root.length - left.root.length);
  const hit = roots[0];
  return hit === undefined
    ? null
    : { folder: hit.folder, relative: path.slice(hit.root.length + 1) };
}

const filesBridge = () => (globalThis as { lophnFiles?: FilesApi }).lophnFiles;

/** main이 디스크에서 직접 하는 파일 일. bridge가 없거나 던지면 unavailable이다. */
async function fileOp(
  run: (bridge: FilesApi) => Promise<FileReply<unknown>>,
): Promise<FileOpResult> {
  const bridge = filesBridge();
  if (!bridge) return { ok: false, code: "unavailable" };
  try {
    const reply = await run(bridge);
    return reply.ok ? { ok: true } : { ok: false, code: reply.code };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function coreWorkspaceSource(core: CoreSource): WorkspaceSource {
  const project = async (id: string): Promise<ReadResult<ProjectView>> => {
    const reply = await core.call({
      kind: "read",
      resource: "projects",
      method: "get",
      body: { project: id },
    });
    if (!reply.ok) {
      return { ok: false, message: reply.error?.code ?? "internal" };
    }
    const value = (reply.value as ProjectGetValue).project;
    return {
      ok: true,
      value: {
        id: value.id,
        identity: value.identity,
        formerIdentities: value.former_identities ?? [],
        title: value.title,
        folders: (value.folders ?? []).map((folder) => ({
          path: folder.path,
          found: folder.found !== false,
        })),
      },
    };
  };

  // 연결 폴더 고치기. projects.update는 폴더 목록을 통째로 받고 읽은 revision을 비교한다.
  // change가 null을 주면 바꿀 것이 없어 core를 부르지 않는다.
  async function editFolders(
    id: string,
    change: (
      folders: readonly { path: string; description: string }[],
    ) => readonly { path: string; description: string }[] | null,
  ): Promise<ReadResult<ProjectView | null>> {
    const read = await core.call({
      kind: "read",
      resource: "projects",
      method: "get",
      body: { project: id },
    });
    if (!read.ok) {
      return { ok: false, message: read.error?.code ?? "internal" };
    }
    const current = (read.value as ProjectGetValue).project;
    const next = change(
      (current.folders ?? []).map(({ path, description }) => ({
        path,
        description: description ?? "",
      })),
    );
    if (next === null) return { ok: true, value: null };
    const reply = await core.call(
      commandCall(projectApi.edit, {
        input: { project: id, folders: [...next] },
        compare: { base_revision: current.revision },
        key: `projects-folders-${crypto.randomUUID()}`,
      }),
    );
    if (!reply.ok) {
      return { ok: false, message: reply.error?.code ?? "internal" };
    }
    return project(id);
  }

  return {
    project,

    async addFolder(id) {
      const picker = windowFolderPicker();
      if (picker === undefined) return { ok: false, message: "unavailable" };
      let picked;
      try {
        picked = await picker.pick({ purpose: "register" });
      } catch {
        return { ok: false, message: "unavailable" };
      }
      if (!picked.ok) return { ok: false, message: picked.code };
      const path = picked.path;
      if (path === null) return { ok: true, value: null };
      return editFolders(id, (folders) =>
        folders.some((folder) => folder.path === path)
          ? null
          : [...folders, { path, description: "" }],
      );
    },

    async removeFolder(id, path) {
      const result = await editFolders(id, (folders) =>
        folders.filter((folder) => folder.path !== path),
      );
      if (!result.ok) return result;
      return result.value === null
        ? project(id)
        : { ok: true, value: result.value };
    },

    async projects() {
      const read = await readProjects(core, "active");
      return read.ok
        ? {
            ok: true,
            value: read.value.map(({ id, title }) => ({ id, title })),
          }
        : { ok: false, message: read.code };
    },

    // Agents 탭과 sidebar의 Agents 묶음도 같은 core 통로로 읽고 보낸다.
    agentsSource: coreAgentsSource(core),

    searchSource: coreFileSearchSource(core),

    // Explorer tree. main이 디스크에서 직접 읽는 목록이라 core 통로를 거치지 않는다.
    async list(path) {
      const bridge = (globalThis as { lophnFiles?: FilesApi }).lophnFiles;
      if (!bridge) return { ok: false, message: "files are unavailable" };
      try {
        const reply = await bridge.list({ path });
        return reply.ok
          ? { ok: true, value: reply.value.entries }
          : { ok: false, message: reply.code };
      } catch {
        return { ok: false, message: "unavailable" };
      }
    },

    create: (path, kind) => fileOp((bridge) => bridge.create({ path, kind })),
    rename: (from, to) => fileOp((bridge) => bridge.rename({ from, to })),
    copy: (from, to) => fileOp((bridge) => bridge.copy({ from, to })),
    writeBytes: (path, bytes) =>
      fileOp((bridge) => bridge.writeBytes({ path, bytes })),
    trash: (path) => fileOp((bridge) => bridge.delete({ path })),
    reveal: (path) => fileOp((bridge) => bridge.reveal({ path })),

    async workflows(id) {
      const reply = await core.call({
        kind: "memory",
        resource: "workflows",
        method: "list",
        body: { project: id },
      });
      if (!reply.ok) {
        return { ok: false, message: reply.error?.code ?? "internal" };
      }
      return {
        ok: true,
        value: (reply.value as WorkflowListValue).workflows.map((entry) => ({
          key: entry.key,
          project: entry.project,
          name: entry.name,
          invalid: entry.state === "invalid",
          startable: entry.startable,
          kind: entry.kind,
          problem: entry.problem,
          participants: entry.participants ?? null,
          steps: entry.steps,
          artifacts: entry.artifacts,
        })),
      };
    },

    async workflowInstances(filter: WorkflowInstanceFilter) {
      const read = await collect<
        WorkflowInstanceListValue["instances"][number]
      >(core, "workflow_instances", "list", { ...filter }, (value) => {
        const page = value as WorkflowInstanceListValue;
        return { items: page.instances, next: page.next_cursor };
      });
      if (!read.ok) return read;
      const titles = await titlesFor(
        core,
        read.value.map((entry) => jobOf(entry.started_by)),
      );
      return {
        ok: true as const,
        value: read.value.map(
          (entry): WorkflowInstanceSummaryView => ({
            id: entry.id,
            project: entry.project,
            workflow: entry.workflow,
            state: entry.state,
            current: entry.current,
            input: entry.input,
            started_by: startedByOf(entry.started_by, titles),
            created_at: entry.created_at,
            finished_at: entry.finished_at,
            last_line: entry.last_line,
          }),
        ),
      };
    },

    // 줄은 200개씩이고 오름차순이라 collect(줄만 모으는 꼴)가 맞지 않는다.
    async workflowInstance(instance) {
      const lines: WorkflowLineView[] = [];
      let cursor: string | undefined;
      let last: WorkflowReadValue | undefined;
      for (let index = 0; index < PAGE_LIMIT; index += 1) {
        const reply = await core.call({
          kind: "read",
          resource: "workflow_instances",
          method: "read",
          body: cursor === undefined ? { instance } : { instance, cursor },
        });
        if (!reply.ok) {
          return { ok: false, message: reply.error?.code ?? "internal" };
        }
        last = reply.value as WorkflowReadValue;
        lines.push(...last.lines);
        if (last.next_cursor === null) break;
        cursor = last.next_cursor;
      }
      const titles = await titlesFor(core, [jobOf(last!.instance.started_by)]);
      return {
        ok: true,
        value: {
          instance: {
            ...last!.instance,
            started_by: startedByOf(last!.instance.started_by, titles),
          },
          last_reports: last!.last_reports,
          lines,
        },
      };
    },

    async startWorkflow({ workflow, text, step }) {
      const reply = await core.call({
        kind: "memory",
        resource: "workflows",
        method: "start",
        body: { workflow, text, ...(step === undefined ? {} : { step }) },
      });
      if (!reply.ok) {
        return { ok: false, message: reply.error?.code ?? "internal" };
      }
      return {
        ok: true,
        value: {
          instance: (reply.value as { instance: { id: string } }).instance.id,
        },
      };
    },

    async stopWorkflow(instance) {
      const reply = await core.call({
        kind: "memory",
        resource: "workflows",
        method: "stop",
        body: { instance },
      });
      return reply.ok
        ? { ok: true, value: null }
        : { ok: false, message: reply.error?.code ?? "internal" };
    },

    // 팔레트 파일 묶음. files.list의 원본 파일 중 문서로 잡힌 것만 탭으로 열 수 있다.
    async files(id) {
      const targets = await collect<string>(
        core,
        "files",
        "list",
        { project: id },
        (value) => {
          const page = value as FileListValue;
          return {
            items: page.targets.flatMap((target) =>
              target.kind === "project_file" &&
              target.project === id &&
              typeof target.path === "string"
                ? [target.path]
                : [],
            ),
            next: page.next_cursor,
          };
        },
      );
      if (!targets.ok) return targets;
      if (targets.value.length === 0) return { ok: true, value: [] };
      const [view, documents] = await Promise.all([
        project(id),
        projectDocuments(core, id),
      ]);
      if (!view.ok) return view;
      if (!documents.ok) return documents;
      const byPath = new Map<string, DocumentRow>();
      for (const row of documents.value.slice(0, FILE_DOCUMENT_LIMIT)) {
        const reply = await core.call({
          kind: "read",
          resource: "documents",
          method: "get",
          body: { document: row.id },
        });
        if (!reply.ok) continue;
        const source = (reply.value as DocumentGetValue).document.file_source;
        if (source?.kind === "project_file" && source.project === id) {
          byPath.set(source.path, row);
        }
      }
      const rows: FileRow[] = targets.value.flatMap((path) => {
        const document = byPath.get(path);
        const located = locateInFolders(path, view.value.folders);
        return document && located !== null
          ? [
              {
                folder: located.folder,
                path: located.relative,
                document: document.id,
                title: document.title,
              },
            ]
          : [];
      });
      return { ok: true, value: rows };
    },

    layout: createLayoutSource(),
  };
}
