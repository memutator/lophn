// bundle.rollback이 되돌린 판의 saved_views 정의를 이름 기준으로 반영한다.
// 같은 이름은 갱신, 없는 이름은 engineer origin으로 생성, 정의에 없는 기존 view는 그대로 둔다.
import { canonicalize } from "../../../base/mod.ts";
import type { SavedViewValue } from "../../../contracts/documents/mod.ts";
import { emitEvent } from "./commands-common.ts";
import type { ContextApiDeps, ContextApiState } from "./state.ts";

type ViewDefinition = {
  name: string;
  search: string;
  inputs: SavedViewValue["inputs"];
};

function definitionsOf(content: Record<string, unknown>): ViewDefinition[] {
  const declared = content.saved_views;
  return Array.isArray(declared) ? declared as ViewDefinition[] : [];
}

const same = (left: unknown, right: unknown) =>
  canonicalize(left) === canonicalize(right);

export function reflectSavedViews(
  state: ContextApiState,
  deps: ContextApiDeps,
  context: string,
  content: Record<string, unknown>,
  actor: string,
): void {
  for (const definition of definitionsOf(content)) {
    const existing = [...state.views.values()].find((view) =>
      view.context === context && view.name === definition.name
    );
    if (existing === undefined) {
      const id = deps.newId("viw");
      const revision = emitEvent(state, deps, {
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
        revision,
      });
      continue;
    }
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (existing.search !== definition.search) {
      before.search = existing.search;
      after.search = definition.search;
    }
    if (!same(existing.inputs, definition.inputs)) {
      before.inputs = existing.inputs;
      after.inputs = definition.inputs;
    }
    if (Object.keys(after).length === 0) continue;
    const revision = emitEvent(state, deps, {
      type: "SavedViewUpdated",
      subject: existing.id,
      actor,
      payload: { before, after, before_revision: existing.revision },
    });
    state.views.set(existing.id, {
      ...existing,
      search: definition.search,
      inputs: definition.inputs,
      revision,
    });
  }
}
