// ProjectsSource를 main의 core 통로와 폴더·파일 선택 통로로 만든다. 응답은 main의 contract client가
// route output schema로 이미 검사했다. 아래 모양은 project route에서 이 화면이 읽는 field만 옮긴 것이다.
import type {
  FolderPickerApi,
  FolderPickReply,
} from "../../../../ipc/folder-picker.ts";
import type { FilesApi } from "../../../../ipc/files.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type { ProjectDraft } from "../../launcher/source.ts";
import type {
  ProjectChange,
  ProjectItem,
  ProjectsSource,
  SourceResult,
} from "./source.ts";

interface ProjectValue {
  id: string;
  title: string;
  purpose: string;
  revision: string;
  status: "active" | "archived";
  folders: {
    path: string;
    description: string;
    found: boolean;
    subfolders: { path: string; description: string }[];
  }[];
}

interface ProjectListValue {
  projects: ProjectValue[];
  next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;
/** 짧은 이름이 겹칠 때 번호를 붙여 다시 해 보는 횟수. */
const NAME_ATTEMPTS = 5;
const SLUG_MAX = 63;

function projectItemOf(value: ProjectValue): ProjectItem {
  return {
    id: value.id,
    title: value.title,
    purpose: value.purpose,
    revision: value.revision,
    archived: value.status === "archived",
    folders: value.folders.map((folder) => ({
      path: folder.path,
      description: folder.description,
      found: folder.found,
      subfolders: folder.subfolders.map((sub) => ({
        path: sub.path,
        description: sub.description,
      })),
    })),
  };
}

/** preload가 연 폴더 선택 통로. 없으면(테스트·다른 창) 선택기를 열 수 없다. */
export function windowFolderPicker(): FolderPickerApi | undefined {
  const bridge = (globalThis as { lophnFolders?: FolderPickerApi })
    .lophnFolders;
  return bridge && typeof bridge.pick === "function" ? bridge : undefined;
}

function windowFiles(): FilesApi | undefined {
  const bridge = (globalThis as { lophnFiles?: FilesApi }).lophnFiles;
  return bridge && typeof bridge.list === "function" ? bridge : undefined;
}

function failed(reply: CoreReply): { ok: false; code: string } {
  return { ok: false, code: reply.error?.code ?? "internal" };
}

export async function readProjects(
  core: CoreSource,
  status?: "active" | "archived",
): Promise<SourceResult<readonly ProjectItem[]>> {
  const items: ProjectItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const reply = await core.call({
      kind: "read",
      resource: "projects",
      method: "list",
      body: {
        ...(status ? { status } : {}),
        ...(cursor ? { cursor } : {}),
      },
    });
    if (!reply.ok) return failed(reply);
    const value = reply.value as ProjectListValue;
    items.push(...value.projects.map(projectItemOf));
    if (value.next_cursor === null) break;
    cursor = value.next_cursor;
  }
  return { ok: true, value: items };
}

// 사람에게는 이름 하나만 보인다. call의 place가 맞춰 쓰는 짧은 이름은 이름에서 만들고 겹치면 번호를 붙인다.
function slugOf(title: string): string {
  const words = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const start = /^[a-z]/.test(words)
    ? words
    : words === ""
    ? "project"
    : `project-${words}`;
  return start.slice(0, SLUG_MAX).replace(/-+$/, "");
}

function slugAttempt(base: string, attempt: number): string {
  if (attempt === 1) return base;
  const suffix = `-${attempt}`;
  return `${
    base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")
  }${suffix}`;
}

export async function createProject(
  core: CoreSource,
  draft: ProjectDraft,
): Promise<SourceResult<ProjectItem>> {
  const base = slugOf(draft.title);
  let last: SourceResult<ProjectItem> = { ok: false, code: "conflict" };
  for (let attempt = 1; attempt <= NAME_ATTEMPTS; attempt += 1) {
    const reply = await core.call({
      kind: "command",
      resource: "projects",
      method: "create",
      body: {
        input: {
          id: draft.id,
          name: slugAttempt(base, attempt),
          title: draft.title,
          purpose: draft.purpose,
          folders: draft.folders.map((folder) => ({
            path: folder.path,
            description: folder.description,
            subfolders: [],
          })),
        },
        idempotency_key: `projects-create-${draft.id}-${attempt}`,
        compare: {},
        prepared: [],
      },
    });
    if (reply.ok) {
      return { ok: true, value: projectItemOf(reply.value as ProjectValue) };
    }
    last = failed(reply);
    if (last.code !== "conflict") return last;
  }
  return last;
}

async function write(
  core: CoreSource,
  method: string,
  input: unknown,
  baseRevision: string,
): Promise<SourceResult<ProjectItem>> {
  const reply = await core.call({
    kind: "command",
    resource: "projects",
    method,
    body: {
      input,
      idempotency_key: `projects-${method}-${crypto.randomUUID()}`,
      compare: { base_revision: baseRevision },
      prepared: [],
    },
  });
  return reply.ok
    ? { ok: true, value: projectItemOf(reply.value as ProjectValue) }
    : failed(reply);
}

export function coreProjectsSource(
  core: CoreSource,
  picker: FolderPickerApi | undefined,
  files: FilesApi | undefined = windowFiles(),
): ProjectsSource {
  async function pick(purpose: "register" | "relocate") {
    if (!picker) return { ok: false as const, code: "unavailable" };
    let reply: FolderPickReply;
    try {
      reply = await picker.pick({ purpose });
    } catch {
      return { ok: false as const, code: "unavailable" };
    }
    return reply.ok
      ? { ok: true as const, path: reply.path }
      : { ok: false as const, code: reply.code };
  }

  return {
    list: () => readProjects(core),

    save: (project, change: ProjectChange) =>
      write(
        core,
        "update",
        { project: project.id, ...change },
        project.revision,
      ),

    setArchived: (project, archived) =>
      write(
        core,
        archived ? "archive" : "unarchive",
        { project: project.id },
        project.revision,
      ),

    async relocate(project, folder) {
      const chosen = await pick("relocate");
      if (!chosen.ok) return chosen;
      if (chosen.path === null) return { ok: true, value: null };
      return write(core, "relink_folder", {
        project: project.id,
        folder_path: folder,
        new_path: chosen.path,
      }, project.revision);
    },

    async pickFolder() {
      const chosen = await pick("register");
      return chosen.ok ? chosen : { ok: false };
    },

    async listFolders(path) {
      if (!files) return { ok: false, code: "unavailable" };
      const reply = await files.list({ path });
      return reply.ok
        ? {
          ok: true,
          value: reply.value.entries
            .filter((entry) => entry.kind === "folder")
            .map((entry) => entry.name),
        }
        : { ok: false, code: reply.code };
    },

    register: (draft) => createProject(core, draft),
  };
}
