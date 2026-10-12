// context API command: context.create·archive·unarchive와 bundle.rollback.
import { err, ok } from "../../../base/mod.ts";
import type {
  BundleContent,
  ContextValue,
} from "../../../protocol/projects/mod.ts";
import { reflectSavedViews } from "./commands-bundle-views.ts";
import { emitEvent, withReplay } from "./commands-common.ts";
import type { ContextApiCommands } from "./commands.ts";
import type {
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./state.ts";

const forbidden = (actor: ContextApiActor) =>
  err({
    code: "forbidden" as const,
    message: `${actor.kind} cannot run this command`,
  });

const isUser = (actor: ContextApiActor) => actor.kind === "user";
const canCreate = (actor: ContextApiActor) =>
  actor.kind === "user" ||
  (actor.kind === "agent" && actor.role === "context_engineer");

export function createLifecycleCommands(
  state: ContextApiState,
  deps: ContextApiDeps,
): Pick<
  ContextApiCommands,
  "contextCreate" | "contextArchive" | "contextUnarchive" | "bundleRollback"
> {
  // archive와 unarchive는 상태 전이만 다르다.
  const transition = (
    from: (context: ContextValue) => boolean,
    to: (context: ContextValue) => ContextValue["status"],
    type: "ContextArchived" | "ContextUnarchived",
    wrongState: string,
  ): ContextApiCommands["contextArchive"] =>
  (call) => {
    if (!isUser(call.actor)) return forbidden(call.actor);
    return withReplay(state, call.key, () => {
      const context = state.contexts.get(call.input.context);
      if (context === undefined) {
        return err({ code: "not_found", message: "context not found" });
      }
      if (context.revision !== call.compare.base_revision) {
        return err({ code: "conflict", message: "stale base_revision" });
      }
      if (!from(context)) {
        return err({ code: "conflict", message: wrongState });
      }
      const revision = emitEvent(state, deps, {
        type,
        subject: context.id,
        actor: call.actor.actor,
        payload: { before_revision: context.revision },
      });
      const next: ContextValue = { ...context, status: to(context), revision };
      state.contexts.set(next.id, next);
      return ok(next);
    });
  };

  return {
    contextCreate(call) {
      if (!canCreate(call.actor)) return forbidden(call.actor);
      return withReplay(state, call.key, () => {
        const input = call.input;
        const project = state.projects.get(input.project);
        if (project === undefined || project.archived) {
          return err({
            code: "invalid_input",
            message: "project does not exist or is archived",
          });
        }
        if (state.contexts.has(input.id)) {
          return err({ code: "conflict", message: "context id already used" });
        }
        const title = input.title.trim();
        for (const other of state.contexts.values()) {
          if (other.project === input.project && other.title.trim() === title) {
            return err({
              code: "conflict",
              message: "title already used in the project",
            });
          }
        }
        const revision = emitEvent(state, deps, {
          type: "ContextCreated",
          subject: input.id,
          actor: call.actor.actor,
          payload: {
            project: input.project,
            title: input.title,
            purpose: input.purpose,
          },
        });
        const context: ContextValue = {
          id: input.id,
          project: input.project,
          title: input.title,
          purpose: input.purpose,
          status: "drafting",
          applied_bundle: null,
          violation_mark: 0,
          revision,
        };
        state.contexts.set(context.id, context);
        return ok(context);
      });
    },

    contextArchive: transition(
      (context) => context.status !== "archived",
      () => "archived",
      "ContextArchived",
      "context is already archived",
    ),

    contextUnarchive: transition(
      (context) => context.status === "archived",
      (context) => context.applied_bundle === null ? "drafting" : "active",
      "ContextUnarchived",
      "context is not archived",
    ),

    bundleRollback(call) {
      if (!isUser(call.actor)) return forbidden(call.actor);
      return withReplay(state, call.key, () => {
        const context = state.contexts.get(call.input.context);
        if (context === undefined) {
          return err({ code: "not_found", message: "context not found" });
        }
        const target = state.bundles.get(call.input.bundle);
        if (target === undefined || target.context !== context.id) {
          return err({ code: "not_found", message: "bundle not found" });
        }
        if (context.revision !== call.compare.base_revision) {
          return err({ code: "conflict", message: "stale base_revision" });
        }
        if (context.status !== "active" || context.applied_bundle === null) {
          return err({
            code: "conflict",
            message: "only an active context can roll back",
          });
        }
        if (target.status !== "superseded" || target.number === null) {
          return err({ code: "conflict", message: "bundle is not superseded" });
        }
        const previous = state.bundles.get(context.applied_bundle);
        const revision = emitEvent(state, deps, {
          type: "ContextBundleRolledBack",
          subject: target.id,
          actor: call.actor.actor,
          payload: {
            context: context.id,
            number: target.number,
            previous_applied: context.applied_bundle,
            before_revision: context.revision,
          },
        });
        if (previous !== undefined) {
          state.bundles.set(previous.id, {
            ...previous,
            status: "superseded",
            revision,
          });
        }
        const applied = { ...target, status: "applied" as const, revision };
        state.bundles.set(applied.id, applied);
        const next: ContextValue = {
          ...context,
          status: "active",
          applied_bundle: applied.id,
          revision,
        };
        state.contexts.set(next.id, next);
        reflectSavedViews(
          state,
          deps,
          context.id,
          call.actor.actor,
          (applied.content.saved_views ?? []) as BundleContent["saved_views"],
        );
        const { content: _content, ...summary } = applied;
        return ok({ context: next, bundle: summary });
      });
    },
  };
}
