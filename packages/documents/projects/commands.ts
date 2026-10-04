import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Folder,
  type Project,
  projectArchive,
  projectArchived,
  projectCreate,
  projectCreated,
  projectUnarchive,
  projectUnarchived,
  projectUpdate,
  projectUpdated,
} from "../../contracts/documents/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { createPlaceNameReservation } from "../addressing/mod.ts";
import {
  enabledRoots,
  insertProject,
  loadProject,
  loadProjects,
  replaceMetadata,
} from "./store.ts";
import { overlappingEnabledRoots, validateFolderRoots } from "./model.ts";
import {
  authorizeProject,
  type ProjectAuthorizer,
  type ProjectCandidate,
} from "./authorization.ts";

function forbidden(): Result<never> {
  return err({ code: "forbidden", message: "project changes are user only" });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "project not found" });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : forbidden();
}

function changedFields(
  before: Project,
  after: ProjectCandidate,
  fields: readonly ("name" | "title" | "purpose" | "folders")[],
) {
  const value: Record<string, unknown> = {};
  for (const field of fields) value[field] = before[field];
  const next: Record<string, unknown> = {};
  for (const field of fields) next[field] = after[field];
  return { before: value, after: next };
}

function reserveName(tx: Tx, project: Project): Result<void> {
  return createPlaceNameReservation(tx).reserve(
    project.name,
    { kind: "project", id: project.id },
    project.revision,
  );
}

export function createProjectCommands(deps: { authorize: ProjectAuthorizer }): {
  create: CommandDefinition<typeof projectCreate>;
  update: CommandDefinition<typeof projectUpdate>;
  archive: CommandDefinition<typeof projectArchive>;
  unarchive: CommandDefinition<typeof projectUnarchive>;
} {
  return {
    create: {
      route: projectCreate,
      handle(tx, ctx, input) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        if (input.tracking.enabled) return invalid("tracking starts disabled");
        const roots = validateFolderRoots(input.folders);
        if (!roots.ok) return roots;
        const candidate: ProjectCandidate = { ...input, status: "active" };
        const access = authorizeProject(
          deps?.authorize,
          ctx,
          projectCreate.name,
          {
            kind: "command",
            before: null,
            after: candidate,
          },
        );
        if (!access.ok) return access;
        const existing = loadProject(tx.sql, input.id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return conflict("project id already exists");
        }
        const named = tx.sql.get("SELECT id FROM projects WHERE name = ?", [
          input.name,
        ]);
        if (named !== undefined) return conflict("project name already exists");
        const seq = tx.emit(projectCreated, input.id, {
          name: input.name,
          title: input.title,
          purpose: input.purpose,
          folders: input.folders,
          tracking: input.tracking,
        });
        const project: Project = {
          ...input,
          revision: seq,
          status: "active",
        };
        const reserved = reserveName(tx, project);
        if (!reserved.ok) return reserved;
        insertProject(tx, project);
        return ok(project);
      },
    },
    update: {
      route: projectUpdate,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        if (input.folders !== undefined || input.preview !== undefined) {
          return invalid("folder changes require tracking preview");
        }
        const current = loadProject(tx.sql, input.project);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const { revision: _revision, ...metadata } = current.value;
        const next: ProjectCandidate = {
          ...metadata,
          name: input.name ?? current.value.name,
          title: input.title ?? current.value.title,
          purpose: input.purpose ?? current.value.purpose,
        };
        const access = authorizeProject(
          deps?.authorize,
          ctx,
          projectUpdate.name,
          {
            kind: "command",
            before: current.value,
            after: next,
          },
        );
        if (!access.ok) return access;
        if (current.value.revision !== compare.base_revision) {
          return conflict("project revision changed");
        }
        const fields = (["name", "title", "purpose"] as const).filter((field) =>
          input[field] !== undefined && input[field] !== current.value![field]
        );
        if (fields.length === 0) {
          return invalid("update does not change project");
        }
        if (next.name !== current.value.name) {
          const named = tx.sql.get(
            "SELECT id FROM projects WHERE name = ? AND id <> ?",
            [next.name, next.id],
          );
          if (named !== undefined) {
            return conflict("project name already exists");
          }
        }
        const seq = tx.emit(
          projectUpdated,
          next.id,
          changedFields(current.value, next, fields),
        );
        const project: Project = { ...next, revision: seq };
        if (next.name !== current.value.name) {
          const reserved = reserveName(tx, project);
          if (!reserved.ok) return reserved;
        }
        const stored = replaceMetadata(tx, project);
        if (!stored.ok) return stored;
        return ok(project);
      },
    },
    archive: {
      route: projectArchive,
      handle(tx, ctx, input, compare) {
        return transition(
          tx,
          ctx,
          input.project,
          compare.base_revision,
          "archive",
          deps?.authorize,
        );
      },
    },
    unarchive: {
      route: projectUnarchive,
      handle(tx, ctx, input, compare) {
        return transition(
          tx,
          ctx,
          input.project,
          compare.base_revision,
          "unarchive",
          deps?.authorize,
        );
      },
    },
  };
}

function transition(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  action: "archive" | "unarchive",
  authorize: ProjectAuthorizer | undefined,
): Result<Project> {
  const actor = requireUser(ctx);
  if (!actor.ok) return actor;
  const current = loadProject(tx.sql, id);
  if (!current.ok) return current;
  if (current.value === null) return notFound();
  const { revision: _revision, ...metadata } = current.value;
  const next: ProjectCandidate = {
    ...metadata,
    status: action === "archive" ? "archived" : "active",
  };
  const access = authorizeProject(
    authorize,
    ctx,
    action === "archive" ? projectArchive.name : projectUnarchive.name,
    {
      kind: "command",
      before: current.value,
      after: next,
    },
  );
  if (!access.ok) return access;
  if (current.value.revision !== base) {
    return conflict("project revision changed");
  }
  const expected = action === "archive" ? "active" : "archived";
  if (current.value.status !== expected) {
    return conflict("project status changed");
  }
  if (action === "unarchive" && current.value.tracking.enabled) {
    const projects = loadProjects(tx.sql);
    if (!projects.ok) return projects;
    const overlap = overlappingEnabledRoots([
      ...enabledRoots(projects.value),
      ...current.value.folders.map((folder: Folder) => ({
        project: current.value!.id,
        path: folder.path,
        enabled: true,
      })),
    ]);
    if (!overlap.ok) return overlap;
    if (overlap.value !== null) {
      return conflict("enabled tracking roots overlap");
    }
  }
  const seq = tx.emit(
    action === "archive" ? projectArchived : projectUnarchived,
    next.id,
    { before_revision: current.value.revision },
  );
  const project: Project = { ...next, revision: seq };
  const stored = replaceMetadata(tx, project);
  if (!stored.ok) return stored;
  return ok(project);
}
