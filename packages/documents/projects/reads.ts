import { err, ok, type Result } from "../../base/mod.ts";
import {
  type AgentProject,
  agentProjectSchema,
  type DocumentRef,
  type FixedDocumentRef,
  fixedDocumentRefOutputSchema,
  INITIAL_TRACKING_PROPOSAL,
  type Project,
  projectGet,
  projectList,
  projectResolve,
  projectResolveCwd,
  projectTrackingRoots,
  userProjectSchema,
} from "../../contracts/documents/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import { deepestRegisteredRoot } from "./model.ts";
import { loadProject, loadProjects, rowCount } from "./store.ts";

import { nextProjectCursor, pageOffset, projectPageBasis } from "./cursor.ts";

type UserProject = ReturnType<typeof userProjectSchema.parse>;

import {
  authorizeProject,
  denied,
  dependencyUnavailable,
  type ProjectAuthorizer,
  synchronousResult,
} from "./authorization.ts";

export type ProjectReadDeps = {
  authorize: ProjectAuthorizer;
  documents(
    snapshot: ReadSnapshot,
    project: string,
  ): Result<readonly DocumentRef[]>;
  // host가 고정한 authenticated current cwd. 없으면 resolve_cwd는 거절한다.
  currentCwd?: (ctx: RequestContext) => Result<string | null>;
};

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

function countAllowed(documents: readonly FixedDocumentRef[]): Result<number> {
  const count = rowCount({ count: documents.length });
  return count.ok
    ? count
    : err({ code: "internal", message: "invalid document count" });
}

function projectView(
  ctx: RequestContext,
  project: Project,
  documents: readonly FixedDocumentRef[],
): Result<UserProject | AgentProject> {
  const parsedDocs = documents;
  if (isUser(ctx)) {
    const count = countAllowed(parsedDocs);
    if (!count.ok) return count;
    const view = userProjectSchema.safeParse({
      ...project,
      document_count: count.value,
      documents: parsedDocs,
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
    documents: parsedDocs,
  });
  return view.success ? ok(view.data) : invalidProjection();
}

function allowed(
  deps: ProjectReadDeps,
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  project: Project,
): Result<{ project: Project; documents: readonly FixedDocumentRef[] } | null> {
  if (typeof deps?.documents !== "function") return dependencyUnavailable();
  const decision = authorizeProject(deps?.authorize, ctx, operation, {
    kind: "project",
    project,
  });
  if (denied(decision)) return ok(null);
  if (!decision.ok) return decision;
  let documents: Result<readonly DocumentRef[]>;
  try {
    documents = synchronousResult(deps.documents(snapshot, project.id));
  } catch {
    return dependencyUnavailable();
  }
  if (!documents.ok) return documents;
  if (!Array.isArray(documents.value)) return invalidProjection();
  const visible: FixedDocumentRef[] = [];
  for (const candidate of documents.value) {
    const parsed = fixedDocumentRefOutputSchema.safeParse(candidate);
    if (!parsed.success) return invalidProjection();
    const access = authorizeProject(deps.authorize, ctx, operation, {
      kind: "document",
      project,
      document: { ...parsed.data, version: parsed.data.version },
    });
    if (denied(access)) continue;
    if (!access.ok) return access;
    visible.push(parsed.data);
  }
  return ok({ project, documents: visible });
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

export function createProjectReads(deps: ProjectReadDeps): {
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
        if (
          typeof deps?.authorize !== "function" ||
          typeof deps?.documents !== "function"
        ) return dependencyUnavailable();
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const visible: (UserProject | AgentProject)[] = [];
        for (const project of projects.value) {
          if (input.status !== undefined && project.status !== input.status) {
            continue;
          }
          const access = allowed(
            deps,
            snapshot,
            ctx,
            projectList.name,
            project,
          );
          if (!access.ok) return access;
          if (access.value === null) continue;
          const view = projectView(
            ctx,
            access.value.project,
            access.value.documents,
          );
          if (!view.ok) return view;
          visible.push(view.value);
        }
        const limit = input.limit ?? PAGE;
        const basis = projectPageBasis(
          snapshot,
          ctx,
          input.status,
          limit,
          visible.map((project) => ({
            id: project.id,
            revision: project.revision,
            documents: project.documents,
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
          omitted: next < visible.length
            ? [{ reason: "page_limit" as const, count: visible.length - next }]
            : undefined,
        });
      },
    },
    get: {
      route: projectGet,
      handle(snapshot, ctx, input) {
        const actor = requireReadActor(ctx);
        if (!actor.ok) return actor;
        if (
          typeof deps?.authorize !== "function" ||
          typeof deps?.documents !== "function"
        ) return dependencyUnavailable();
        const project = loadProject(snapshot.sql, input.project);
        if (!project.ok) return project;
        if (project.value === null) return notFound();
        const access = allowed(
          deps,
          snapshot,
          ctx,
          projectGet.name,
          project.value,
        );
        if (!access.ok) return access;
        if (access.value === null) return notFound();
        const view = projectView(
          ctx,
          access.value.project,
          access.value.documents,
        );
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
        if (
          typeof deps?.authorize !== "function" ||
          typeof deps?.documents !== "function"
        ) return dependencyUnavailable();
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
          deps,
          snapshot,
          ctx,
          projectResolve.name,
          project,
        );
        if (!access.ok) return access;
        if (access.value === null) return notFound();
        const view = projectView(
          ctx,
          access.value.project,
          access.value.documents,
        );
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
        if (typeof deps?.currentCwd !== "function") return unavailable();
        let cwd: Result<string | null>;
        try {
          cwd = synchronousResult(deps.currentCwd(ctx));
        } catch {
          return unavailable();
        }
        if (!cwd.ok) return cwd;
        // caller path fallback은 없다. 고정 근거가 없으면 거절한다.
        if (cwd.value === null) return notFound();
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const roots = projects.value.flatMap((project) =>
          project.folders.map((folder) => ({
            project: project.id,
            path: folder.path,
          }))
        );
        const found = deepestRegisteredRoot(cwd.value, roots);
        if (!found.ok) return found;
        if (found.value === null) return notFound();
        const project = projects.value.find((item) =>
          item.id === found.value!.project
        );
        if (project === undefined) return notFound();
        const access = allowed(
          deps,
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
        if (typeof deps?.authorize !== "function") return unavailable();
        const projects = loadProjects(snapshot.sql);
        if (!projects.ok) return projects;
        const roots: { project: string; revision: string; path: string }[] = [];
        for (const project of projects.value) {
          if (project.status !== "active" || !project.tracking.enabled) {
            continue;
          }
          const access = authorizeProject(
            deps.authorize,
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
