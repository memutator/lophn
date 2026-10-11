// context API command: glossary.set·remove.
import type { ContextApiCommands } from "./commands.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function createGlossaryCommands(
  _state: ContextApiState,
  _deps: ContextApiDeps,
): Pick<ContextApiCommands, "glossarySet" | "glossaryRemove"> {
  return {
    glossarySet: notImplemented,
    glossaryRemove: notImplemented,
  };
}
