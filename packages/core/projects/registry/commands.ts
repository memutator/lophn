import { err, ok, type Result } from "../../../base/mod.ts";
import {
  projectApi,
  projectIdentityApi,
  type ProjectRecord,
} from "../../../protocol/projects/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  checkIconUpload,
  parseActor,
  type PortKey,
} from "../../../protocol/base/mod.ts";
import type { FolderResolver } from "../ports.ts";
import { authorizeProject } from "./authorization.ts";
import {
  PROJECT_CLONE_PRINCIPAL,
  PROJECT_IDENTITY_PRINCIPAL,
} from "./contexts.ts";
import {
  nextRevision,
  type Project,
  type ProjectCandidate,
  validateFolderRoots,
} from "./model.ts";
import { folderResolverPort } from "./ports.ts";
import { recordOf } from "./record.ts";
import {
  clearIdentity,
  insertProject,
  loadProject,
  replaceChildren,
  replaceMetadata,
  storeIdentity,
  storeProjectIcon,
} from "./store.ts";

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

function unwired(name: string): Result<never> {
  return err({ code: "internal", message: `${name} is not wired` });
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : forbidden();
}

// 정해진 core 안 machine 자격 하나만 받는다(contexts.ts).
function requireMachine(ctx: RequestContext, principal: string): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine" &&
    ctx.principal === principal
    ? ok(undefined)
    : err({ code: "forbidden", message: `${principal} only` });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// 등록하지 않은 port는 던진다. fail-closed로 받는다.
function portOf<T>(tx: Tx, key: PortKey<T>): T | undefined {
  try {
    return tx.port(key);
  } catch {
    return undefined;
  }
}

function resolverOf(tx: Tx): Result<FolderResolver> {
  const resolver = portOf(tx, folderResolverPort);
  return resolver === undefined ? unwired("folder resolver") : ok(resolver);
}

