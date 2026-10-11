// context API command의 구현 자리다. 아직 구현하지 않았다(spec 단계).
// 구현 작업: ctx-I25(bundle.submit, bundle.finish_check와 자동 적용), ctx-I26(bundle.rollback,
// context.archive·unarchive·create), ctx-I27(view.*), ctx-I28(glossary.*),
// ctx-I30(context.record_violations, context.hand_off_violations).
import type { Result } from "../../../base/mod.ts";
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
} from "../../../contracts/documents/mod.ts";
import type {
  CommandRoute,
  Compare,
  Input,
  Output,
} from "../../../contracts/platform/mod.ts";
import type {
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./state.ts";

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
  _state: ContextApiState,
  _deps: ContextApiDeps,
): ContextApiCommands {
  throw new Error("not implemented");
}
