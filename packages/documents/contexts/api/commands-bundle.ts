// context API command: bundle.save_draft·discard_draft·submit·finish_check와 검사 통과 때 자동 적용.
import type { ContextApiCommands } from "./commands.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function createBundleCommands(
  _state: ContextApiState,
  _deps: ContextApiDeps,
): Pick<
  ContextApiCommands,
  | "bundleSaveDraft"
  | "bundleDiscardDraft"
  | "bundleSubmit"
  | "bundleFinishCheck"
> {
  return {
    bundleSaveDraft: notImplemented,
    bundleDiscardDraft: notImplemented,
    bundleSubmit: notImplemented,
    bundleFinishCheck: notImplemented,
  };
}
