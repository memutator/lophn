import { ok, type Result } from "../../base/mod.ts";
import {
  projectArchived,
  projectCreated,
  projectUnarchived,
  projectUpdated,
} from "../../contracts/documents/mod.ts";
import {
  type EventVisibilityDefinition,
  parseActor,
  type ReadSnapshot,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  authorizeProject,
  denied,
  dependencyUnavailable,
  type ProjectAuthorizer,
  type ProjectEvent,
} from "./authorization.ts";
import { loadProject } from "./store.ts";

export type ProjectEventAccess = ProjectAuthorizer;

// raw event는 path를 포함한다. nonuser projection 대신 닫아 둔다.
function userOnly(
  authorize: ProjectAuthorizer | undefined,
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  event: ProjectEvent,
): Result<boolean> {
  if (parseActor(ctx.actor)?.kind !== "user" || event.subject === null) {
    return ok(false);
  }
  if (typeof authorize !== "function") return dependencyUnavailable();
  const current = loadProject(snapshot.sql, event.subject);
  if (!current.ok) return current;
  if (current.value === null) return ok(false);
  const decision = authorizeProject(authorize, ctx, event.type, {
    kind: "event",
    project: current.value,
    event,
  });
  if (denied(decision)) return ok(false);
  if (!decision.ok) return decision;
  return ok(true);
}

export function createProjectEventVisibility(deps: {
  authorize: ProjectAuthorizer;
}): {
  created: EventVisibilityDefinition<typeof projectCreated>;
  updated: EventVisibilityDefinition<typeof projectUpdated>;
  archived: EventVisibilityDefinition<typeof projectArchived>;
  unarchived: EventVisibilityDefinition<typeof projectUnarchived>;
} {
  return {
    created: {
      event: projectCreated,
      handle: (snapshot, ctx, event) =>
        userOnly(deps?.authorize, snapshot, ctx, event),
    },
    updated: {
      event: projectUpdated,
      handle: (snapshot, ctx, event) =>
        userOnly(deps?.authorize, snapshot, ctx, event),
    },
    archived: {
      event: projectArchived,
      handle: (snapshot, ctx, event) =>
        userOnly(deps?.authorize, snapshot, ctx, event),
    },
    unarchived: {
      event: projectUnarchived,
      handle: (snapshot, ctx, event) =>
        userOnly(deps?.authorize, snapshot, ctx, event),
    },
  };
}
