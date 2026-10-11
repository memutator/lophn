// context API command: context.create·archive·unarchive와 bundle.rollback.
import type { ContextApiCommands } from "./commands.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function createLifecycleCommands(
  _state: ContextApiState,
  _deps: ContextApiDeps,
): Pick<
  ContextApiCommands,
  "contextCreate" | "contextArchive" | "contextUnarchive" | "bundleRollback"
> {
  return {
    contextCreate: notImplemented,
    contextArchive: notImplemented,
    contextUnarchive: notImplemented,
    bundleRollback: notImplemented,
  };
}
