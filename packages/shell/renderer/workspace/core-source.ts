// 제품 core 통로의 WorkspaceSource. token·port는 main에 있고 이 쪽은 route 이름과 입력만 보낸다.
// 응답은 main의 contract client가 route output schema로 이미 검사했다. 아래 응답 모양은
// projects.get, documents.list·get, files.list schema에서 작업대가 읽는 field만
// 옮긴 것이다. layout 저장·복원은 preload의 lophnLayout이 있을 때만 main 통로를 쓴다.
// bridge가 없으면 읽지 못함으로 답하고 작업대는 빈 배치로 시작한다.
import type { FilesApi } from "../../ipc/files.ts";
import type {
  LayoutReadResult,
  LayoutSaveResult,
} from "../../ipc/workspace.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { coreAgentsSource } from "./agents/core-source.ts";
import { coreDomainActions } from "./domains/core-calls.ts";
import { coreFileSearchSource } from "./search/core-source.ts";
import type {
  DomainView,
  FileOpResult,
  FileRow,
  LayoutRead,
  ProjectView,
  ReadResult,
  RunFilter,
  WorkflowEntryView,
  WorkflowInstanceFilter,
  WorkflowInstanceSummaryView,
  WorkflowInstanceView,
  WorkflowLineView,
  WorkspaceSource,
} from "./source.ts";
import type { RunRecordView } from "./sidebar/run-list.tsx";

interface DocumentRow {
  id: string;
  title: string;
}

interface ProjectGetValue {
  project: {
    id: string;
    title: string;
    folders?: {
      path: string;
      found?: boolean;
      subfolders?: { path: string }[];
    }[];
  };
}

interface DomainListValue {
  domains: DomainView[];
  next_cursor: string | null;
}

interface RunListValue {
  runs: RunRecordView[];
  next_cursor: string | null;
}

interface WorkflowListValue {
  workflows: (Omit<WorkflowEntryView, "invalid"> & {
    state: "ok" | "invalid";
  })[];
}

interface WorkflowInstanceListValue {
  instances: WorkflowInstanceSummaryView[];
  next_cursor: string | null;
}

interface WorkflowReadValue {
  instance: WorkflowInstanceView;
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
    { place: { kind: "project", id: project }, status: "active" },
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

const NO_LAYOUT: LayoutRead = { ok: false, message: "layout is unavailable" };

function layoutBridge(): {
  read(input: { project: string }): Promise<LayoutReadResult>;
  save(input: unknown): Promise<LayoutSaveResult>;
} | undefined {
  return (globalThis as {
    lophnLayout?: {
      read(input: { project: string }): Promise<LayoutReadResult>;
      save(input: unknown): Promise<LayoutSaveResult>;
    };
  }).lophnLayout;
}

const filesBridge = () => (globalThis as { lophnFiles?: FilesApi }).lophnFiles;

/** main이 디스크에서 직접 하는 파일 일. bridge가 없거나 던지면 unavailable이다. */
async function fileOp(
  run: (bridge: FilesApi) => ReturnType<FilesApi["rename"]>,
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
        title: value.title,
        folders: (value.folders ?? []).map((folder) => ({
          path: folder.path,
          found: folder.found !== false,
          subfolders: (folder.subfolders ?? []).map((sub) => ({
            path: sub.path,
          })),
        })),
      },
    };
  };

  return {
    project,

    ...coreDomainActions(core),

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
    trash: (path) => fileOp((bridge) => bridge.delete({ path })),
    reveal: (path) => fileOp((bridge) => bridge.reveal({ path })),

    domains: (id) =>
      collect<DomainView>(
        core,
        "domains",
        "list",
        { owner: { kind: "project", id }, status: "active" },
        (value) => {
          const page = value as DomainListValue;
          return {
            items: page.domains.map((domain) => ({
              id: domain.id,
              name: domain.name,
              title: domain.title,
              purpose: domain.purpose,
              status: domain.status,
            })),
            next: page.next_cursor,
          };
        },
      ),

    runs: (filter: RunFilter) =>
      collect<RunRecordView>(core, "runs", "list", { ...filter }, (value) => {
        const page = value as RunListValue;
        return {
          items: page.runs.map((run) => ({
            id: run.id,
            kind: run.kind,
            target: run.target,
            session: run.session,
            session_opened: run.session_opened,
            state: run.state,
            created_at: run.created_at,
          })),
          next: page.next_cursor,
        };
      }),

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
          steps: entry.steps,
          artifacts: entry.artifacts,
        })),
      };
    },

    workflowInstances: (filter: WorkflowInstanceFilter) =>
      collect<WorkflowInstanceSummaryView>(
        core,
        "workflow_instances",
        "list",
        { ...filter },
        (value) => {
          const page = value as WorkflowInstanceListValue;
          return {
            items: page.instances.map((entry) => ({
              id: entry.id,
              project: entry.project,
              workflow: entry.workflow,
              state: entry.state,
              current: entry.current,
              input: entry.input,
              created_at: entry.created_at,
              finished_at: entry.finished_at,
              last_line: entry.last_line,
            })),
            next: page.next_cursor,
          };
        },
      ),

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
      return {
        ok: true,
        value: {
          instance: last!.instance,
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
              target.kind === "project_file" && target.project === id &&
                typeof target.path === "string"
                ? [target.path]
                : []
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
          ? [{
            folder: located.folder,
            path: located.relative,
            document: document.id,
            title: document.title,
          }]
          : [];
      });
      return { ok: true, value: rows };
    },

    async readLayout(project) {
      const bridge = layoutBridge();
      if (!bridge) return NO_LAYOUT;
      try {
        const reply = await bridge.read({ project });
        if (!reply.ok) return NO_LAYOUT;
        if (!reply.available) {
          return { ok: true, available: false, reason: reply.reason };
        }
        return { ok: true, available: true, layout: reply.layout };
      } catch {
        return NO_LAYOUT;
      }
    },

    async saveLayout(layout) {
      const bridge = layoutBridge();
      if (!bridge) return { ok: false };
      try {
        const reply = await bridge.save(layout);
        return { ok: reply.ok };
      } catch {
        return { ok: false };
      }
    },
  };
}
