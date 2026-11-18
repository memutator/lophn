// project 폴더의 id file과 ledger를 맞춘다. ledger 값은 file의 cache라 읽을 때마다 file을 다시 읽어 적는다.
// file·git은 tx 밖에서 하고 기록은 machine 자격 command(`project.record_identity`)로 낸다.
import {
  err,
  type IdSource,
  type Logger,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  matchProjects,
  PROJECT_IDENTITY_FILE,
  projectIdentityApi,
  type ProjectIdentityStatus,
  type ProjectKeys,
  type ProjectMatch,
  type ProjectRecord,
} from "../../../protocol/projects/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { projectByIdentity } from "../lookups.ts";
import type { FolderResolver } from "../ports.ts";
import { PROJECT_IDENTITY_CONTEXT } from "../registry/contexts.ts";
import type { Project } from "../registry/model.ts";
import { recordOf } from "../registry/record.ts";
import { loadProject, loadProjects } from "../registry/store.ts";
import type { IdentityFs } from "./file.ts";
import type { GitReader } from "./git.ts";
import { type FolderIdentity, inspectFolder } from "./inspect.ts";

type ReadSql = Pick<Sql, "get" | "all">;

export type IdentityServiceDeps = {
  git: GitReader;
  fs: IdentityFs;
  ids: IdSource;
  // 전체 writer(쓰기 앞 처리기를 다 지난 것). 부를 때 읽는다.
  writer: () => Writer;
  // ledger를 짧게 읽는다.
  snapshot<T>(read: (sql: ReadSql) => Result<T>): Result<T>;
  folders: Pick<FolderResolver, "exists">;
  logger: Logger;
};

export type IdentityService = ReturnType<typeof createIdentityService>;

function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

// git·fs가 던진 것(권한, timeout)은 다시 해 볼 수 있는 실패다.
async function guarded<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (thrown) {
    return err({
      code: "unavailable",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
}

export function createIdentityService(deps: IdentityServiceDeps) {
  const read = (folder: string) => inspectFolder(folder, deps);

  const load = (project: string): Result<Project> => {
    const found = deps.snapshot((sql) => loadProject(sql, project));
    if (!found.ok) return found;
    return found.value === null
      ? notFound("project not found")
      : ok(found.value);
  };

  // 첫 폴더를 읽어 적는다. 폴더가 없는 project는 읽을 것이 없고 git이 아닌 것으로 적는다(read는 null).
  async function reconcile(
    project: Pick<Project, "id" | "folders">,
  ): Promise<Result<{ record: ProjectRecord; read: FolderIdentity | null }>> {
    const folder = project.folders[0]?.path;
    const found = folder === undefined ? null : await read(folder);
    const done = await deps.writer().command(PROJECT_IDENTITY_CONTEXT, {
      command: projectIdentityApi.recordIdentity.name,
      input: {
        project: project.id,
        found: found?.found ?? true,
        repo: found === null ? "none" : found.repo,
        file_identity: found?.file_identity ?? null,
        remote: found?.remote ?? null,
      },
      idempotency_key: deps.ids.newId("idk"),
      compare: {},
      prepared: [],
    });
    if (!done.ok) return done;
    return ok({ record: done.value.result as ProjectRecord, read: found });
  }

  async function status(
    project: string,
  ): Promise<Result<ProjectIdentityStatus>> {
    const current = load(project);
    if (!current.ok) return current;
    const done = await reconcile(current.value);
    if (!done.ok) return done;
    const { record, read: found } = done.value;
    const fileIdentity = found?.file_identity ?? null;
    // 같은 file을 읽었는데 id를 갖지 못했으면 먼저 가진 project의 copy다.
    let duplicate: string | null = null;
    if (fileIdentity !== null && fileIdentity !== record.identity) {
      const holder = deps.snapshot((sql) =>
        ok(projectByIdentity(sql, fileIdentity)),
      );
      if (!holder.ok) return holder;
      duplicate = holder.value === project ? null : holder.value;
    }
    const file = found?.file ?? "none";
    // git이 아닌 project의 id는 ledger에서 났고 file이 없는 것이 맞다.
    const missing =
      file === "none" && record.identity !== null && record.repo !== "none";
    return ok({
      project,
      identity: record.identity,
      file: missing ? "missing" : file,
      repo: record.repo,
      folder: record.folders[0]?.path ?? null,
      found: found?.found ?? false,
      remote: record.remote,
      duplicate_of: duplicate,
    });
  }

  // 쓰기 전에 폴더가 있고 git인지 본다.
  async function writable(
    project: string,
  ): Promise<
    Result<{ project: Project; folder: string; read: FolderIdentity }>
  > {
    const current = load(project);
    if (!current.ok) return current;
    const folder = current.value.folders[0]?.path;
    if (folder === undefined) return notFound("project has no folder");
    const found = await read(folder);
    if (!found.found) return notFound(`${folder} is not found`);
    if (found.repo !== "git") {
      return err({ code: "invalid_input", message: "not a git repository" });
    }
    return ok({ project: current.value, folder, read: found });
  }

  return {
    reconcile: (project: Pick<Project, "id" | "folders">) =>
      guarded(() => reconcile(project)),

    status: (project: string) => guarded(() => status(project)),

    // 읽을 수 있는 file은 덮지 않는다. 충돌이면 이긴(작은) id를 쓰고, 없으면 ledger의 id(Restore)나 새 id를 만든다.
    create: (project: string) =>
      guarded(async () => {
        const target = await writable(project);
        if (!target.ok) return target;
        const { folder, read: found } = target.value;
        if (found.file === "unreadable") {
          return err({
            code: "conflict",
            message: `${folder}/${PROJECT_IDENTITY_FILE} cannot be read; fix or delete it`,
          });
        }
        if (found.file === "conflict") {
          const wrote = await deps.fs.replace(folder, found.file_identity!);
          if (!wrote.ok) return wrote;
        } else if (found.file === "none") {
          const id = target.value.project.identity ?? deps.ids.newId("pri");
          const wrote = await deps.fs.create(folder, id);
          if (!wrote.ok) return wrote;
        }
        return await status(project);
      }),

    // [Separate project]: 새 id로 덮어 다른 기계의 같은 저장소와 나눈다.
    renew: (project: string) =>
      guarded(async () => {
        const target = await writable(project);
        if (!target.ok) return target;
        const wrote = await deps.fs.replace(
          target.value.folder,
          deps.ids.newId("pri"),
        );
        if (!wrote.ok) return wrote;
        return await status(project);
      }),

    // 등록 전 폴더를 읽기만 하고 이 기계의 project와 짝을 찾는다.
    match: (path: string) =>
      guarded(async (): Promise<Result<ProjectMatch>> => {
        const found = await read(path);
        const projects = deps.snapshot((sql) => loadProjects(sql));
        if (!projects.ok) return projects;
        const keys = (project: Project): ProjectKeys => ({
          id: project.id,
          identity: project.identity,
          remote_key: project.remote?.key ?? null,
        });
        const target: ProjectKeys = {
          id: "",
          identity: found.file_identity,
          remote_key: found.remote?.key ?? null,
        };
        const matched = matchProjects([target], projects.value.map(keys));
        const record = (id: string) =>
          recordOf(
            projects.value.find((project) => project.id === id)!,
            deps.folders,
          );
        const same = matched.same[0];
        return ok({
          found: found.found,
          repo: found.repo,
          file: found.file,
          identity: found.file_identity,
          remote: found.remote,
          same: same === undefined ? null : record(same[1].id),
          suggestions: matched.suggested.map(([, local]) => record(local.id)),
        });
      }),
  };
}
