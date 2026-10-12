// context API command. 묶음마다 파일 하나다: commands-lifecycle(context.create·archive·unarchive,
// bundle.rollback), commands-bundle(bundle.save_draft·discard_draft·submit·finish_check와 자동 적용),
// commands-views(view.*), commands-glossary(glossary.*), commands-violations(context.record_violations,
// context.hand_off_violations). event와 재실행은 commands-common이 맡는다.
import type { Result } from "../../../../base/mod.ts";
import type {
  bundleDiscardDraftRoute,
  bundleFinishCheckRoute,
  bundleRollbackRoute,
  bundleSaveDraftRoute,
  bundleSubmitRoute,
  contextArchiveRoute,
  contextCreateRoute,
  contextHandOffViolationsRoute,
  contextRecordViolationsRoute,
  contextUnarchiveRoute,
  glossaryRemoveRoute,
  glossarySetRoute,
  viewDeleteRoute,
  viewSaveRoute,
  viewUpdateRoute,
} from "../../../../protocol/projects/mod.ts";
import type {
  CommandRoute,
  Compare,
  Input,
  Output,
} from "../../../../protocol/server/mod.ts";
import type {
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./state.ts";
import { createBundleCommands } from "./commands-bundle.ts";
import { createGlossaryCommands } from "./commands-glossary.ts";
import { createLifecycleCommands } from "./commands-lifecycle.ts";
import { createViewCommands } from "./commands-views.ts";
import { createViolationCommands } from "./commands-violations.ts";

// 한 번의 호출. key는 envelope의 idempotency key, compare는 CAS 기준이다.
export type Call<R extends CommandRoute> = {
  actor: ContextApiActor;
  key: string;
  input: Input<R>;
  compare: Compare<R>;
};
export type Handler<R extends CommandRoute> = (
  call: Call<R>,
) => Result<Output<R>>;

export type ContextApiCommands = {
  contextCreate: Handler<typeof contextCreateRoute>;
  contextArchive: Handler<typeof contextArchiveRoute>;
  contextUnarchive: Handler<typeof contextUnarchiveRoute>;
  bundleSaveDraft: Handler<typeof bundleSaveDraftRoute>;
  bundleDiscardDraft: Handler<typeof bundleDiscardDraftRoute>;
  bundleSubmit: Handler<typeof bundleSubmitRoute>;
  bundleFinishCheck: Handler<typeof bundleFinishCheckRoute>;
  bundleRollback: Handler<typeof bundleRollbackRoute>;
  viewSave: Handler<typeof viewSaveRoute>;
  viewUpdate: Handler<typeof viewUpdateRoute>;
  viewDelete: Handler<typeof viewDeleteRoute>;
  recordViolations: Handler<typeof contextRecordViolationsRoute>;
  handOffViolations: Handler<typeof contextHandOffViolationsRoute>;
  glossarySet: Handler<typeof glossarySetRoute>;
  glossaryRemove: Handler<typeof glossaryRemoveRoute>;
};

export function createContextApiCommands(
  state: ContextApiState,
  deps: ContextApiDeps,
): ContextApiCommands {
  return {
    ...createLifecycleCommands(state, deps),
    ...createBundleCommands(state, deps),
    ...createViewCommands(state, deps),
    ...createGlossaryCommands(state, deps),
    ...createViolationCommands(state, deps),
  };
}
