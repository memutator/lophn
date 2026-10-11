// context API command: context.record_violations·hand_off_violations.
import type { ContextApiCommands } from "./commands.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function createViolationCommands(
  _state: ContextApiState,
  _deps: ContextApiDeps,
): Pick<ContextApiCommands, "recordViolations" | "handOffViolations"> {
  return {
    recordViolations: notImplemented,
    handOffViolations: notImplemented,
  };
}
