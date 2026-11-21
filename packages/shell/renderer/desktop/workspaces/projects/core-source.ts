// ProjectsSource를 main의 core 통로와 폴더·파일 선택 통로로 만든다. 응답은 main의 contract client가
// route output schema로 이미 검사했다. 아래 모양은 project route에서 이 화면이 읽는 field만 옮긴 것이다.
import type {
  FolderPickerApi,
  FolderPickReply,
} from "../../../../ipc/folder-picker.ts";
import type { CommandRoute } from "../../../../../protocol/base/route.ts";
import { projectAdd } from "../../../../../protocol/projects/add-api.ts";
import { projectIdentityApi } from "../../../../../protocol/projects/identity-api.ts";
import { projectApi } from "../../../../../protocol/projects/project-api.ts";
import {
  type CommandBody,
  commandCall,
  type CompareOf,
} from "../../../command-call.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type { FolderMatch, ProjectDraft } from "../source.ts";
import type {
  IdentityStatus,
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
  }[];
  identity: string;
  repo: "git" | "none" | null;
}

// project.identity의 출력에서 이 화면이 읽는 칸.
interface IdentityValue {
  project: string;
  identity: string;
  repo: IdentityStatus["repo"];
  remote: { key: string } | null;
  found: boolean;
  separated: boolean;
  same_repository: string | null;
}

interface MatchValue {
  repo: FolderMatch["repo"];
  same_repository: ProjectValue[];
}

interface ProjectListValue {
  projects: ProjectValue[];
  next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

/** project route의 기록을 화면 값으로 옮긴다. */
export function projectItemOf(value: ProjectValue): ProjectItem {
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
    })),
    identity: value.identity,
    repo: value.repo,
  };
}

/** preload가 연 폴더 선택 통로. 없으면(테스트·다른 창) 선택기를 열 수 없다. */
export function windowFolderPicker(): FolderPickerApi | undefined {
  const bridge = (globalThis as { lophnFolders?: FolderPickerApi })
    .lophnFolders;
  return bridge && typeof bridge.pick === "function" ? bridge : undefined;
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

// 사람에게는 이름 하나만 보인다. id와 call의 workspace가 맞춰 쓰는 짧은 이름은 core가 만든다.
async function addProject(
  core: CoreSource,
  draft: ProjectDraft,
): Promise<SourceResult<ProjectItem>> {
  const reply = await core.call({
    kind: "memory",
    resource: projectAdd.resource,
    method: projectAdd.method,
    body: {
      title: draft.title,
      purpose: draft.purpose,
      folders: draft.folders.map((folder) => ({
        path: folder.path,
        description: folder.description,
      })),
    },
  });
  return reply.ok
    ? { ok: true, value: projectItemOf(reply.value as ProjectValue) }
    : failed(reply);
}

async function identityStatus(
  core: CoreSource,
  project: string,
): Promise<SourceResult<IdentityStatus>> {
  const reply = await core.call({
    kind: "memory",
    resource: projectIdentityApi.identity.resource,
    method: projectIdentityApi.identity.method,
    body: { project },
  });
  if (!reply.ok) return failed(reply);
  const value = reply.value as IdentityValue;
  let sameRepository: IdentityStatus["sameRepository"] = null;
  if (value.same_repository !== null) {
    const found = await core.call({
      kind: "read",
      resource: "projects",
      method: "get",
      body: { project: value.same_repository },
    });
    sameRepository = {
      id: value.same_repository,
      title: found.ok
        ? (found.value as { project: ProjectValue }).project.title
        : value.same_repository,
    };
  }
  return {
    ok: true,
    value: {
      project: value.project,
      identity: value.identity,
      repo: value.repo,
      remote: value.remote !== null,
      found: value.found,
      separated: value.separated,
      sameRepository,
    },
  };
}

async function write<R extends CommandRoute>(
  core: CoreSource,
  route: R,
  input: unknown,
  baseRevision: string,
): Promise<SourceResult<ProjectItem>> {
  const reply = await core.call(
    commandCall(route, {
      input: input as CommandBody<R>["input"],
      // 쓰는 route는 모두 base_revision 하나만 비교한다.
      compare: { base_revision: baseRevision } as CompareOf<R>,
      key: `projects-${route.method}-${crypto.randomUUID()}`,
    }),
  );
  return reply.ok
    ? { ok: true, value: projectItemOf(reply.value as ProjectValue) }
    : failed(reply);
}

export function coreProjectsSource(
  core: CoreSource,
  picker: FolderPickerApi | undefined,
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
        projectApi.edit,
        { project: project.id, ...change },
        project.revision,
      ),

    setArchived: (project, archived) =>
      write(
        core,
        archived ? projectApi.archive : projectApi.unarchive,
        { project: project.id },
        project.revision,
      ),

    async relocate(project, folder) {
      const chosen = await pick("relocate");
      if (!chosen.ok) return chosen;
      if (chosen.path === null) return { ok: true, value: null };
      return write(
        core,
        projectApi.relinkFolder,
        {
          project: project.id,
          folder_path: folder,
          new_path: chosen.path,
        },
        project.revision,
      );
    },

    async pickFolder() {
      const chosen = await pick("register");
      return chosen.ok ? chosen : { ok: false };
    },

    register: (draft) => addProject(core, draft),

    async match(path) {
      const reply = await core.call({
        kind: "memory",
        resource: projectIdentityApi.match.resource,
        method: projectIdentityApi.match.method,
        body: { path },
      });
      if (!reply.ok) return failed(reply);
      const value = reply.value as MatchValue;
      return {
        ok: true,
        value: {
          repo: value.repo,
          sameRepository: value.same_repository.map(projectItemOf),
        },
      };
    },

    relinkFolder: (project, folder, path) =>
      write(
        core,
        projectApi.relinkFolder,
        { project: project.id, folder_path: folder, new_path: path },
        project.revision,
      ),

    identity: (project) => identityStatus(core, project.id),

    async renewIdentity(project) {
      const reply = await core.call(
        commandCall(projectIdentityApi.renewIdentity, {
          input: { project: project.id },
          compare: {},
          key: `projects-renew_identity-${crypto.randomUUID()}`,
        }),
      );
      return reply.ok ? identityStatus(core, project.id) : failed(reply);
    },

    async linkIdentity(project, identity) {
      const reply = await core.call(
        commandCall(projectIdentityApi.linkIdentity, {
          input: { project: project.id, identity },
          compare: {},
          key: `projects-link_identity-${crypto.randomUUID()}`,
        }),
      );
      return reply.ok
        ? { ok: true, value: projectItemOf(reply.value as ProjectValue) }
        : failed(reply);
    },
  };
}
