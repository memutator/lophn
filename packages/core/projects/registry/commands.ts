import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Project,
  projectArchive,
  projectArchived,
  projectCreate,
  projectCreated,
  projectSetTracking,
  projectTrackingChanged,
  projectUnarchive,
  projectUnarchived,
  projectUpdate,
  projectUpdated,
} from "../../../protocol/projects/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  insertProject,
  loadProject,
  replaceChildren,
  replaceMetadata,
} from "./store.ts";
import { validateFolderRoots } from "./model.ts";
import {
  enabledOverlap,
  previewMatches,
  sameJson,
  trackingChanged,
} from "./tracking-apply.ts";
import { authorizeProject, type ProjectCandidate } from "./authorization.ts";

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

export function createProjectCommands(): {
  create: CommandDefinition<typeof projectCreate>;
  update: CommandDefinition<typeof projectUpdate>;
  setTracking: CommandDefinition<typeof projectSetTracking>;
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
          tx.port,
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
        insertProject(tx, project);
        return ok(project);
      },
    },
    update: {
      route: projectUpdate,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadProject(tx.sql, input.project);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const folders = input.folders ?? current.value.folders;
        if (input.folders !== undefined) {
          const roots = validateFolderRoots(input.folders);
          if (!roots.ok) return roots;
          if (
            input.preview === undefined ||
            !previewMatches(
              input.preview,
              input.project,
              compare.base_revision,
              input.folders,
              current.value.tracking,
            )
          ) {
            return conflict("folder change does not match its preview");
          }
        }
        const { revision: _revision, ...metadata } = current.value;
        const next: ProjectCandidate = {
          ...metadata,
          name: input.name ?? current.value.name,
          title: input.title ?? current.value.title,
          purpose: input.purpose ?? current.value.purpose,
          folders,
        };
        const access = authorizeProject(
          tx.port,
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
        if (input.folders !== undefined && next.tracking.enabled) {
          const overlap = enabledOverlap(tx, next, current.value.id);
          if (!overlap.ok) return overlap;
        }
        const fields = (["name", "title", "purpose", "folders"] as const)
          .filter((field) =>
            input[field] !== undefined &&
            !sameJson(input[field], current.value![field])
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
        const stored = replaceMetadata(tx, project);
        if (!stored.ok) return stored;
        if (fields.includes("folders")) {
          replaceChildren(
            tx,
            project.id,
            project.folders,
            project.tracking.patterns,
          );
        }
        return ok(project);
      },
    },
    setTracking: {
      route: projectSetTracking,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadProject(tx.sql, input.project);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const roots = validateFolderRoots(input.folders);
        if (!roots.ok) return roots;
        if (
          !previewMatches(
            input.preview,
            input.project,
            compare.base_revision,
            input.folders,
            input.tracking,
          )
        ) {
          return conflict("tracking apply does not match its preview");
        }
        const { revision: _revision, ...metadata } = current.value;
        const next: ProjectCandidate = {
          ...metadata,
          folders: input.folders,
          tracking: input.tracking,
        };
        const access = authorizeProject(
          tx.port,
          ctx,
          projectSetTracking.name,
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
        if (
          sameJson(current.value.folders, input.folders) &&
          sameJson(current.value.tracking, input.tracking)
        ) {
          return invalid("tracking does not change");
        }
        if (next.tracking.enabled && next.status === "active") {
          const overlap = enabledOverlap(tx, next, current.value.id);
          if (!overlap.ok) return overlap;
        }
        const seq = tx.emit(
          projectTrackingChanged,
          next.id,
          trackingChanged(current.value, next),
        );
        const project: Project = { ...next, revision: seq };
        const stored = replaceMetadata(tx, project);
        if (!stored.ok) return stored;
        replaceChildren(
          tx,
          project.id,
          project.folders,
          project.tracking.patterns,
        );
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
    tx.port,
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
    const overlap = enabledOverlap(tx, current.value, current.value.id);
    if (!overlap.ok) return overlap;
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
