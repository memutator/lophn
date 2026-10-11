// context API command: view.save·update·delete.
import type { ContextApiCommands } from "./commands.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function createViewCommands(
  _state: ContextApiState,
  _deps: ContextApiDeps,
): Pick<ContextApiCommands, "viewSave" | "viewUpdate" | "viewDelete"> {
  return {
    viewSave: notImplemented,
    viewUpdate: notImplemented,
    viewDelete: notImplemented,
  };
}