export function createProjectCommands(): {
  register: CommandDefinition<typeof projectApi.register>;
  edit: CommandDefinition<typeof projectApi.edit>;
  relinkFolder: CommandDefinition<typeof projectApi.relinkFolder>;
  archive: CommandDefinition<typeof projectApi.archive>;
  unarchive: CommandDefinition<typeof projectApi.unarchive>;
  setIcon: CommandDefinition<typeof projectApi.setIcon>;
  recordIdentity: CommandDefinition<typeof projectIdentityApi.recordIdentity>;
} {
  return {
    register: {
      route: projectApi.register,
      handle(tx, ctx, input) {
        // clone한 저장소는 core가 machine 자격으로 등록한다.
        const actor =
          parseActor(ctx.actor)?.kind === "machine"
            ? requireMachine(ctx, PROJECT_CLONE_PRINCIPAL)
            : requireUser(ctx);
        if (!actor.ok) return actor;
        const shape = validateFolderRoots(input.folders);
        if (!shape.ok) return shape;
        const candidate: ProjectCandidate = {
          ...input,
          status: "active",
          identity: null,
          repo: null,
          remote: null,
        };
        const access = authorizeProject(
          tx.port,
          ctx,
          projectApi.register.name,
          { kind: "command", before: null, after: candidate },
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
        const resolver = resolverOf(tx);
        if (!resolver.ok) return resolver;
        const project: Project = { ...candidate, revision: "1" };
        insertProject(tx, project);
        return ok(recordOf(project, resolver.value));
      },
    },
    edit: {
      route: projectApi.edit,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadProject(tx.sql, input.project);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const before = current.value;
        const folders = input.folders ?? before.folders;
        if (input.folders !== undefined) {
          const shape = validateFolderRoots(input.folders);
          if (!shape.ok) return shape;
        }
        const { revision: _revision, ...metadata } = before;
        const next: ProjectCandidate = {
          ...metadata,
          name: input.name ?? before.name,
          title: input.title ?? before.title,
          purpose: input.purpose ?? before.purpose,
          folders,
        };
        const access = authorizeProject(tx.port, ctx, projectApi.edit.name, {
          kind: "command",
          before,
          after: next,
        });
        if (!access.ok) return access;
        if (before.revision !== compare.base_revision) {
          return conflict("project revision changed");
        }
        const changed = (["name", "title", "purpose", "folders"] as const).some(
          (field) =>
            input[field] !== undefined &&
            !sameJson(input[field], before[field]),
        );
        if (!changed) return invalid("edit does not change project");
        const resolver = resolverOf(tx);
        if (!resolver.ok) return resolver;
        if (next.name !== before.name) {
          const named = tx.sql.get(
            "SELECT id FROM projects WHERE name = ? AND id <> ?",
            [next.name, next.id],
          );
          if (named !== undefined) {
            return conflict("project name already exists");
          }
        }
        const project: Project = {
          ...next,
          revision: nextRevision(before.revision),
        };
        const stored = replaceMetadata(tx, project);
        if (!stored.ok) return stored;
        if (input.folders !== undefined) {
          replaceChildren(tx, project.id, project.folders);
        }
        return ok(recordOf(project, resolver.value));
      },
    },
    relinkFolder: {
      route: projectApi.relinkFolder,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadProject(tx.sql, input.project);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const before = current.value;
        const target = before.folders.find(
          (folder) => folder.path === input.folder_path,
        );
        if (target === undefined) return notFound();
        if (input.new_path === input.folder_path) {
          return invalid("new path is the same as the folder");
        }
        // 폴더 설명은 그대로 따라간다.
        const folders = before.folders.map((folder) =>
          folder === target ? { ...folder, path: input.new_path } : folder,
        );
        const roots = validateFolderRoots(folders);
        if (!roots.ok) {
          return conflict("new path overlaps another folder of the project");
        }
        const { revision: _revision, ...metadata } = before;
        const next: ProjectCandidate = { ...metadata, folders };
        const access = authorizeProject(
          tx.port,
          ctx,
          projectApi.relinkFolder.name,
          { kind: "command", before, after: next },
        );
        if (!access.ok) return access;
        if (before.revision !== compare.base_revision) {
          return conflict("project revision changed");
        }
        const resolver = resolverOf(tx);
        if (!resolver.ok) return resolver;
        if (!resolver.value.exists(input.new_path)) {
          return invalid("new path not found");
        }
        const project: Project = {
          ...next,
          revision: nextRevision(before.revision),
        };
        const stored = replaceMetadata(tx, project);
        if (!stored.ok) return stored;
        replaceChildren(tx, project.id, project.folders);
        return ok(recordOf(project, resolver.value));
      },
    },
    // 모양일 뿐이라 revision 비교도 event도 없다. 올린 icon 하나를 덮어쓰거나 지운다.
    setIcon: {
      route: projectApi.setIcon,
      handle(tx, ctx, input) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const icon =
          input.icon === null ? ok(null) : checkIconUpload(input.icon);
        if (!icon.ok) return icon;
        const current = loadProject(tx.sql, input.project);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const { revision: _revision, ...metadata } = current.value;
        const access = authorizeProject(tx.port, ctx, projectApi.setIcon.name, {
          kind: "command",
          before: current.value,
          after: metadata,
        });
        if (!access.ok) return access;
        storeProjectIcon(tx, input.project, icon.value);
        return ok({ uploaded: icon.value !== null });
      },
    },
    recordIdentity: {
      route: projectIdentityApi.recordIdentity,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, PROJECT_IDENTITY_PRINCIPAL);
        if (!actor.ok) return actor;
        const current = loadProject(tx.sql, input.project);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const before = current.value;
        const { revision: _revision, ...metadata } = before;
        const access = authorizeProject(
          tx.port,
          ctx,
          projectIdentityApi.recordIdentity.name,
          { kind: "command", before, after: metadata },
        );
        if (!access.ok) return access;
        const resolver = resolverOf(tx);
        if (!resolver.ok) return resolver;
        // 폴더를 읽지 못했으면 아무것도 지우지 않는다.
        if (!input.found) return ok(recordOf(before, resolver.value));
        const identity = recordedIdentity(tx, before, input.file_identity);
        if (!identity.ok) return identity;
        // git이 아닌 project는 옮길 file이 없어 id가 ledger에서 난다. git project의 id는 file에서만 온다.
        const born =
          identity.value === null && input.repo === "none"
            ? tx.newId("pri")
            : identity.value;
        const project: Project = {
          ...before,
          identity: born,
          repo: input.repo,
          remote: input.remote,
        };
        storeIdentity(tx, project.id, project);
        return ok(recordOf(project, resolver.value));
      },
    },
    archive: {
      route: projectApi.archive,
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
      route: projectApi.unarchive,
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

// file이 없거나 못 읽으면(null) ledger의 id를 잊지 않는다. 한 기계에서 한 id는 project 하나만 갖는다: 먼저 가진
// project가 갖고 같은 file을 읽은 두 번째 copy는 id 없이 남는다. 보관한 holder는 active project에 넘긴다.
function recordedIdentity(
  tx: Tx,
  project: Project,
  read: string | null,
): Result<string | null> {
  if (read === null || read === project.identity) return ok(project.identity);
  const row = tx.sql.get("SELECT id FROM projects WHERE identity = ?", [read]);
  if (row === undefined) return ok(read);
  if (typeof row.id !== "string") return invalidStored();
  const holder = loadProject(tx.sql, row.id);
  if (!holder.ok) return holder;
  if (holder.value === null) return invalidStored();
  if (holder.value.status === "archived" && project.status === "active") {
    clearIdentity(tx, holder.value.id);
    return ok(read);
  }
  return ok(null);
}

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored project" });
}

// 보관해도 폴더의 파일은 그대로다. 이 command는 상태 칸만 바꾼다.
function transition(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  base: string,
  action: "archive" | "unarchive",
): Result<ProjectRecord> {
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
    action === "archive" ? projectApi.archive.name : projectApi.unarchive.name,
    { kind: "command", before: current.value, after: next },
  );
  if (!access.ok) return access;
  if (current.value.revision !== base) {
    return conflict("project revision changed");
  }
  const expected = action === "archive" ? "active" : "archived";
  if (current.value.status !== expected) {
    return conflict("project status changed");
  }
  const resolver = resolverOf(tx);
  if (!resolver.ok) return resolver;
  const project: Project = {
    ...next,
    revision: nextRevision(current.value.revision),
  };
  const stored = replaceMetadata(tx, project);
  if (!stored.ok) return stored;
  return ok(recordOf(project, resolver.value));
}
