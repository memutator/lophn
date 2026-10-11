// 판이 적용될 때 saved view 정의를 이름 기준으로 반영한다(같은 이름은 갱신, 없는 이름은 engineer
// origin으로 생성, 정의에 없는 기존 view는 그대로). 적용과 같은 transaction이므로 호출한 쪽이 상태를
// 바꾸기 전에 쓰지 않고, 여기서는 event와 view 상태만 바꾼다.
import { canonicalize } from "../../../base/mod.ts";
import type { BundleContent } from "../../../contracts/documents/mod.ts";
import { emitEvent } from "./commands-common.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

export function reflectSavedViews(
  state: ContextApiState,
  deps: ContextApiDeps,
  context: string,
  actor: string,
  definitions: BundleContent["saved_views"],
): void {
  for (const definition of definitions) {
    const name = definition.name.trim();
    const existing = [...state.views.values()].find((view) =>
      view.context === context && view.name.trim() === name
    );
    if (existing === undefined) {
      const id = deps.newId("viw");
      const seq = emitEvent(state, deps, {
        type: "SavedViewCreated",
        subject: id,
        actor,
        payload: {
          context,
          name: definition.name,
          search: definition.search,
          inputs: definition.inputs,
          origin: "engineer",
        },
      });
      state.views.set(id, {
        id,
        context,
        name: definition.name,
        search: definition.search,
        inputs: definition.inputs,
        origin: "engineer",
        revision: seq,
      });
      continue;
    }
    const searchChanged = existing.search !== definition.search;
    const inputsChanged = canonicalize(existing.inputs) !==
      canonicalize(definition.inputs);
    if (!searchChanged && !inputsChanged) continue;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (searchChanged) {
      before.search = existing.search;
      after.search = definition.search;
    }
    if (inputsChanged) {
      before.inputs = existing.inputs;
      after.inputs = definition.inputs;
    }
    const seq = emitEvent(state, deps, {
      type: "SavedViewUpdated",
      subject: existing.id,
      actor,
      payload: { before, after, before_revision: existing.revision },
    });
    state.views.set(existing.id, {
      ...existing,
      search: definition.search,
      inputs: definition.inputs,
      revision: seq,
    });
  }
}
