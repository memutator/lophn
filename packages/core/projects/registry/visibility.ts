import { ok, type Result } from "../../../base/mod.ts";
import {
  projectArchived,
  projectCreated,
  projectUnarchived,
  projectUpdated,
} from "../../../protocol/projects/mod.ts";
import {
  type EventVisibilityDefinition,
  parseActor,
  type ReadSnapshot,
  type RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  authorizeProject,
  denied,
  type ProjectEvent,
} from "./authorization.ts";
import { loadProject } from "./store.ts";

// raw event는 path를 포함한다. nonuser projection 대신 닫아 둔다.
function userOnly(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  event: ProjectEvent,
): Result<boolean> {
  if (parseActor(ctx.actor)?.kind !== "user" || event.subject === null) {
    return ok(false);
  }
  const current = loadProject(snapshot.sql, event.subject);
  if (!current.ok) return current;
  if (current.value === null) return ok(false);
  const decision = authorizeProject(snapshot.port, ctx, event.type, {
    kind: "event",
    project: current.value,
    event,
  });
  if (denied(decision)) return ok(false);
  if (!decision.ok) return decision;
  return ok(true);
}

export function createProjectEventVisibility(): {
  created: EventVisibilityDefinition<typeof projectCreated>;
  updated: EventVisibilityDefinition<typeof projectUpdated>;
  archived: EventVisibilityDefinition<typeof projectArchived>;
  unarchived: EventVisibilityDefinition<typeof projectUnarchived>;
} {
  return {
    created: {
      event: projectCreated,
      handle: (snapshot, ctx, event) => userOnly(snapshot, ctx, event),
    },
    updated: {
      event: projectUpdated,
      handle: (snapshot, ctx, event) => userOnly(snapshot, ctx, event),
    },
    archived: {
      event: projectArchived,
      handle: (snapshot, ctx, event) => userOnly(snapshot, ctx, event),
    },
    unarchived: {
      event: projectUnarchived,
      handle: (snapshot, ctx, event) => userOnly(snapshot, ctx, event),
    },
  };
}
