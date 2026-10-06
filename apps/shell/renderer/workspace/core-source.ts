// 제품 core 통로의 WorkspaceSource. token·port는 main에 있고 이 쪽은 route 이름과 입력만 보낸다.
// 응답은 main의 contract client가 route output schema로 이미 검사했다. 아래 응답 모양은
// projects.get, documents.list·get, contexts.list, files.list schema에서 작업대가 읽는 field만
// 옮긴 것이다. main은 아직 layout 저장·복원 통로를 renderer에 열지 않았다. 그래서 layout은
// 읽지 못함으로 답하고 작업대는 빈 배치로 시작한다.
import type { CoreSource } from "../desktop/connection/connection.ts";
import type {
  ContextRow,
  DocumentRow,
  FileRow,
  LayoutRead,
  ProjectView,
  ReadResult,
  WorkspaceSource,
} from "./source.ts";

interface ProjectGetValue {
  project: {
    id: string;
    title: string;
    folders?: { path: string }[];
  };
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

interface ContextListValue {
  contexts: {
    id: string;
    title: string;
    items: { target: { kind: string; document?: string } }[];
  }[];
  next_cursor: string | null;
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

/** 등록 폴더 기준 상대 경로. 어느 폴더 안도 아니면 null이다. */
export function relativeToFolders(
  path: string,
  folders: readonly { path: string }[],
): string | null {
  // 가장 깊은 등록 폴더를 고른다(documents/projects#R10).
  const roots = folders
    .map((folder) => folder.path.replace(/\/+$/, ""))
    .filter((root) => path.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length);
  const root = roots[0];
  return root === undefined ? null : path.slice(root.length + 1);
}

const NO_LAYOUT: LayoutRead = { ok: false, message: "layout is unavailable" };

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
        })),
      },
    };
  };

  return {
    project,

    documents: (id) => projectDocuments(core, id),

    // 연관 컨텍스트: 이 프로젝트의 문서를 하나라도 담은 활성 컨텍스트.
    async contexts(id) {
      const documents = await projectDocuments(core, id);
      if (!documents.ok) return documents;
      const ids = new Set(documents.value.map((row) => row.id));
      const contexts = await collect<ContextRow & { documents: string[] }>(
        core,
        "contexts",
        "list",
        { status: "active" },
        (value) => {
          const page = value as ContextListValue;
          return {
            items: page.contexts.map((context) => ({
              id: context.id,
              title: context.title,
              documents: context.items.flatMap((item) =>
                item.target.kind === "document" && item.target.document
                  ? [item.target.document]
                  : []
              ),
            })),
            next: page.next_cursor,
          };
        },
      );
      if (!contexts.ok) return contexts;
      return {
        ok: true,
        value: contexts.value
          .filter((context) => context.documents.some((doc) => ids.has(doc)))
          .map((context) => ({ id: context.id, title: context.title })),
      };
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
        const relative = relativeToFolders(path, view.value.folders);
        return document && relative !== null
          ? [{ path: relative, document: document.id, title: document.title }]
          : [];
      });
      return { ok: true, value: rows };
    },

    readLayout: () => Promise.resolve(NO_LAYOUT),

    saveLayout: () => Promise.resolve({ ok: false }),
  };
}
