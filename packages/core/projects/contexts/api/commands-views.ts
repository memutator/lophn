// context API command: view.save·update·delete. saved view는 user만 바꾸고, 저장하는 호출은 적용된 판에
// 맞아야 한다. 같은 idempotency key의 되풀이는 처음 결과를 돌려준다(commands-common).
import type { Result } from "../../../../base/mod.ts";
import { ok } from "../../../../base/mod.ts";
import type {
  SavedViewValue,
  viewDeleteRoute,
  viewSaveRoute,
  viewUpdateRoute,
} from "../../../../protocol/projects/mod.ts";
import type { Call, ContextApiCommands } from "./commands.ts";
import { emitEvent, withReplay } from "./commands-common.ts";
import {
  checkAppliedCall,
  fail,
  savedViewNameTaken,
} from "./commands-views-rules.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

const USER_ONLY = "only the user saves, updates and deletes a saved view";

// update 이벤트의 before·after에는 이번 호출이 바꾸는 필드만 둔다.
type ViewEdit = Partial<Pick<SavedViewValue, "name" | "search" | "inputs">>;

export function createViewCommands(
  state: ContextApiState,
  deps: ContextApiDeps,
): Pick<ContextApiCommands, "viewSave" | "viewUpdate" | "viewDelete"> {
  return {
    viewSave: (call) =>
      withReplay(state, call.key, () => saveView(state, deps, call)),
    viewUpdate: (call) =>
      withReplay(state, call.key, () => updateView(state, deps, call)),
    viewDelete: (call) =>
      withReplay(state, call.key, () => deleteView(state, deps, call)),
  };
}

function saveView(
  state: ContextApiState,
  deps: ContextApiDeps,
  call: Call<typeof viewSaveRoute>,
): Result<SavedViewValue> {
  if (call.actor.kind !== "user") return fail("forbidden", USER_ONLY);
  const { context, name, search, inputs } = call.input;
  const fit = checkAppliedCall(state, context, search, inputs);
  if (!fit.ok) return fit;
  if (savedViewNameTaken(state, context, name)) {
    return fail("conflict", `saved view ${name} already exists in the context`);
  }
  const id = deps.newId("viw");
  // 저장한 호출은 호출자가 나중에 고쳐도 바뀌지 않게 복사해 둔다.
  const fixed = structuredClone(inputs);
  const revision = emitEvent(state, deps, {
    type: "SavedViewCreated",
    subject: id,
    actor: call.actor.actor,
    payload: { context, name, search, inputs: fixed, origin: "user" },
  });
  const view: SavedViewValue = {
    id,
    context,
    name,
    search,
    inputs: fixed,
    origin: "user",
    revision,
  };
  state.views.set(id, view);
  return ok(view);
}

function updateView(
  state: ContextApiState,
  deps: ContextApiDeps,
  call: Call<typeof viewUpdateRoute>,
): Result<SavedViewValue> {
  if (call.actor.kind !== "user") return fail("forbidden", USER_ONLY);
  const { view: viewId, name, search, inputs } = call.input;
  const view = state.views.get(viewId);
  if (view === undefined) {
    return fail("not_found", `saved view ${viewId} not found`);
  }
  if (call.compare.base_revision !== view.revision) {
    return fail(
      "conflict",
      `saved view ${viewId} changed since the base revision`,
    );
  }
  // 검색만 바꿔도 기존 입력이 새 검색에 맞는지 봐야 하므로 유효한 쪽을 합쳐서 검사한다.
  if (search !== undefined || inputs !== undefined) {
    const fit = checkAppliedCall(
      state,
      view.context,
      search ?? view.search,
      inputs ?? view.inputs,
    );
    if (!fit.ok) return fit;
  }
  if (
    name !== undefined &&
    savedViewNameTaken(state, view.context, name, view.id)
  ) {
    return fail("conflict", `saved view ${name} already exists in the context`);
  }

  const before: ViewEdit = {};
  const after: ViewEdit = {};
  if (name !== undefined) {
    before.name = view.name;
    after.name = name;
  }
  if (search !== undefined) {
    before.search = view.search;
    after.search = search;
  }
  if (inputs !== undefined) {
    before.inputs = view.inputs;
    after.inputs = structuredClone(inputs);
  }
  const revision = emitEvent(state, deps, {
    type: "SavedViewUpdated",
    subject: view.id,
    actor: call.actor.actor,
    payload: { before, after, before_revision: view.revision },
  });
  const updated: SavedViewValue = { ...view, ...after, revision };
  state.views.set(view.id, updated);
  return ok(updated);
}

function deleteView(
  state: ContextApiState,
  deps: ContextApiDeps,
  call: Call<typeof viewDeleteRoute>,
): Result<{ view: string }> {
  if (call.actor.kind !== "user") return fail("forbidden", USER_ONLY);
  const view = state.views.get(call.input.view);
  if (view === undefined) {
    return fail("not_found", `saved view ${call.input.view} not found`);
  }
  if (call.compare.base_revision !== view.revision) {
    return fail(
      "conflict",
      `saved view ${view.id} changed since the base revision`,
    );
  }
  // 지운 뒤에도 event가 전체 모양을 가지고 있어야 되돌릴 수 있다.
  emitEvent(state, deps, {
    type: "SavedViewDeleted",
    subject: view.id,
    actor: call.actor.actor,
    payload: { before_view: view, before_revision: view.revision },
  });
  state.views.delete(view.id);
  return ok({ view: view.id });
}
