import { err, ok, type Result } from "../../../base/mod.ts";
import { projectApi } from "../../../protocol/projects/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
  Sql,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { FolderResolver } from "../ports.ts";
import { authorizeProject, denied } from "./authorization.ts";
import { nextProjectCursor, pageOffset, projectPageBasis } from "./cursor.ts";
import { deepestRegisteredRoot, type Project } from "./model.ts";
import { recordOf } from "./record.ts";
import { loadProject, loadProjectByName, loadProjects } from "./store.ts";

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "project not found" });
}

function isUser(ctx: RequestContext): boolean {
  return parseActor(ctx.actor)?.kind === "user";
}

function allowed(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  project: Project,
): Result<Project | null> {
  const decision = authorizeProject(snapshot.port, ctx, operation, {
    kind: "project",
    project,
  });
  if (denied(decision)) return ok(null);
  if (!decision.ok) return decision;
  return ok(project);
}

function requireReadActor(ctx: RequestContext): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined &&
    (projectApi.list.actors as readonly string[]).includes(kind)
    ? ok(undefined)
    : err({ code: "forbidden", message: "project read actor forbidden" });
}

type ProjectReadDeps = {
  folders: FolderResolver;
};

// 경로 하나에 닿는 project를 깊은 등록 폴더 순으로 하나 고른다.
function projectAt(
  projects: readonly Project[],
  path: string,
): Result<{ project: Project; folder_path: string } | null> {
  const roots = projects.flatMap((project) =>
    project.folders.map((folder) => ({
      project: project.id,
      path: folder.path,
    })),
  );
  const found = deepestRegisteredRoot(path, roots);
  if (!found.ok) return found;
  if (found.value === null) return ok(null);
  const project = projects.find((item) => item.id === found.value!.project);
  return ok(
    project === undefined ? null : { project, folder_path: found.value.path },
  );
}

export function createProjectReads(deps: ProjectReadDeps): {
  list: ReadDefinition<typeof projectApi.list>;
  get: ReadDefinition<typeof projectApi.get>;
  resolve: ReadDefinition<typeof projectApi.resolve>;
} {
  return {
    list: {
      route: projectApi.list,
      handle(snapshot, ctx, input) {
        const actor = requireReadActor(ctx);
        if (!actor.ok) return actor;
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const visible: Project[] = [];
        for (const project of projects.value) {
          if (input.status !== undefined && project.status !== input.status) {
            continue;
          }
          const access = allowed(snapshot, ctx, projectApi.list.name, project);
          if (!access.ok) return access;
          if (access.value !== null) visible.push(access.value);
        }
        const limit = input.limit ?? PAGE;
        const basis = projectPageBasis(
          { as_of_seq: snapshot.as_of_seq },
          ctx,
          input.status,
          limit,
          visible.map((project) => ({
            id: project.id,
            revision: project.revision,
          })),
        );
        const offset = pageOffset(input.cursor, basis);
        if (!offset.ok) return offset;
        const start = offset.value;
        const page = visible.slice(start, start + limit);
        const next = start + page.length;
        return ok({
          projects: page.map((project) => recordOf(project, deps.folders)),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            next < visible.length ? nextProjectCursor(next, basis) : null,
          // undefined 필드는 platform 출력 검사에서 거절된다. 없으면 key를 뺀다.
          ...(next < visible.length
            ? {
                omitted: [
                  {
                    reason: "page_limit" as const,
                    count: visible.length - next,
                  },
                ],
              }
            : {}),
        });
      },
    },
    get: {
      route: projectApi.get,
      handle(snapshot, ctx, input) {
        const actor = requireReadActor(ctx);
        if (!actor.ok) return actor;
        const project = loadProject(snapshot.sql, input.project);
        if (!project.ok) return project;
        if (project.value === null) return notFound();
        const access = allowed(
          snapshot,
          ctx,
          projectApi.get.name,
          project.value,
        );
        if (!access.ok) return access;
        if (access.value === null) return notFound();
        return ok({
          project: recordOf(access.value, deps.folders),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    resolve: {
      route: projectApi.resolve,
      handle(snapshot, ctx, input) {
        if (!isUser(ctx)) {
          return err({
            code: "forbidden",
            message: "project resolve is user only",
          });
        }
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const found = projectAt(projects.value, input.path);
        if (!found.ok) return found;
        if (found.value === null) return notFound();
        const access = allowed(
          snapshot,
          ctx,
          projectApi.resolve.name,
          found.value.project,
        );
        if (!access.ok) return access;
        if (access.value === null) return notFound();
        return ok({
          project: recordOf(access.value, deps.folders),
          folder_path: found.value.folder_path,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

// lophn-agent의 `ProjectDirectory`가 쓰는 모양이다(`core/lophn-agent/ports.ts`의 ProjectInfo와 같다).
// feature module끼리 import하지 못해 모양만 맞춘다. 구현을 끼우는 쪽은 wiring이다.
type ProjectInfoOf = {
  id: string;
  name: string;
  purpose: string;
  archived: boolean;
  folders: readonly {
    path: string;
    description: string;
    found: boolean;
  }[];
};

function infoOf(
  project: Project,
  folders: Pick<FolderResolver, "exists">,
): ProjectInfoOf {
  const record = recordOf(project, folders);
  return {
    id: record.id,
    name: record.name,
    purpose: record.purpose,
    archived: record.status === "archived",
    folders: record.folders,
  };
}

// id나 정확한 이름으로 project 하나를 읽는다. 없으면 null이다.
export function projectInfoOf(
  sql: Pick<Sql, "get" | "all">,
  folders: Pick<FolderResolver, "exists">,
  which: { id: string } | { name: string },
): Result<ProjectInfoOf | null> {
  const project =
    "id" in which
      ? loadProject(sql, which.id)
      : loadProjectByName(sql, which.name);
  if (!project.ok) return project;
  return ok(project.value === null ? null : infoOf(project.value, folders));
}

export function projectInfoList(
  sql: Pick<Sql, "get" | "all">,
  folders: Pick<FolderResolver, "exists">,
): Result<ProjectInfoOf[]> {
  const projects = loadProjects(sql);
  if (!projects.ok) return projects;
  return ok(projects.value.map((project) => infoOf(project, folders)));
}
