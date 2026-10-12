// context API command: glossary.set·remove.
// 사람은 어느 항목이든, Context Engineer는 자기가 정한 항목만 고치거나 지운다. 검사 순서는 actor,
// 입력 모양, 대상 항목, 권한, base_revision CAS, 용어 유일과 항목 수 상한 순이다. 같은 key의 되풀이는
// withReplay가 처음 결과를 돌려준다.
import { ok, type Result } from "../../../base/mod.ts";
import {
  baseRevisionSchema,
  GLOSSARY_ENTRY_MAX,
  type GlossaryEntry,
  glossaryRemoveRequestSchema,
  type glossaryRemoveRoute,
  glossarySetRequestSchema,
  type glossarySetRoute,
  optionalBaseRevisionSchema,
} from "../../../protocol/projects/mod.ts";
import type { Call, ContextApiCommands } from "./commands.ts";
import { withReplay } from "./commands-common.ts";
import {
  emitGlossaryEvent,
  entriesIn,
  isGlossaryWriter,
  mayChange,
  rejected,
  setterOf,
  termTaken,
} from "./commands-glossary-rules.ts";
import type {
  ContextApiActor,
  ContextApiDeps,
  ContextApiState,
} from "./state.ts";

export function createGlossaryCommands(
  state: ContextApiState,
  deps: ContextApiDeps,
): Pick<ContextApiCommands, "glossarySet" | "glossaryRemove"> {
  return {
    glossarySet: (call) =>
      withReplay(state, call.key, () => setEntry(state, deps, call)),
    glossaryRemove: (call) =>
      withReplay(state, call.key, () => removeEntry(state, deps, call)),
  };
}

function setEntry(
  state: ContextApiState,
  deps: ContextApiDeps,
  call: Call<typeof glossarySetRoute>,
): Result<GlossaryEntry> {
  if (!isGlossaryWriter(call.actor)) {
    return rejected(
      "forbidden",
      "only the user and the Context Engineer write the glossary",
    );
  }
  const input = glossarySetRequestSchema.safeParse(call.input);
  const compare = optionalBaseRevisionSchema.safeParse(call.compare);
  if (!input.success || !compare.success) {
    return rejected(
      "invalid_input",
      "glossary.set does not match the contract",
    );
  }
  const body = input.data;
  const baseRevision = compare.data.base_revision;
  return "entry" in body
    ? changeEntry(state, deps, call.actor, body, baseRevision)
    : addEntry(state, deps, call.actor, body, baseRevision);
}

// 새 항목: id, context, term, meaning. base_revision은 받지 않는다.
function addEntry(
  state: ContextApiState,
  deps: ContextApiDeps,
  actor: ContextApiActor,
  body: { id: string; context: string; term: string; meaning: string },
  baseRevision: string | undefined,
): Result<GlossaryEntry> {
  if (baseRevision !== undefined) {
    return rejected(
      "invalid_input",
      "a new glossary entry takes no base_revision",
    );
  }
  if (state.glossary.has(body.id)) {
    return rejected("conflict", "a glossary entry with this id already exists");
  }
  if (!state.contexts.has(body.context)) {
    return rejected("not_found", "context not found");
  }
  if (entriesIn(state, body.context).length >= GLOSSARY_ENTRY_MAX) {
    return rejected(
      "conflict",
      `a context holds at most ${GLOSSARY_ENTRY_MAX} glossary entries`,
    );
  }
  const term = body.term.trim();
  const meaning = body.meaning.trim();
  if (termTaken(state, body.context, term)) {
    return rejected("conflict", "this term is already in the glossary");
  }
  const setBy = setterOf(actor);
  const event = emitGlossaryEvent(state, deps, {
    type: "GlossaryEntrySet",
    subject: body.id,
    actor: actor.actor,
    payload: {
      context: body.context,
      term,
      meaning,
      set_by: setBy,
      created: true,
    },
  });
  const entry: GlossaryEntry = {
    id: body.id,
    context: body.context,
    term,
    meaning,
    set_by: setBy,
    updated_at: event.at,
    revision: event.revision,
  };
  state.glossary.set(entry.id, entry);
  return ok({ ...entry });
}

// 기존 항목: entry, term?, meaning? 와 base_revision이다. 바꾸지 않은 쪽은 그대로 둔다.
function changeEntry(
  state: ContextApiState,
  deps: ContextApiDeps,
  actor: ContextApiActor,
  body: { entry: string; term?: string; meaning?: string },
  baseRevision: string | undefined,
): Result<GlossaryEntry> {
  const current = state.glossary.get(body.entry);
  if (!current) return rejected("not_found", "glossary entry not found");
  if (!mayChange(actor, current)) {
    return rejected(
      "forbidden",
      "the Context Engineer cannot change an entry the user set",
    );
  }
  if (baseRevision === undefined) {
    return rejected(
      "invalid_input",
      "changing a glossary entry needs base_revision",
    );
  }
  if (baseRevision !== current.revision) {
    return rejected("conflict", "the glossary entry changed since it was read");
  }
  const term = body.term?.trim() ?? current.term;
  const meaning = body.meaning?.trim() ?? current.meaning;
  if (
    body.term !== undefined &&
    termTaken(state, current.context, term, current.id)
  ) {
    return rejected("conflict", "this term is already in the glossary");
  }
  const setBy = setterOf(actor);
  const event = emitGlossaryEvent(state, deps, {
    type: "GlossaryEntrySet",
    subject: current.id,
    actor: actor.actor,
    payload: {
      context: current.context,
      term,
      meaning,
      set_by: setBy,
      created: false,
    },
  });
  const entry: GlossaryEntry = {
    id: current.id,
    context: current.context,
    term,
    meaning,
    set_by: setBy,
    updated_at: event.at,
    revision: event.revision,
  };
  state.glossary.set(entry.id, entry);
  return ok({ ...entry });
}

function removeEntry(
  state: ContextApiState,
  deps: ContextApiDeps,
  call: Call<typeof glossaryRemoveRoute>,
): Result<{ entry: string }> {
  if (!isGlossaryWriter(call.actor)) {
    return rejected(
      "forbidden",
      "only the user and the Context Engineer write the glossary",
    );
  }
  const input = glossaryRemoveRequestSchema.safeParse(call.input);
  const compare = baseRevisionSchema.safeParse(call.compare);
  if (!input.success || !compare.success) {
    return rejected(
      "invalid_input",
      "glossary.remove does not match the contract",
    );
  }
  const current = state.glossary.get(input.data.entry);
  if (!current) return rejected("not_found", "glossary entry not found");
  if (!mayChange(call.actor, current)) {
    return rejected(
      "forbidden",
      "the Context Engineer cannot remove an entry the user set",
    );
  }
  if (compare.data.base_revision !== current.revision) {
    return rejected("conflict", "the glossary entry changed since it was read");
  }
  emitGlossaryEvent(state, deps, {
    type: "GlossaryEntryRemoved",
    subject: current.id,
    actor: call.actor.actor,
    payload: { context: current.context, term: current.term },
  });
  state.glossary.delete(current.id);
  return ok({ entry: current.id });
}
