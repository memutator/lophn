import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentProject,
  agentProjectSchema,
  INITIAL_TRACKING_PROPOSAL,
  type Project,
  projectGet,
  projectList,
  projectResolve,
  projectResolveCwd,
  projectTrackingRoots,
  userProjectSchema,
} from "../../../protocol/projects/mod.ts";
import { absolutePathSchema } from "../../../protocol/projects/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { deepestRegisteredRoot } from "./model.ts";
import { loadProject, loadProjects } from "./store.ts";

import { nextProjectCursor, pageOffset, projectPageBasis } from "./cursor.ts";

type UserProject = ReturnType<typeof userProjectSchema.parse>;

import { authorizeProject, denied } from "./authorization.ts";

const PAGE = 50;

function unavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "project read dependency missing",
  });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "project not found" });
}

function isUser(ctx: RequestContext): boolean {
  return parseActor(ctx.actor)?.kind === "user";
}

function projectView(
  ctx: RequestContext,
  project: Project,
): Result<UserProject | AgentProject> {
  if (isUser(ctx)) {
    const view = userProjectSchema.safeParse({
      ...project,
      initial_tracking_proposal: INITIAL_TRACKING_PROPOSAL,
    });
    return view.success ? ok(view.data) : invalidProjection();
  }
  const view = agentProjectSchema.safeParse({
    id: project.id,
    name: project.name,
    title: project.title,
    purpose: project.purpose,
    revision: project.revision,
    status: project.status,
  });
  return view.success ? ok(view.data) : invalidProjection();
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

function invalidProjection(): Result<never> {
  return err({ code: "internal", message: "invalid project projection" });
}

function requireReadActor(ctx: RequestContext): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  return kind !== undefined && projectList.actors.includes(kind)
    ? ok(undefined)
    : err({ code: "forbidden", message: "project read actor forbidden" });
}

export function createProjectReads(): {
  list: ReadDefinition<typeof projectList>;
  get: ReadDefinition<typeof projectGet>;
  resolve: ReadDefinition<typeof projectResolve>;
  resolveCwd: ReadDefinition<typeof projectResolveCwd>;
  trackingRoots: ReadDefinition<typeof projectTrackingRoots>;
} {
  return {
    list: {
      route: projectList,
      handle(snapshot, ctx, input) {
        const actor = requireReadActor(ctx);
        if (!actor.ok) return actor;
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const visible: (UserProject | AgentProject)[] = [];
        for (const project of projects.value) {
          if (input.status !== undefined && project.status !== input.status) {
            continue;
          }
          const access = allowed(
            snapshot,
            ctx,
            projectList.name,
            project,
          );
          if (!access.ok) return access;
          if (access.value === null) continue;
          const view = projectView(ctx, access.value);
          if (!view.ok) return view;
          visible.push(view.value);
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
          projects: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < visible.length
            ? nextProjectCursor(next, basis)
            : null,
          // undefined 필드는 platform 출력 검사에서 거절된다. 없으면 key를 뺀다.
          ...(next < visible.length
            ? {
              omitted: [{
                reason: "page_limit" as const,
                count: visible.length - next,
              }],
            }
            : {}),
        });
      },
    },
    get: {
      route: projectGet,
      handle(snapshot, ctx, input) {
        const actor = requireReadActor(ctx);
        if (!actor.ok) return actor;
        const project = loadProject(snapshot.sql, input.project);
        if (!project.ok) return project;
        if (project.value === null) return notFound();
        const access = allowed(
          snapshot,
          ctx,
          projectGet.name,
          project.value,
        );
        if (!access.ok) return access;
        if (access.value === null) return notFound();
        const view = projectView(ctx, access.value);
        if (!view.ok) return view;
        return ok({
          project: view.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    resolve: {
      route: projectResolve,
      handle(snapshot, ctx, input) {
        if (!isUser(ctx)) {
          return err({
            code: "forbidden",
            message: "project resolve is user only",
          });
        }
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const roots = projects.value.flatMap((project) =>
          project.folders.map((folder) => ({
            project: project.id,
            path: folder.path,
          }))
        );
        const found = deepestRegisteredRoot(input.path, roots);
        if (!found.ok) return found;
        if (found.value === null) return notFound();
        const project = projects.value.find((item) =>
          item.id === found.value!.project
        );
        if (project === undefined) return notFound();
        const access = allowed(
          snapshot,
          ctx,
          projectResolve.name,
          project,
        );
        if (!access.ok) return access;
        if (access.value === null) return notFound();
        const view = projectView(ctx, access.value);
        if (!view.ok) return view;
        if (!("folders" in view.value)) return unavailable();
        return ok({
          project: view.value,
          folder_path: found.value.path,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    resolveCwd: {
      route: projectResolveCwd,
      handle(snapshot, ctx, _input) {
        if (parseActor(ctx.actor)?.kind !== "coding_agent") {
          return err({
            code: "forbidden",
            message: "cwd resolve is coding agent only",
          });
        }
        // 인증 경계가 채운 cwd만 쓴다. 없거나 모양이 아니면 fail-closed다.
        const cwd = ctx.conditions.cwd;
        if (cwd === undefined || !absolutePathSchema.safeParse(cwd).success) {
          return notFound();
        }
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const roots = projects.value.flatMap((project) =>
          project.folders.map((folder) => ({
            project: project.id,
            path: folder.path,
          }))
        );
        const found = deepestRegisteredRoot(cwd, roots);
        if (!found.ok) return found;
        if (found.value === null) return notFound();
        const project = projects.value.find((item) =>
          item.id === found.value!.project
        );
        if (project === undefined) return notFound();
        const access = allowed(
          snapshot,
          ctx,
          projectResolveCwd.name,
          project,
        );
        if (!access.ok) return access;
        if (access.value === null) return notFound();
        return ok({
          project: project.id,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    trackingRoots: {
      route: projectTrackingRoots,
      handle(snapshot, ctx, _input) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return err({
            code: "forbidden",
            message: "tracking roots are machine only",
          });
        }
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const roots: { project: string; revision: string; path: string }[] = [];
        for (const project of projects.value) {
          if (project.status !== "active" || !project.tracking.enabled) {
            continue;
          }
          const access = authorizeProject(
            snapshot.port,
            ctx,
            projectTrackingRoots.name,
            { kind: "project", project },
          );
          if (denied(access)) continue;
          if (!access.ok) return access;
          for (const folder of project.folders) {
            roots.push({
              project: project.id,
              revision: project.revision,
              path: folder.path,
            });
          }
        }
        return ok({
          roots,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

// 사람 Project read의 initial_tracking_proposal은 이 값이다. 저장된 tracking과 섞지 않는다.
export const initialTrackingProposal = INITIAL_TRACKING_PROPOSAL;
