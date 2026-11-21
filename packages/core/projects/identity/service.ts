// project 폴더의 git 여부와 remote를 읽어 ledger에 적는다. id는 등록할 때 ledger에서 나고 폴더에서 오지 않는다.
// git은 tx 밖에서 읽고 기록은 machine 자격 command(`project.record_identity`)로 낸다.
import {
  err,
  type IdSource,
  type Logger,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  projectIdentityApi,
  type ProjectIdentityStatus,
  type ProjectMatch,
  type ProjectRecord,
} from "../../../protocol/projects/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import type { FolderResolver } from "../ports.ts";
import { PROJECT_IDENTITY_CONTEXT } from "../registry/contexts.ts";
import type { Project } from "../registry/model.ts";
import { recordOf } from "../registry/record.ts";
import { loadProject, loadProjects } from "../registry/store.ts";
import type { GitReader } from "./git.ts";
import {
  type FolderIdentity,
  type FolderProbe,
  inspectFolder,
} from "./inspect.ts";

type ReadSql = Pick<Sql, "get" | "all">;

export type IdentityServiceDeps = {
  git: GitReader;
  fs: FolderProbe;
  ids: IdSource;
  // 전체 writer(쓰기 앞 처리기를 다 지난 것). 부를 때 읽는다.
  writer: () => Writer;
  // ledger를 짧게 읽는다.
  snapshot<T>(read: (sql: ReadSql) => Result<T>): Result<T>;
  folders: Pick<FolderResolver, "exists">;
  // private workspace인 project. 다른 컴퓨터와 맞추지 않는다.
  isPrivate(project: string): boolean;
  logger: Logger;
};

export type IdentityService = ReturnType<typeof createIdentityService>;

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

// 자동 match에 드는(active, git, 나누지 않음, private 아님) 이 기계의 다른 project 가운데 같은 remote key를 가진 것. 자동
// match가 같은 저장소의 수를 세는 규칙과 같다(match.ts).
export function sameRepository(
  projects: readonly Project[],
  project: Pick<Project, "id" | "remote">,
  isPrivate: (project: string) => boolean,
): Project | null {
  const key = project.remote?.key;
  if (key === undefined) return null;
  return (
    projects.find(
      (other) =>
        other.id !== project.id &&
        other.status === "active" &&
        other.repo === "git" &&
        !other.separated &&
        !isPrivate(other.id) &&
        other.remote?.key === key,
    ) ?? null
  );
}

export function createIdentityService(deps: IdentityServiceDeps) {
  const read = (folder: string) => inspectFolder(folder, deps);

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
    const current = deps.snapshot((sql) => loadProject(sql, project));
    if (!current.ok) return current;
    if (current.value === null) {
      return err({ code: "not_found", message: "project not found" });
    }
    const done = await reconcile(current.value);
    if (!done.ok) return done;
    const { record, read: found } = done.value;
    const projects = deps.snapshot((sql) => loadProjects(sql));
    if (!projects.ok) return projects;
    return ok({
      project,
      identity: record.identity,
      repo: record.repo,
      folder: record.folders[0]?.path ?? null,
      found: found?.found ?? false,
      remote: record.remote,
      separated: record.separated,
      private: deps.isPrivate(project),
      same_repository: record.separated
        ? null
        : (sameRepository(projects.value, record, deps.isPrivate)?.id ?? null),
    });
  }

  return {
    reconcile: (project: Pick<Project, "id" | "folders">) =>
      guarded(() => reconcile(project)),

    status: (project: string) => guarded(() => status(project)),

    // 등록 전 폴더를 읽기만 하고 같은 저장소의 이 기계 project를 찾는다.
    match: (path: string) =>
      guarded(async (): Promise<Result<ProjectMatch>> => {
        const found = await read(path);
        const projects = deps.snapshot((sql) => loadProjects(sql));
        if (!projects.ok) return projects;
        const key = found.remote?.key;
        return ok({
          found: found.found,
          repo: found.repo,
          remote: found.remote,
          same_repository:
            key === undefined
              ? []
              : projects.value
                  .filter((project) => project.remote?.key === key)
                  .map((project) => recordOf(project, deps.folders)),
        });
      }),
  };
}
