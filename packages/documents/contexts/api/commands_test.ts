// context API command의 acceptance 시험이다. 구현 전이라 모두 실패해야 한다(spec 단계).
// 테스트 이름의 [ctx-I..]는 시험을 통과시킬 구현 작업이다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createContextApiCommands } from "./commands.ts";
import {
  actors,
  bump,
  errorCode,
  expectOk,
  id,
  ids,
  minimalContent,
  newState,
  seedActive,
  seedBundle,
  seedContext,
  seedEntry,
  seedNumbered,
  seedView,
  seedViolations,
  summaryOf,
  testDeps,
  violation,
} from "./testing.ts";
import type { ContextApiActor } from "./state.ts";
import type {
  CheckFinding,
  StoredViolation,
} from "../../../protocol/projects/mod.ts";

function setup() {
  const state = newState();
  const t = testDeps();
  const commands = createContextApiCommands(state, t.deps);
  let n = 0;
  const key = () => `key-${++n}`;
  return { state, t, commands, key };
}

const snapshot = "c".repeat(64);
const createInput = {
  id: ids.context,
  project: ids.project,
  title: "Experiments",
  purpose: "Track experiments and findings",
};

// 같은 호출을 세 번째 인자 없이 쓰려는 줄임이다.
function call<I, C>(
  actor: ContextApiActor,
  key: string,
  input: I,
  compare: C,
) {
  return { actor, key, input, compare };
}

// ---------- context.create (ctx-I26) ----------

Deno.test("documents/contexts#R1 [ctx-I26]: context.create makes a drafting context in the project and emits ContextCreated", () => {
  const { state, commands, key } = setup();
  const value = expectOk(
    commands.contextCreate(call(actors.user, key(), createInput, {})),
  );
  assertEquals(state.events.length, 1);
  const event = state.events[0];
  assertEquals(event.type, "ContextCreated");
  assertEquals(event.subject, ids.context);
  assertEquals(event.actor, "user");
  assertEquals(event.payload, {
    project: ids.project,
    title: "Experiments",
    purpose: "Track experiments and findings",
  });
  assertEquals(value, {
    ...createInput,
    status: "drafting",
    applied_bundle: null,
    violation_mark: 0,
    revision: event.seq,
  });
  assertEquals(state.contexts.get(ids.context), value);
});

Deno.test("documents/contexts#R1 [ctx-I26]: a project can hold several contexts and the same title in another project", () => {
  const { state, commands, key } = setup();
  expectOk(commands.contextCreate(call(actors.user, key(), createInput, {})));
  expectOk(commands.contextCreate(call(actors.user, key(), {
    ...createInput,
    id: ids.otherContext,
    title: "Scenarios",
  }, {})));
  expectOk(commands.contextCreate(call(actors.user, key(), {
    ...createInput,
    id: ids.missingContext,
    project: ids.otherProject,
  }, {})));
  assertEquals(state.contexts.size, 3);
  assertEquals(state.events.map((event) => event.type), [
    "ContextCreated",
    "ContextCreated",
    "ContextCreated",
  ]);
});

Deno.test("documents/contexts#R28 [ctx-I26]: the user and the Context Engineer create contexts and nobody else does", () => {
  const { state, commands, key } = setup();
  expectOk(
    commands.contextCreate(call(actors.engineer, key(), createInput, {})),
  );
  assertEquals(state.events[0].actor, actors.engineer.actor);
  for (
    const actor of [
      actors.otherAgent,
      actors.worker,
      actors.otherMachine,
      actors.codingAgent,
    ]
  ) {
    const before = state.events.length;
    const result = commands.contextCreate(call(actor, key(), {
      ...createInput,
      id: ids.otherContext,
      title: "Other",
    }, {}));
    assertEquals(errorCode(result), "forbidden", actor.actor);
    assertEquals(state.events.length, before);
  }
});

Deno.test("documents/contexts#R1 [ctx-I26]: context.create rejects a missing or archived project and a duplicate id or title", () => {
  const { state, commands, key } = setup();
  assertEquals(
    errorCode(commands.contextCreate(call(actors.user, key(), {
      ...createInput,
      project: "prj_01arz3ndektsv4rrffq69g0777",
    }, {}))),
    "invalid_input",
  );
  state.projects.set(ids.otherProject, {
    id: ids.otherProject,
    archived: true,
  });
  assertEquals(
    errorCode(commands.contextCreate(call(actors.user, key(), {
      ...createInput,
      project: ids.otherProject,
    }, {}))),
    "invalid_input",
  );
  assertEquals(state.events.length, 0);
  expectOk(commands.contextCreate(call(actors.user, key(), createInput, {})));
  // 같은 ID
  assertEquals(
    errorCode(commands.contextCreate(call(actors.user, key(), {
      ...createInput,
      title: "Another title",
    }, {}))),
    "conflict",
  );
  // 같은 project의 같은 제목
  assertEquals(
    errorCode(commands.contextCreate(call(actors.user, key(), {
      ...createInput,
      id: ids.otherContext,
    }, {}))),
    "conflict",
  );
  assertEquals(state.events.length, 1);
});

Deno.test("documents/contexts#R1 [ctx-I26]: replaying a context.create key returns the first result and emits nothing", () => {
  const { state, commands } = setup();
  const first = expectOk(
    commands.contextCreate(call(actors.user, "same-key", createInput, {})),
  );
  const again = expectOk(
    commands.contextCreate(call(actors.user, "same-key", createInput, {})),
  );
  assertEquals(again, first);
  assertEquals(state.events.length, 1);
});

// ---------- context.archive / unarchive (ctx-I26) ----------

Deno.test("documents/contexts#R4 [ctx-I26]: archive moves a drafting or active context to archived and keeps its bundles, views and glossary", () => {
  const { state, t, commands, key } = setup();
  const drafting = seedContext(state, {
    id: ids.otherContext,
    title: "Drafts",
  });
  const { context } = seedActive(state, t);
  const view = seedView(state);
  const entry = seedEntry(state);
  const bundles = structuredClone([...state.bundles.values()]);

  const archivedActive = expectOk(commands.contextArchive(
    call(actors.user, key(), { context: context.id }, {
      base_revision: context.revision,
    }),
  ));
  const archiveEvent = state.events.at(-1)!;
  assertEquals(archiveEvent.type, "ContextArchived");
  assertEquals(archiveEvent.subject, context.id);
  assertEquals(archiveEvent.payload, { before_revision: context.revision });
  assertEquals(archivedActive, {
    ...context,
    status: "archived",
    revision: archiveEvent.seq,
  });

  const archivedDrafting = expectOk(commands.contextArchive(
    call(actors.user, key(), { context: drafting.id }, {
      base_revision: drafting.revision,
    }),
  ));
  assertEquals(archivedDrafting.status, "archived");
  assertEquals(archivedDrafting.applied_bundle, null);
  assertEquals([...state.bundles.values()], bundles);
  assertEquals(state.views.get(view.id), view);
  assertEquals(state.glossary.get(entry.id), entry);
});

Deno.test("documents/contexts#R4 [ctx-I26]: unarchive goes back to active when a bundle is applied and to drafting when none is", () => {
  const { state, t, commands, key } = setup();
  const { context } = seedActive(state, t);
  const drafting = seedContext(state, {
    id: ids.otherContext,
    title: "Drafts",
  });
  for (const target of [context, drafting]) {
    const archived = expectOk(commands.contextArchive(
      call(actors.user, key(), { context: target.id }, {
        base_revision: target.revision,
      }),
    ));
    const restored = expectOk(commands.contextUnarchive(
      call(actors.user, key(), { context: target.id }, {
        base_revision: archived.revision,
      }),
    ));
    const event = state.events.at(-1)!;
    assertEquals(event.type, "ContextUnarchived");
    assertEquals(event.payload, { before_revision: archived.revision });
    assertEquals(restored.status, target.status);
    assertEquals(restored.applied_bundle, target.applied_bundle);
    assertEquals(restored.revision, event.seq);
    assertNotEquals(restored.revision, target.revision);
  }
});

Deno.test("documents/contexts#R4 [ctx-I26]: archive and unarchive reject a stale revision, a wrong state, an unknown context and a non-user", () => {
  const { state, t, commands, key } = setup();
  const { context } = seedActive(state, t);
  const events = () => state.events.length;
  const archive = (actor: ContextApiActor, id: string, base: string) =>
    commands.contextArchive(
      call(actor, key(), { context: id }, {
        base_revision: base,
      }),
    );
  assertEquals(
    errorCode(archive(actors.user, context.id, bump(state))),
    "conflict",
  );
  assertEquals(
    errorCode(archive(actors.user, ids.missingContext, context.revision)),
    "not_found",
  );
  for (
    const actor of [
      actors.engineer,
      actors.otherAgent,
      actors.worker,
      actors.codingAgent,
    ]
  ) {
    assertEquals(
      errorCode(archive(actor, context.id, context.revision)),
      "forbidden",
      actor.actor,
    );
  }
  assertEquals(events(), 0);
  // 이미 활성이면 보관 해제는 conflict, 이미 보관이면 보관은 conflict
  assertEquals(
    errorCode(commands.contextUnarchive(
      call(actors.user, key(), { context: context.id }, {
        base_revision: context.revision,
      }),
    )),
    "conflict",
  );
  const archived = expectOk(archive(actors.user, context.id, context.revision));
  assertEquals(
    errorCode(archive(actors.user, context.id, archived.revision)),
    "conflict",
  );
  assertEquals(
    errorCode(commands.contextUnarchive(
      call(actors.worker, key(), { context: context.id }, {
        base_revision: archived.revision,
      }),
    )),
    "forbidden",
  );
});

Deno.test("documents/contexts#R4 [ctx-I26]: replaying an archive key returns the first result even after the state moved on", () => {
  const { state, t, commands } = setup();
  const { context } = seedActive(state, t);
  const archive = call(actors.user, "arch-1", { context: context.id }, {
    base_revision: context.revision,
  });
  const first = expectOk(commands.contextArchive(archive));
  expectOk(commands.contextUnarchive(
    call(actors.user, "unarch-1", { context: context.id }, {
      base_revision: first.revision,
    }),
  ));
  const events = state.events.length;
  assertEquals(expectOk(commands.contextArchive(archive)), first);
  assertEquals(state.events.length, events);
});

// ---------- bundle.rollback (ctx-I26) ----------

function rollbackFixture() {
  const world = setup();
  const { state, t } = world;
  const second = minimalContent({
    saved_views: [{
      name: "Running experiments",
      search: "experiments_by_status",
      inputs: { status: ["running"] },
    }, {
      name: "Done experiments",
      search: "experiments_by_status",
      inputs: { status: ["done"] },
    }],
  });
  const first = seedNumbered(state, t, { n: 1, status: "superseded" });
  const current = seedNumbered(state, t, {
    n: 2,
    status: "applied",
    content: second,
    parent: first.id,
  });
  const context = seedContext(state, {
    status: "active",
    applied_bundle: current.id,
  });
  return { ...world, first, current, context, second };
}

Deno.test("documents/contexts#R21 [ctx-I26]: rollback applies a superseded bundle again without a new check or number", () => {
  const { state, commands, key, first, current, context } = rollbackFixture();
  const checks = structuredClone([...state.checks.values()]);
  const result = expectOk(commands.bundleRollback(
    call(actors.user, key(), { context: context.id, bundle: first.id }, {
      base_revision: context.revision,
    }),
  ));
  assertEquals(state.events[0].type, "ContextBundleRolledBack");
  const event = state.events[0];
  assertEquals(event.subject, first.id);
  assertEquals(event.actor, "user");
  assertEquals(event.payload, {
    context: context.id,
    number: 1,
    previous_applied: current.id,
    before_revision: context.revision,
  });
  assertEquals(result.context.applied_bundle, first.id);
  assertEquals(result.context.status, "active");
  assertEquals(result.context.revision, event.seq);
  assertEquals(result.bundle, {
    ...summaryOf(first),
    status: "applied",
    revision: event.seq,
  });
  assertEquals(state.bundles.get(current.id)!.status, "superseded");
  assertEquals(state.bundles.get(first.id)!.number, 1);
  // 다시 검사하지 않는다: 검사 표와 번호가 그대로다
  assertEquals([...state.checks.values()], checks);
  assertEquals(state.bundles.size, 2);
});

Deno.test("documents/contexts#R21 [ctx-I26]: rollback reflects the saved view definitions of the restored bundle by name", () => {
  const { state, commands, key, first, context } = rollbackFixture();
  // 현재 판(2)이 적용될 때 만든 view와 첫 판의 정의에 있는 view
  seedView(state, {
    name: "Done experiments",
    origin: "engineer",
    inputs: { status: ["done"] },
  });
  const mine = seedView(state, {
    id: "viw_01arz3ndektsv4rrffq69g0002",
    name: "Mine",
    origin: "user",
    inputs: {},
  });
  // 첫 판의 정의는 Running experiments 하나이고 그 view는 아직 없다
  expectOk(commands.bundleRollback(
    call(actors.user, key(), { context: context.id, bundle: first.id }, {
      base_revision: context.revision,
    }),
  ));
  const created = [...state.views.values()].find((view) =>
    view.name === "Running experiments"
  )!;
  assertEquals(created.origin, "engineer");
  assertEquals(created.inputs, { status: ["running"] });
  // 정의에 없는 기존 view는 지우지 않는다
  assertEquals(state.views.get(mine.id), mine);
  assert(
    [...state.views.values()].some((view) => view.name === "Done experiments"),
  );
  assertEquals(
    state.events.map((event) => event.type),
    ["ContextBundleRolledBack", "SavedViewCreated"],
  );
  assertEquals(state.events[1].subject, created.id);
  assertEquals(state.events[1].payload, {
    context: context.id,
    name: "Running experiments",
    search: "experiments_by_status",
    inputs: { status: ["running"] },
    origin: "engineer",
  });
});

Deno.test("documents/contexts#R21 [ctx-I26]: rollback rejects a stale revision, a bundle that is not superseded, another context's bundle and a non-user", () => {
  const { state, t, commands, key, first, current, context } =
    rollbackFixture();
  const failed = seedNumbered(state, t, {
    n: 3,
    status: "failed",
    parent: current.id,
  });
  const draft = seedBundle(state, { id: ids.spareBundle, number: null });
  const foreign = seedNumbered(state, t, {
    n: 4,
    status: "superseded",
    context: ids.otherContext,
  });
  seedContext(state, {
    id: ids.otherContext,
    title: "Other",
    status: "active",
    applied_bundle: foreign.id,
  });
  const base = state.contexts.get(ids.context)!.revision;
  const roll = (
    actor: ContextApiActor,
    bundle: string,
    revision = base,
    contextId = context.id,
  ) =>
    commands.bundleRollback(
      call(actor, key(), { context: contextId, bundle }, {
        base_revision: revision,
      }),
    );
  assertEquals(errorCode(roll(actors.user, first.id, bump(state))), "conflict");
  assertEquals(errorCode(roll(actors.user, current.id)), "conflict");
  assertEquals(errorCode(roll(actors.user, failed.id)), "conflict");
  assertEquals(errorCode(roll(actors.user, draft.id)), "conflict");
  assertEquals(
    errorCode(roll(actors.user, ids.missingBundle)),
    "not_found",
  );
  assertEquals(errorCode(roll(actors.user, foreign.id)), "not_found");
  assertEquals(
    errorCode(roll(actors.user, first.id, base, ids.missingContext)),
    "not_found",
  );
  for (
    const actor of [
      actors.engineer,
      actors.otherAgent,
      actors.worker,
      actors.codingAgent,
    ]
  ) {
    assertEquals(errorCode(roll(actor, first.id)), "forbidden", actor.actor);
  }
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R4 [ctx-I26]: an archived context refuses a rollback", () => {
  const { state, commands, key, first, context } = rollbackFixture();
  const archived = {
    ...context,
    status: "archived" as const,
    revision: bump(state),
  };
  state.contexts.set(context.id, archived);
  assertEquals(
    errorCode(commands.bundleRollback(
      call(actors.user, key(), { context: context.id, bundle: first.id }, {
        base_revision: archived.revision,
      }),
    )),
    "conflict",
  );
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R21 [ctx-I26]: replaying a rollback key returns the first result", () => {
  const { state, commands, first, context } = rollbackFixture();
  const rollback = call(actors.user, "roll-1", {
    context: context.id,
    bundle: first.id,
  }, {
    base_revision: context.revision,
  });
  const result = expectOk(commands.bundleRollback(rollback));
  const events = state.events.length;
  assertEquals(expectOk(commands.bundleRollback(rollback)), result);
  assertEquals(state.events.length, events);
});

// ---------- bundle.save_draft / discard_draft (ctx-I25) ----------

Deno.test("documents/contexts#R19 [ctx-I25]: save_draft opens a numberless draft whose parent is the applied bundle", () => {
  const { state, t, commands, key } = setup();
  const { context, bundle: applied } = seedActive(state, t);
  const content = minimalContent();
  const result = expectOk(commands.bundleSaveDraft(
    call(actors.engineer, key(), { context: context.id, content }, {}),
  ));
  const event = state.events[0];
  assertEquals(event.type, "ContextBundleDraftSaved");
  assertEquals(event.subject, result.id);
  assertEquals(event.actor, actors.engineer.actor);
  assertEquals(event.payload, {
    context: context.id,
    parent: applied.id,
    content: t.deps.putBlob(content),
  });
  assertEquals(result, {
    id: result.id,
    context: context.id,
    number: null,
    parent: applied.id,
    bundle_hash: null,
    status: "draft",
    check: null,
    created_by: actors.engineer.actor,
    revision: event.seq,
  });
  assertEquals(state.bundles.get(result.id)!.content, content);
  // 적용된 판은 그대로다
  assertEquals(state.contexts.get(context.id), context);
  assertEquals(state.bundles.get(applied.id)!.status, "applied");
});

Deno.test("documents/contexts#R19 [ctx-I25]: the first draft of a context has no parent", () => {
  const { state, commands, key } = setup();
  seedContext(state);
  const result = expectOk(commands.bundleSaveDraft(
    call(
      actors.engineer,
      key(),
      { context: ids.context, content: { a: 1 } },
      {},
    ),
  ));
  assertEquals(result.parent, null);
  assertEquals(state.events[0].payload.parent, null);
});

Deno.test("documents/contexts#R19 [ctx-I25]: save_draft on an existing draft replaces its content under base_revision", () => {
  const { state, commands, key } = setup();
  seedContext(state);
  const first = expectOk(commands.bundleSaveDraft(
    call(
      actors.engineer,
      key(),
      { context: ids.context, content: { v: 1 } },
      {},
    ),
  ));
  const second = expectOk(commands.bundleSaveDraft(call(
    actors.engineer,
    key(),
    { context: ids.context, bundle: first.id, content: { v: 2 } },
    { base_revision: first.revision },
  )));
  assertEquals(second.id, first.id);
  assertEquals(second.status, "draft");
  assertNotEquals(second.revision, first.revision);
  assertEquals(state.bundles.get(first.id)!.content, { v: 2 });
  assertEquals(state.events.map((event) => event.type), [
    "ContextBundleDraftSaved",
    "ContextBundleDraftSaved",
  ]);
  assertEquals(state.events[1].subject, first.id);
  assertEquals(state.bundles.size, 1);
});

Deno.test("documents/contexts#R19 [ctx-I25]: save_draft rejects a second draft, a missing or stale base_revision, a wrong bundle and a non-engineer", () => {
  const { state, commands, key } = setup();
  seedContext(state);
  const draft = expectOk(commands.bundleSaveDraft(
    call(
      actors.engineer,
      key(),
      { context: ids.context, content: { v: 1 } },
      {},
    ),
  ));
  const events = state.events.length;
  const save = (
    actor: ContextApiActor,
    input: {
      context: string;
      bundle?: string;
      content: Record<string, unknown>;
    },
    compare: { base_revision?: string },
  ) => commands.bundleSaveDraft(call(actor, key(), input, compare));
  // draft는 context당 하나다
  assertEquals(
    errorCode(save(actors.engineer, { context: ids.context, content: {} }, {})),
    "conflict",
  );
  // 있는 draft를 고치는데 base_revision이 없다
  assertEquals(
    errorCode(
      save(actors.engineer, {
        context: ids.context,
        bundle: draft.id,
        content: {},
      }, {}),
    ),
    "invalid_input",
  );
  // 새 draft인데 base_revision을 보냈다
  assertEquals(
    errorCode(
      save(actors.engineer, { context: ids.context, content: {} }, {
        base_revision: draft.revision,
      }),
    ),
    "invalid_input",
  );
  assertEquals(
    errorCode(
      save(actors.engineer, {
        context: ids.context,
        bundle: draft.id,
        content: {},
      }, { base_revision: bump(state) }),
    ),
    "conflict",
  );
  assertEquals(
    errorCode(
      save(actors.engineer, {
        context: ids.context,
        bundle: ids.missingBundle,
        content: {},
      }, { base_revision: draft.revision }),
    ),
    "not_found",
  );
  assertEquals(
    errorCode(
      save(actors.engineer, { context: ids.missingContext, content: {} }, {}),
    ),
    "not_found",
  );
  for (
    const actor of [
      actors.user,
      actors.otherAgent,
      actors.worker,
      actors.codingAgent,
    ]
  ) {
    assertEquals(
      errorCode(
        save(actor, { context: ids.context, bundle: draft.id, content: {} }, {
          base_revision: draft.revision,
        }),
      ),
      "forbidden",
      actor.actor,
    );
  }
  assertEquals(state.events.length, events);
});

Deno.test("documents/contexts#R4 [ctx-I25]: an archived context takes no draft and no submit", () => {
  const { state, commands, key } = setup();
  seedContext(state, { status: "archived" });
  assertEquals(
    errorCode(commands.bundleSaveDraft(
      call(actors.engineer, key(), { context: ids.context, content: {} }, {}),
    )),
    "conflict",
  );
  const draft = seedBundle(state, { content: minimalContent() });
  assertEquals(
    errorCode(commands.bundleSubmit(
      call(actors.engineer, key(), { bundle: draft.id }, {}),
    )),
    "conflict",
  );
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R19 [ctx-I25]: replaying a save_draft key does not open a second draft", () => {
  const { state, commands } = setup();
  seedContext(state);
  const save = call(actors.engineer, "draft-1", {
    context: ids.context,
    content: { v: 1 },
  }, {});
  const first = expectOk(commands.bundleSaveDraft(save));
  assertEquals(expectOk(commands.bundleSaveDraft(save)), first);
  assertEquals(state.events.length, 1);
  assertEquals(state.bundles.size, 1);
});

Deno.test("documents/contexts#R19 [ctx-I25]: discard_draft ends a draft for the engineer or the user and applied bundles stay", () => {
  const { state, t, commands, key } = setup();
  const { context, bundle: applied } = seedActive(state, t);
  const draft = seedBundle(state, {
    id: ids.spareBundle,
    parent: applied.id,
  });
  const result = expectOk(commands.bundleDiscardDraft(
    call(actors.user, key(), { bundle: draft.id }, {
      base_revision: draft.revision,
    }),
  ));
  const event = state.events[0];
  assertEquals(event.type, "ContextBundleDraftDiscarded");
  assertEquals(event.subject, draft.id);
  assertEquals(event.payload, { context: context.id });
  assertEquals(result.status, "discarded");
  assertEquals(result.number, null);
  assertEquals(result.revision, event.seq);
  assertEquals(state.contexts.get(context.id), context);
  assertEquals(state.bundles.get(applied.id)!.status, "applied");
  // 에이전트도 버릴 수 있다
  const next = seedBundle(state, { id: ids.spareBundle2, number: null });
  const byAgent = expectOk(commands.bundleDiscardDraft(
    call(actors.engineer, key(), { bundle: next.id }, {
      base_revision: next.revision,
    }),
  ));
  assertEquals(byAgent.status, "discarded");
  assertEquals(state.events[1].actor, actors.engineer.actor);
});

Deno.test("documents/contexts#R19 [ctx-I25]: discard_draft rejects a stale revision, a non-draft, an unknown bundle and other actors", () => {
  const { state, t, commands, key } = setup();
  seedContext(state);
  const draft = seedBundle(state);
  const checking = seedNumbered(state, t, { n: 7, status: "checking" });
  const discard = (actor: ContextApiActor, bundle: string, base: string) =>
    commands.bundleDiscardDraft(
      call(actor, key(), { bundle }, { base_revision: base }),
    );
  assertEquals(
    errorCode(discard(actors.user, draft.id, bump(state))),
    "conflict",
  );
  assertEquals(
    errorCode(discard(actors.user, checking.id, checking.revision)),
    "conflict",
  );
  assertEquals(
    errorCode(discard(actors.user, ids.missingBundle, draft.revision)),
    "not_found",
  );
  for (const actor of [actors.otherAgent, actors.worker, actors.codingAgent]) {
    assertEquals(
      errorCode(discard(actor, draft.id, draft.revision)),
      "forbidden",
      actor.actor,
    );
  }
  assertEquals(state.events.length, 0);
  expectOk(discard(actors.user, draft.id, draft.revision));
  assertEquals(
    errorCode(discard(actors.user, draft.id, draft.revision)),
    "conflict",
  );
});

Deno.test("documents/contexts#R19 [ctx-I25]: replaying a discard_draft key returns the first result", () => {
  const { state, commands } = setup();
  seedContext(state);
  const draft = seedBundle(state);
  const discard = call(actors.user, "discard-1", { bundle: draft.id }, {
    base_revision: draft.revision,
  });
  const first = expectOk(commands.bundleDiscardDraft(discard));
  assertEquals(expectOk(commands.bundleDiscardDraft(discard)), first);
  assertEquals(state.events.length, 1);
});

// ---------- bundle.submit (ctx-I25) ----------

Deno.test("documents/contexts#R20 [ctx-I25]: submit numbers the draft, fixes its hash, opens a running check and emits ContextBundleSubmitted", () => {
  const { state, t, commands, key } = setup();
  const { bundle: applied } = seedActive(state, t);
  const draft = seedBundle(state, {
    id: ids.spareBundle,
    parent: applied.id,
    content: minimalContent({ examples: [] }),
  });
  const result = expectOk(commands.bundleSubmit(
    call(actors.engineer, key(), { bundle: draft.id }, {}),
  ));
  assertEquals(state.events.length, 1);
  const event = state.events[0];
  assertEquals(event.type, "ContextBundleSubmitted");
  assertEquals(event.subject, draft.id);
  const checkId = result.check!;
  assertEquals(event.payload, {
    context: ids.context,
    number: 2,
    bundle_hash: t.deps.hash(draft.content),
    check: checkId,
  });
  assertEquals(result, {
    id: draft.id,
    context: ids.context,
    number: 2,
    parent: applied.id,
    bundle_hash: t.deps.hash(draft.content),
    status: "checking",
    check: checkId,
    created_by: draft.created_by,
    revision: event.seq,
  });
  const check = state.checks.get(checkId)!;
  assertEquals(check.status, "running");
  assertEquals(check.bundle, draft.id);
  assertEquals(check.context, ids.context);
  assertEquals(check.finished_at, null);
  assertEquals(check.violation_count, null);
  assertEquals(check.findings, []);
  // 적용된 판은 검사가 통과하기 전에는 그대로다
  assertEquals(state.bundles.get(applied.id)!.status, "applied");
  assertEquals(state.contexts.get(ids.context)!.applied_bundle, applied.id);
  // 내용은 submit 뒤 바뀌지 않는다
  assertEquals(state.bundles.get(draft.id)!.content, draft.content);
});

Deno.test("documents/contexts#R19 [ctx-I25]: bundle numbers count up inside a context and failed numbers are not reused", () => {
  const { state, t, commands, key } = setup();
  seedContext(state);
  seedNumbered(state, t, { n: 1, status: "failed" });
  seedNumbered(state, t, { n: 2, status: "failed" });
  const draft = seedBundle(state, { id: ids.spareBundle });
  const result = expectOk(commands.bundleSubmit(
    call(actors.engineer, key(), { bundle: draft.id }, {}),
  ));
  assertEquals(result.number, 3);
  // 다른 context의 번호와 섞이지 않는다
  seedContext(state, { id: ids.otherContext, title: "Other" });
  const other = seedBundle(state, {
    id: ids.spareBundle2,
    context: ids.otherContext,
  });
  assertEquals(
    expectOk(commands.bundleSubmit(
      call(actors.engineer, key(), { bundle: other.id }, {}),
    )).number,
    1,
  );
});

Deno.test("documents/contexts#R20 [ctx-I25]: submit rejects content that is not a BundleContent and the draft stays a draft", () => {
  const { state, commands, key } = setup();
  seedContext(state);
  const bad = seedBundle(state, { content: { schema: 1 } });
  const result = commands.bundleSubmit(
    call(actors.engineer, key(), { bundle: bad.id }, {}),
  );
  assertEquals(errorCode(result), "invalid_input");
  assertEquals(state.events.length, 0);
  assertEquals(state.bundles.get(bad.id)!.status, "draft");
  assertEquals(state.bundles.get(bad.id)!.number, null);
  assertEquals(state.checks.size, 0);
});

Deno.test("documents/contexts#R20 [ctx-I25]: submit rejects while another bundle is checking, a non-draft, an unknown bundle and other actors", () => {
  const { state, t, commands, key } = setup();
  seedContext(state);
  const draft = seedBundle(state);
  const checking = seedNumbered(state, t, { n: 5, status: "checking" });
  const submit = (actor: ContextApiActor, bundle: string) =>
    commands.bundleSubmit(call(actor, key(), { bundle }, {}));
  assertEquals(errorCode(submit(actors.engineer, draft.id)), "conflict");
  assertEquals(errorCode(submit(actors.engineer, checking.id)), "conflict");
  assertEquals(
    errorCode(submit(actors.engineer, ids.missingBundle)),
    "not_found",
  );
  for (
    const actor of [
      actors.user,
      actors.otherAgent,
      actors.worker,
      actors.codingAgent,
    ]
  ) {
    assertEquals(errorCode(submit(actor, draft.id)), "forbidden", actor.actor);
  }
  assertEquals(state.events.length, 0);
  assertEquals(state.bundles.get(draft.id)!.status, "draft");
});

Deno.test("documents/contexts#R20 [ctx-I25]: replaying a submit key returns the first result and opens one check", () => {
  const { state, commands } = setup();
  seedContext(state);
  const draft = seedBundle(state);
  const submit = call(actors.engineer, "submit-1", { bundle: draft.id }, {});
  const first = expectOk(commands.bundleSubmit(submit));
  assertEquals(expectOk(commands.bundleSubmit(submit)), first);
  assertEquals(state.events.length, 1);
  assertEquals(state.checks.size, 1);
});

// ---------- bundle.finish_check (ctx-I25) ----------

function checkingFixture(
  options: { applied?: boolean; content?: Record<string, unknown> } = {},
) {
  const world = setup();
  const { state, t } = world;
  let parent: string | null = null;
  let context;
  if (options.applied) {
    const active = seedActive(state, t);
    context = active.context;
    parent = active.bundle.id;
  } else {
    context = seedContext(state);
  }
  const bundle = seedNumbered(state, t, {
    n: 2,
    status: "checking",
    parent,
    content: options.content,
  });
  const check = state.checks.get(bundle.check!)!;
  const report = (
    over: Partial<{
      result: "passed" | "failed";
      findings: CheckFinding[];
      violation_count: number;
      bundle_hash: string;
    }> = {},
  ) => ({
    check: check.id,
    result: "passed" as const,
    bundle_hash: bundle.bundle_hash!,
    snapshot_hash: snapshot,
    findings: [] as CheckFinding[],
    violation_count: 2,
    ...over,
  });
  return { ...world, context, bundle, check, report };
}

Deno.test("documents/contexts#R21 [ctx-I25]: a passed check applies the first bundle in the same step and the context becomes active", () => {
  const { state, commands, key, context, bundle, check, report } =
    checkingFixture();
  const result = expectOk(commands.bundleFinishCheck(
    call(actors.worker, key(), report(), {}),
  ));
  const [applied, viewCreated] = state.events;
  assertEquals(applied.type, "ContextBundleApplied");
  assertEquals(applied.subject, bundle.id);
  assertEquals(applied.actor, "machine");
  assertEquals(applied.payload, {
    context: context.id,
    number: 2,
    previous_applied: null,
    check: check.id,
    violation_count: 2,
  });
  assertEquals(result.context.status, "active");
  assertEquals(result.context.applied_bundle, bundle.id);
  assertEquals(result.context.revision, applied.seq);
  // 위반 수 기록은 별도 command의 몫이다
  assertEquals(result.context.violation_mark, 0);
  assertEquals(result.bundle.status, "applied");
  assertEquals(result.bundle.revision, applied.seq);
  assertEquals(result.check, {
    ...check,
    status: "passed",
    snapshot_hash: snapshot,
    findings: [],
    violation_count: 2,
    finished_at: result.check.finished_at,
  });
  assert(result.check.finished_at !== null);
  assertEquals(state.contexts.get(context.id), result.context);
  // saved view 정의를 같은 transaction에서 반영한다
  assertEquals(viewCreated.type, "SavedViewCreated");
  assertEquals(viewCreated.payload.origin, "engineer");
  assertEquals(state.views.size, 1);
});

Deno.test("documents/contexts#R21 [ctx-I25]: a passed check supersedes the previous applied bundle", () => {
  const { state, commands, key, context, bundle, report } = checkingFixture({
    applied: true,
  });
  const before = state.bundles.get(context.applied_bundle!)!;
  const result = expectOk(commands.bundleFinishCheck(
    call(actors.worker, key(), report({ violation_count: 0 }), {}),
  ));
  assertEquals(state.events[0].payload.previous_applied, before.id);
  assertEquals(state.bundles.get(before.id)!.status, "superseded");
  assertEquals(state.bundles.get(bundle.id)!.status, "applied");
  assertEquals(result.context.applied_bundle, bundle.id);
  assertEquals(result.context.status, "active");
  const applied = [...state.bundles.values()].filter((row) =>
    row.status === "applied"
  );
  assertEquals(applied.length, 1);
});

Deno.test("documents/contexts#R18 [ctx-I25]: applying reflects saved view definitions by name and keeps views the bundle does not define", () => {
  const content = minimalContent({
    saved_views: [{
      name: "Running experiments",
      search: "experiments_by_status",
      inputs: { status: ["running"] },
    }, {
      name: "Done experiments",
      search: "experiments_by_status",
      inputs: { status: ["done"] },
    }],
  });
  const { state, commands, key, report } = checkingFixture({
    applied: true,
    content,
  });
  // 사람이 저장한 같은 이름의 view는 갱신되고 origin은 그대로다
  const same = seedView(state, {
    name: "Running experiments",
    inputs: { status: ["planned"] },
    origin: "user",
  });
  const own = seedView(state, {
    id: "viw_01arz3ndektsv4rrffq69g0002",
    name: "My own",
    inputs: {},
    origin: "user",
  });
  expectOk(
    commands.bundleFinishCheck(
      call(actors.worker, key(), report(), {}),
    ),
  );
  const updated = state.views.get(same.id)!;
  assertEquals(updated.inputs, { status: ["running"] });
  assertEquals(updated.origin, "user");
  assertNotEquals(updated.revision, same.revision);
  assertEquals(state.views.get(own.id), own);
  const created = [...state.views.values()].find((view) =>
    view.name === "Done experiments"
  )!;
  assertEquals(created.origin, "engineer");
  assertEquals(
    state.events.map((event) => event.type),
    ["ContextBundleApplied", "SavedViewUpdated", "SavedViewCreated"],
  );
  assertEquals(state.events[1].subject, same.id);
  assertEquals(state.events[1].payload, {
    before: { inputs: { status: ["planned"] } },
    after: { inputs: { status: ["running"] } },
    before_revision: same.revision,
  });
});

Deno.test("documents/contexts#R20 [ctx-I25]: a failed check keeps the applied bundle and records the findings", () => {
  const { state, commands, key, context, bundle, check, report } =
    checkingFixture({ applied: true });
  const before = structuredClone(state.contexts.get(context.id)!);
  const findings: CheckFinding[] = [{
    kind: "example_mismatch",
    target: "examples/0",
    detail: "expected 009 first",
  }];
  const result = expectOk(commands.bundleFinishCheck(
    call(
      actors.worker,
      key(),
      report({ result: "failed", findings, violation_count: 3 }),
      {},
    ),
  ));
  assertEquals(state.events.length, 1);
  const event = state.events[0];
  assertEquals(event.type, "ContextBundleCheckFailed");
  assertEquals(event.subject, bundle.id);
  assertEquals(event.payload, {
    context: context.id,
    number: 2,
    check: check.id,
    findings,
  });
  assertEquals(result.bundle.status, "failed");
  assertEquals(result.check.status, "failed");
  assertEquals(result.check.findings, findings);
  assertEquals(result.check.violation_count, 3);
  assertEquals(result.context, before);
  assertEquals(state.contexts.get(context.id), before);
  assertEquals(state.bundles.get(before.applied_bundle!)!.status, "applied");
  assertEquals(state.views.size, 0);
});

Deno.test("documents/contexts#R20 [ctx-I25]: finish_check is for the context worker only and rejects an unknown check", () => {
  const { state, commands, key, report } = checkingFixture();
  for (
    const actor of [
      actors.user,
      actors.engineer,
      actors.otherAgent,
      actors.otherMachine,
      actors.codingAgent,
    ]
  ) {
    assertEquals(
      errorCode(
        commands.bundleFinishCheck(call(actor, key(), report(), {})),
      ),
      "forbidden",
      actor.actor,
    );
  }
  assertEquals(
    errorCode(commands.bundleFinishCheck(
      call(
        actors.worker,
        key(),
        { ...report(), check: ids.missingCheck },
        {},
      ),
    )),
    "not_found",
  );
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R20 [ctx-I25]: finish_check rejects a second result and a hash that is not the submitted bundle's", () => {
  const { state, commands, key, report, check } = checkingFixture();
  assertEquals(
    errorCode(commands.bundleFinishCheck(
      call(
        actors.worker,
        key(),
        report({ bundle_hash: "f".repeat(64) }),
        {},
      ),
    )),
    "conflict",
  );
  assertEquals(state.checks.get(check.id)!.status, "running");
  assertEquals(state.events.length, 0);
  expectOk(
    commands.bundleFinishCheck(
      call(actors.worker, key(), report(), {}),
    ),
  );
  const events = state.events.length;
  // 같은 검사의 두 번째 결과는 다른 key여도 받지 않는다
  assertEquals(
    errorCode(commands.bundleFinishCheck(
      call(
        actors.worker,
        key(),
        report({
          result: "failed",
          findings: [{ kind: "aborted", target: null, detail: "late" }],
        }),
        {},
      ),
    )),
    "conflict",
  );
  assertEquals(state.events.length, events);
});

Deno.test("documents/contexts#R20 [ctx-I25]: replaying a finish_check key returns the first result", () => {
  const { state, commands, report } = checkingFixture();
  const finish = call(actors.worker, "finish-1", report(), {});
  const first = expectOk(commands.bundleFinishCheck(finish));
  const events = state.events.length;
  assertEquals(expectOk(commands.bundleFinishCheck(finish)), first);
  assertEquals(state.events.length, events);
});

// ---------- view.* (ctx-I27) ----------

function viewFixture() {
  const world = setup();
  const { state, t } = world;
  const { context } = seedActive(state, t);
  return { ...world, context };
}

Deno.test("documents/contexts#R18 [ctx-I27]: view.save stores a named call of a declared search and emits SavedViewCreated", () => {
  const { state, commands, key, context } = viewFixture();
  const input = {
    context: context.id,
    name: "Done experiments",
    search: "experiments_by_status",
    inputs: { status: ["done"] },
  };
  const view = expectOk(commands.viewSave(call(actors.user, key(), input, {})));
  const event = state.events[0];
  assertEquals(event.type, "SavedViewCreated");
  assertEquals(event.subject, view.id);
  assertEquals(event.payload, { ...input, origin: "user" });
  assertEquals(view, {
    id: view.id,
    ...input,
    origin: "user",
    revision: event.seq,
  });
  assertEquals(state.views.get(view.id), view);
  // 열 때마다 다시 계산하므로 결과는 저장하지 않는다
  assertEquals(Object.keys(view).sort(), [
    "context",
    "id",
    "inputs",
    "name",
    "origin",
    "revision",
    "search",
  ]);
});

Deno.test("documents/contexts#R18 [ctx-I27]: view.save rejects a duplicate name, an unknown search, inputs that do not fit and a context without an applied bundle", () => {
  const { state, commands, key, context } = viewFixture();
  seedView(state, { name: "Taken" });
  const save = (over: Record<string, unknown>) =>
    commands.viewSave(call(actors.user, key(), {
      context: context.id,
      name: "New",
      search: "experiments_by_status",
      inputs: {},
      ...over,
    } as never, {}));
  assertEquals(errorCode(save({ name: "Taken" })), "conflict");
  assertEquals(errorCode(save({ search: "no_such_search" })), "invalid_input");
  // 선언에 없는 입력, 타입이 다른 입력, 빠진 필수 입력
  assertEquals(errorCode(save({ inputs: { unknown: 1 } })), "invalid_input");
  assertEquals(errorCode(save({ inputs: { status: 3 } })), "invalid_input");
  assertEquals(
    errorCode(save({ inputs: { status: "running" } })),
    "invalid_input",
  );
  assertEquals(
    errorCode(save({ search: "experiment_by_key", inputs: {} })),
    "invalid_input",
  );
  assertEquals(
    errorCode(
      save({ search: "experiment_by_key", inputs: { experiment: ["001"] } }),
    ),
    "invalid_input",
  ),
    assertEquals(
      errorCode(
        save({
          search: "experiment_by_key",
          inputs: { experiment: "001", note: 5 },
        }),
      ),
      "invalid_input",
    );
  seedContext(state, { id: ids.otherContext, title: "Drafts" });
  assertEquals(errorCode(save({ context: ids.otherContext })), "invalid_input");
  assertEquals(
    errorCode(save({ context: ids.missingContext })),
    "invalid_input",
  );
  assertEquals(state.events.length, 0);
  // 맞는 호출은 받는다
  expectOk(
    save({
      search: "experiment_by_key",
      inputs: { experiment: "001", note: "x" },
    }),
  );
});

Deno.test("documents/contexts#R18 [ctx-I27]: only the user saves, updates and deletes a view", () => {
  const { state, commands, key, context } = viewFixture();
  const view = seedView(state);
  for (
    const actor of [
      actors.engineer,
      actors.otherAgent,
      actors.worker,
      actors.codingAgent,
    ]
  ) {
    assertEquals(
      errorCode(commands.viewSave(call(actor, key(), {
        context: context.id,
        name: "X",
        search: "experiments_by_status",
        inputs: {},
      }, {}))),
      "forbidden",
      actor.actor,
    );
    assertEquals(
      errorCode(
        commands.viewUpdate(
          call(actor, key(), { view: view.id, name: "Y" }, {
            base_revision: view.revision,
          }),
        ),
      ),
      "forbidden",
    );
    assertEquals(
      errorCode(
        commands.viewDelete(
          call(actor, key(), { view: view.id }, {
            base_revision: view.revision,
          }),
        ),
      ),
      "forbidden",
    );
  }
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R18 [ctx-I27]: view.update changes the named fields and the event keeps the before and after of those only", () => {
  const { state, commands, key } = viewFixture();
  const view = seedView(state);
  const result = expectOk(commands.viewUpdate(call(
    actors.user,
    key(),
    { view: view.id, name: "Active", inputs: { status: ["running", "done"] } },
    { base_revision: view.revision },
  )));
  const event = state.events[0];
  assertEquals(event.type, "SavedViewUpdated");
  assertEquals(event.subject, view.id);
  assertEquals(event.payload, {
    before: { name: view.name, inputs: view.inputs },
    after: { name: "Active", inputs: { status: ["running", "done"] } },
    before_revision: view.revision,
  });
  assertEquals(result, {
    ...view,
    name: "Active",
    inputs: { status: ["running", "done"] },
    revision: event.seq,
  });
  assertEquals(state.views.get(view.id), result);
});

Deno.test("documents/contexts#R18 [ctx-I27]: view.update rejects a stale revision, an unknown view, a taken name and a call that does not fit", () => {
  const { state, commands, key } = viewFixture();
  const view = seedView(state);
  seedView(state, { id: "viw_01arz3ndektsv4rrffq69g0002", name: "Taken" });
  const update = (input: Record<string, unknown>, base = view.revision) =>
    commands.viewUpdate(
      call(actors.user, key(), { view: view.id, ...input } as never, {
        base_revision: base,
      }),
    );
  assertEquals(errorCode(update({ name: "A" }, bump(state))), "conflict");
  assertEquals(errorCode(update({ name: "Taken" })), "conflict");
  assertEquals(
    errorCode(update({ search: "no_such_search" })),
    "invalid_input",
  );
  assertEquals(errorCode(update({ inputs: { unknown: 1 } })), "invalid_input");
  // 검색만 바꾸면 기존 inputs가 새 검색에 맞는지 본다
  assertEquals(
    errorCode(update({ search: "experiment_by_key" })),
    "invalid_input",
  );
  assertEquals(
    errorCode(
      commands.viewUpdate(
        call(actors.user, key(), { view: ids.missingView, name: "A" }, {
          base_revision: view.revision,
        }),
      ),
    ),
    "not_found",
  );
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R18 [ctx-I27]: view.delete removes the row and the event keeps the whole view", () => {
  const { state, commands, key } = viewFixture();
  const view = seedView(state);
  const result = expectOk(commands.viewDelete(
    call(actors.user, key(), { view: view.id }, {
      base_revision: view.revision,
    }),
  ));
  assertEquals(result, { view: view.id });
  assertEquals(state.views.has(view.id), false);
  const event = state.events[0];
  assertEquals(event.type, "SavedViewDeleted");
  assertEquals(event.subject, view.id);
  assertEquals(event.payload, {
    before_view: view,
    before_revision: view.revision,
  });
  assertEquals(
    errorCode(
      commands.viewDelete(
        call(actors.user, key(), { view: view.id }, {
          base_revision: view.revision,
        }),
      ),
    ),
    "not_found",
  );
});

Deno.test("documents/contexts#R18 [ctx-I27]: view.delete rejects a stale revision", () => {
  const { state, commands, key } = viewFixture();
  const view = seedView(state);
  assertEquals(
    errorCode(
      commands.viewDelete(
        call(actors.user, key(), { view: view.id }, {
          base_revision: bump(state),
        }),
      ),
    ),
    "conflict",
  );
  assertEquals(state.views.has(view.id), true);
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R18 [ctx-I27]: replaying view.save, view.update and view.delete keys returns the first results", () => {
  const { state, commands, context } = viewFixture();
  const save = call(actors.user, "save-1", {
    context: context.id,
    name: "Done experiments",
    search: "experiments_by_status",
    inputs: { status: ["done"] },
  }, {});
  const saved = expectOk(commands.viewSave(save));
  assertEquals(expectOk(commands.viewSave(save)), saved);
  assertEquals(state.views.size, 1);
  const update = call(actors.user, "update-1", {
    view: saved.id,
    name: "Finished",
  }, {
    base_revision: saved.revision,
  });
  const updated = expectOk(commands.viewUpdate(update));
  assertEquals(expectOk(commands.viewUpdate(update)), updated);
  const del = call(actors.user, "delete-1", { view: saved.id }, {
    base_revision: updated.revision,
  });
  const deleted = expectOk(commands.viewDelete(del));
  assertEquals(expectOk(commands.viewDelete(del)), deleted);
  assertEquals(state.events.map((event) => event.type), [
    "SavedViewCreated",
    "SavedViewUpdated",
    "SavedViewDeleted",
  ]);
});

// ---------- glossary.set / remove (ctx-I28) ----------

function glossaryFixture() {
  const world = setup();
  const context = seedContext(world.state);
  return { ...world, context };
}

Deno.test("documents/terms#R1 [ctx-I28]: glossary.set adds an entry with the term as typed, the meaning, who set it and when", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = expectOk(commands.glossarySet(call(actors.user, key(), {
    id: ids.entry,
    context: context.id,
    term: "  Eating out ",
    meaning: " Meals bought outside the home ",
  }, {})));
  const event = state.events[0];
  assertEquals(event.type, "GlossaryEntrySet");
  assertEquals(event.subject, ids.entry);
  assertEquals(event.payload, {
    context: context.id,
    term: "Eating out",
    meaning: "Meals bought outside the home",
    set_by: "user",
    created: true,
  });
  assertEquals(entry, {
    id: ids.entry,
    context: context.id,
    term: "Eating out",
    meaning: "Meals bought outside the home",
    set_by: "user",
    updated_at: entry.updated_at,
    revision: event.seq,
  });
  assertEquals(event.at, entry.updated_at);
  assertEquals(state.glossary.get(ids.entry), entry);
});

Deno.test("documents/terms#R5 [ctx-I28]: the Context Engineer adds an entry as agent and the user changes it into a user entry", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = expectOk(commands.glossarySet(call(actors.engineer, key(), {
    id: ids.entry,
    context: context.id,
    term: "Run",
    meaning: "One trial",
  }, {})));
  assertEquals(entry.set_by, "agent");
  assertEquals(state.events[0].actor, actors.engineer.actor);
  const changed = expectOk(commands.glossarySet(call(actors.user, key(), {
    entry: entry.id,
    meaning: "One trial of one arm",
  }, { base_revision: entry.revision })));
  assertEquals(changed.set_by, "user");
  assertEquals(changed.term, "Run");
  assertEquals(changed.meaning, "One trial of one arm");
  assertEquals(changed.revision, state.events[1].seq);
  assertEquals(state.events[1].payload, {
    context: context.id,
    term: "Run",
    meaning: "One trial of one arm",
    set_by: "user",
    created: false,
  });
});

Deno.test("documents/terms#R6 [ctx-I28]: the Context Engineer cannot change or remove an entry the user set but can its own", () => {
  const { state, commands, key } = glossaryFixture();
  const mine = seedEntry(state, { set_by: "agent" });
  const theirs = seedEntry(state, {
    id: "trm_01arz3ndektsv4rrffq69g0002",
    term: "Arm",
    set_by: "user",
  });
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.engineer, key(), {
          entry: theirs.id,
          meaning: "agent edit",
        }, { base_revision: theirs.revision }),
      ),
    ),
    "forbidden",
  );
  assertEquals(
    errorCode(
      commands.glossaryRemove(
        call(actors.engineer, key(), { entry: theirs.id }, {
          base_revision: theirs.revision,
        }),
      ),
    ),
    "forbidden",
  );
  assertEquals(state.glossary.get(theirs.id), theirs);
  assertEquals(state.events.length, 0);
  const edited = expectOk(
    commands.glossarySet(
      call(actors.engineer, key(), { entry: mine.id, meaning: "agent edit" }, {
        base_revision: mine.revision,
      }),
    ),
  );
  assertEquals(edited.set_by, "agent");
  expectOk(
    commands.glossaryRemove(
      call(actors.engineer, key(), { entry: mine.id }, {
        base_revision: edited.revision,
      }),
    ),
  );
  assertEquals(state.glossary.has(mine.id), false);
});

Deno.test("documents/terms#R5 [ctx-I28]: only the user and the Context Engineer write the glossary", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = seedEntry(state, { set_by: "agent" });
  for (
    const actor of [
      actors.otherAgent,
      actors.worker,
      actors.otherMachine,
      actors.codingAgent,
    ]
  ) {
    assertEquals(
      errorCode(
        commands.glossarySet(
          call(actor, key(), {
            id: ids.missingEntry,
            context: context.id,
            term: "T",
            meaning: "M",
          }, {}),
        ),
      ),
      "forbidden",
      actor.actor,
    );
    assertEquals(
      errorCode(
        commands.glossarySet(
          call(actor, key(), { entry: entry.id, meaning: "M" }, {
            base_revision: entry.revision,
          }),
        ),
      ),
      "forbidden",
    );
    assertEquals(
      errorCode(
        commands.glossaryRemove(
          call(actor, key(), { entry: entry.id }, {
            base_revision: entry.revision,
          }),
        ),
      ),
      "forbidden",
    );
  }
  assertEquals(state.events.length, 0);
});

Deno.test("documents/terms#R3 [ctx-I28]: a term is unique in a context by trimmed ASCII case-insensitive comparison and a case-only rename is allowed", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = seedEntry(state, { term: "Eating out" });
  const add = (term: string, id = ids.missingEntry) =>
    commands.glossarySet(
      call(
        actors.user,
        key(),
        { id, context: context.id, term, meaning: "M" },
        {},
      ),
    );
  assertEquals(errorCode(add("eating out")), "conflict");
  assertEquals(errorCode(add("  EATING OUT  ")), "conflict");
  assertEquals(state.events.length, 0);
  // 이름만 대소문자를 바꿔 고치는 것은 된다
  const renamed = expectOk(
    commands.glossarySet(
      call(actors.user, key(), { entry: entry.id, term: "eating out" }, {
        base_revision: entry.revision,
      }),
    ),
  );
  assertEquals(renamed.term, "eating out");
  // ASCII만 접는다: 비ASCII 대소문자는 다른 용어다
  expectOk(add("Élan", id("trm", 50)));
  expectOk(add("élan", id("trm", 51)));
  // 다른 항목의 용어로 바꾸는 것은 거절
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), {
          entry: id("trm", 51),
          term: "Élan",
        }, { base_revision: state.glossary.get(id("trm", 51))!.revision }),
      ),
    ),
    "conflict",
  );
});

Deno.test("documents/terms#R2 [ctx-I28]: the same term can live in two contexts with different meanings", () => {
  const { state, commands, key, context } = glossaryFixture();
  seedContext(state, { id: ids.otherContext, title: "Other" });
  expectOk(
    commands.glossarySet(
      call(actors.user, key(), {
        id: ids.entry,
        context: context.id,
        term: "Run",
        meaning: "One trial",
      }, {}),
    ),
  );
  expectOk(
    commands.glossarySet(
      call(actors.user, key(), {
        id: id("trm", 2),
        context: ids.otherContext,
        term: "Run",
        meaning: "A software run",
      }, {}),
    ),
  );
  assertEquals(state.glossary.size, 2);
});

Deno.test("documents/terms#R4 [ctx-I28]: the 201st entry in a context is a conflict and the 200th is fine", () => {
  const { state, commands, key, context } = glossaryFixture();
  for (let n = 1; n <= 199; n++) {
    seedEntry(state, { id: id("trm", 1000 + n), term: `term ${n}` });
  }
  expectOk(
    commands.glossarySet(
      call(actors.user, key(), {
        id: ids.entry,
        context: context.id,
        term: "the 200th",
        meaning: "M",
      }, {}),
    ),
  );
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), {
          id: ids.missingEntry,
          context: context.id,
          term: "the 201st",
          meaning: "M",
        }, {}),
      ),
    ),
    "conflict",
  );
  // 다른 context의 개수는 세지 않는다
  seedContext(state, { id: ids.otherContext, title: "Other" });
  expectOk(
    commands.glossarySet(
      call(actors.user, key(), {
        id: ids.missingEntry,
        context: ids.otherContext,
        term: "first",
        meaning: "M",
      }, {}),
    ),
  );
  // 이미 있는 항목을 고치는 일은 200개에서도 된다
  const existing = state.glossary.get(ids.entry)!;
  expectOk(
    commands.glossarySet(
      call(actors.user, key(), { entry: existing.id, meaning: "M2" }, {
        base_revision: existing.revision,
      }),
    ),
  );
});

Deno.test("documents/terms#R7 [ctx-I28]: set and remove reject a stale revision and a missing one and a new entry does not take one", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = seedEntry(state);
  const events = () => state.events.length;
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), { entry: entry.id, meaning: "M" }, {
          base_revision: bump(state),
        }),
      ),
    ),
    "conflict",
  );
  assertEquals(
    errorCode(
      commands.glossaryRemove(
        call(actors.user, key(), { entry: entry.id }, {
          base_revision: bump(state),
        }),
      ),
    ),
    "conflict",
  );
  // 있는 항목을 고치는데 base_revision이 없다 / 새 항목에 base_revision을 보냈다
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), { entry: entry.id, meaning: "M" }, {}),
      ),
    ),
    "invalid_input",
  );
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), {
          id: ids.missingEntry,
          context: context.id,
          term: "New",
          meaning: "M",
        }, { base_revision: entry.revision }),
      ),
    ),
    "invalid_input",
  );
  assertEquals(events(), 0);
  // 먼저 온 요청만 반영되고 나중 요청은 충돌이다
  expectOk(
    commands.glossarySet(
      call(actors.user, key(), { entry: entry.id, meaning: "first" }, {
        base_revision: entry.revision,
      }),
    ),
  );
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), { entry: entry.id, meaning: "second" }, {
          base_revision: entry.revision,
        }),
      ),
    ),
    "conflict",
  );
  assertEquals(state.glossary.get(entry.id)!.meaning, "first");
});

Deno.test("documents/terms#R5 [ctx-I28]: glossary.set rejects a duplicate id, an unknown context and an unknown entry", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = seedEntry(state);
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), {
          id: entry.id,
          context: context.id,
          term: "Other term",
          meaning: "M",
        }, {}),
      ),
    ),
    "conflict",
  );
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), {
          id: ids.missingEntry,
          context: ids.missingContext,
          term: "T",
          meaning: "M",
        }, {}),
      ),
    ),
    "not_found",
  );
  assertEquals(
    errorCode(
      commands.glossarySet(
        call(actors.user, key(), { entry: ids.missingEntry, meaning: "M" }, {
          base_revision: "1",
        }),
      ),
    ),
    "not_found",
  );
  assertEquals(
    errorCode(
      commands.glossaryRemove(
        call(actors.user, key(), { entry: ids.missingEntry }, {
          base_revision: "1",
        }),
      ),
    ),
    "not_found",
  );
  assertEquals(state.events.length, 0);
});

Deno.test("documents/terms#R8 [ctx-I28]: remove deletes the row and emits GlossaryEntryRemoved without the old meaning", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = seedEntry(state);
  const result = expectOk(
    commands.glossaryRemove(
      call(actors.user, key(), { entry: entry.id }, {
        base_revision: entry.revision,
      }),
    ),
  );
  assertEquals(result, { entry: entry.id });
  assertEquals(state.glossary.has(entry.id), false);
  const event = state.events[0];
  assertEquals(event.type, "GlossaryEntryRemoved");
  assertEquals(event.subject, entry.id);
  assertEquals(event.payload, { context: context.id, term: entry.term });
});

Deno.test("documents/terms#R9 [ctx-I28]: archiving a context leaves its glossary as it is", () => {
  const { state, commands, key, context } = glossaryFixture();
  const entry = seedEntry(state);
  const archived = expectOk(
    commands.contextArchive(
      call(actors.user, key(), { context: context.id }, {
        base_revision: context.revision,
      }),
    ),
  );
  expectOk(
    commands.contextUnarchive(
      call(actors.user, key(), { context: context.id }, {
        base_revision: archived.revision,
      }),
    ),
  );
  assertEquals(state.glossary.get(entry.id), entry);
});

Deno.test("documents/terms#R8 [ctx-I28]: replaying glossary.set and glossary.remove keys returns the first results", () => {
  const { state, commands, context } = glossaryFixture();
  const set = call(actors.user, "set-1", {
    id: ids.entry,
    context: context.id,
    term: "Run",
    meaning: "One trial",
  }, {});
  const entry = expectOk(commands.glossarySet(set));
  assertEquals(expectOk(commands.glossarySet(set)), entry);
  assertEquals(state.glossary.size, 1);
  const remove = call(actors.user, "remove-1", { entry: entry.id }, {
    base_revision: entry.revision,
  });
  const removed = expectOk(commands.glossaryRemove(remove));
  assertEquals(expectOk(commands.glossaryRemove(remove)), removed);
  assertEquals(state.events.map((event) => event.type), [
    "GlossaryEntrySet",
    "GlossaryEntryRemoved",
  ]);
});

// ---------- context.record_violations (ctx-I30) ----------

function violationFixture(mark = 1) {
  const world = setup();
  const { state, t } = world;
  const { context, bundle } = seedActive(state, t, {
    context: { violation_mark: mark },
  });
  return { ...world, context, bundle, current: bundle.bundle_hash! };
}

Deno.test("documents/contexts#R25 [ctx-I30]: record_violations stores the new count and emits before and after", () => {
  const { state, commands, key, context, current } = violationFixture(1);
  const result = expectOk(commands.recordViolations(
    call(actors.worker, key(), {
      context: context.id,
      count: 4,
      bundle_hash: current,
    }, {}),
  ));
  const event = state.events[0];
  assertEquals(event.type, "ContextViolationsRecorded");
  assertEquals(event.subject, context.id);
  assertEquals(event.actor, "machine");
  assertEquals(event.payload, { before: 1, after: 4, bundle_hash: current });
  assertEquals(result, { ...context, violation_mark: 4, revision: event.seq });
  assertEquals(state.contexts.get(context.id), result);
});

Deno.test("documents/contexts#R25 [ctx-I30]: a lower count is recorded too, so the next rise counts from there", () => {
  const { state, commands, key, context, current } = violationFixture(5);
  const result = expectOk(commands.recordViolations(
    call(actors.worker, key(), {
      context: context.id,
      count: 0,
      bundle_hash: current,
    }, {}),
  ));
  assertEquals(result.violation_mark, 0);
  assertEquals(state.events[0].payload, {
    before: 5,
    after: 0,
    bundle_hash: current,
  });
});

Deno.test("documents/contexts#R25 [ctx-I30]: record_violations rejects the same count, a context that is not active, a stale bundle hash and an unknown context", () => {
  const { state, commands, key, context, current } = violationFixture(2);
  const record = (over: Record<string, unknown>, actor = actors.worker) =>
    commands.recordViolations(
      call(actor, key(), {
        context: context.id,
        count: 3,
        bundle_hash: current,
        ...over,
      }, {}),
    );
  assertEquals(errorCode(record({ count: 2 })), "conflict");
  assertEquals(errorCode(record({ bundle_hash: "f".repeat(64) })), "conflict");
  assertEquals(errorCode(record({ context: ids.missingContext })), "not_found");
  seedContext(state, { id: ids.otherContext, title: "Drafts" });
  assertEquals(errorCode(record({ context: ids.otherContext })), "conflict");
  // 보관된 context의 위반은 기록하지 않는다
  const archived = expectOk(
    commands.contextArchive(
      call(actors.user, key(), { context: context.id }, {
        base_revision: context.revision,
      }),
    ),
  );
  const events = state.events.length;
  assertEquals(errorCode(record({})), "conflict");
  assertEquals(state.events.length, events);
  assertEquals(
    state.contexts.get(context.id)!.violation_mark,
    archived.violation_mark,
  );
});

Deno.test("documents/contexts#R25 [ctx-I30]: only the narrow machine credential records violations", () => {
  const { state, commands, key, context, current } = violationFixture(1);
  for (
    const actor of [
      actors.user,
      actors.engineer,
      actors.otherAgent,
      actors.otherMachine,
      actors.codingAgent,
    ]
  ) {
    assertEquals(
      errorCode(
        commands.recordViolations(
          call(actor, key(), {
            context: context.id,
            count: 9,
            bundle_hash: current,
          }, {}),
        ),
      ),
      "forbidden",
      actor.actor,
    );
  }
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R25 [ctx-I30]: replaying a record_violations key does not emit twice", () => {
  const { state, commands, context, current } = violationFixture(1);
  const record = call(actors.worker, "rec-1", {
    context: context.id,
    count: 4,
    bundle_hash: current,
  }, {});
  const first = expectOk(commands.recordViolations(record));
  assertEquals(expectOk(commands.recordViolations(record)), first);
  assertEquals(state.events.length, 1);
});

// ---------- context.hand_off_violations (ctx-I30) ----------

function handOffFixture() {
  const world = violationFixture(3);
  const { state, context, current } = world;
  const rows = [
    violation({ bundle_hash: current }),
    violation({
      bundle_hash: current,
      kind: "path_mismatch",
      rule: null,
      path: "eval/experiments/notes.md",
      message: "Name does not fit the pattern",
    }),
    violation({
      bundle_hash: current,
      kind: "broken_link",
      rule: null,
      type: "Guide",
      path: "docs/README.md",
      target: "docs/gone.md",
      message: "Link target is missing",
    }),
  ];
  seedViolations(state, rows);
  return { ...world, rows, context };
}

function keyOf(
  row: {
    kind: StoredViolation["kind"];
    rule: string | null;
    path: string;
    section: string | null;
  },
) {
  return {
    kind: row.kind,
    rule: row.rule,
    path: row.path,
    section: row.section,
  };
}

Deno.test("documents/contexts#R25 [ctx-I30]: hand_off with no list hands off every violation and starts one Run with server-made evidence", () => {
  const { state, t, commands, key, context, rows } = handOffFixture();
  const result = expectOk(commands.handOffViolations(
    call(actors.user, key(), { context: context.id }, {}),
  ));
  assertEquals(t.runs.length, 1);
  assertEquals(t.runs[0].context, context.id);
  assertEquals(t.runs[0].violations, rows);
  assertEquals(result, {
    context: context.id,
    run: t.runs[0].run,
    violation_count: 3,
  });
  const event = state.events[0];
  assertEquals(event.type, "ContextViolationsHandedOff");
  assertEquals(event.subject, context.id);
  assertEquals(event.actor, "user");
  assertEquals(event.payload, {
    violations: rows.map(keyOf),
    evidence: t.runs[0].evidence,
    run: t.runs[0].run,
  });
  // 근거는 서버가 붙인다: 경로·section·규칙·현재 규칙 정의가 있고 문서 판은 없다
  const evidence = JSON.stringify(t.blobs.get(t.runs[0].evidence.hash));
  for (const row of rows) assert(evidence.includes(row.path), row.path);
  assert(evidence.includes("Experiment.status-required"));
  assert(evidence.includes("Every experiment says its status"));
  assert(!/ver_|doc_|@\d/.test(evidence));
});

Deno.test("documents/contexts#R25 [ctx-I30]: hand_off with a list hands off just those violations", () => {
  const { state, t, commands, key, context, rows } = handOffFixture();
  const result = expectOk(commands.handOffViolations(
    call(actors.user, key(), {
      context: context.id,
      violations: [keyOf(rows[2]), keyOf(rows[0])],
    }, {}),
  ));
  assertEquals(result.violation_count, 2);
  assertEquals(t.runs[0].violations, [rows[2], rows[0]]);
  assertEquals(state.events[0].payload.violations, [
    keyOf(rows[2]),
    keyOf(rows[0]),
  ]);
});

Deno.test("documents/contexts#R25 [ctx-I30]: hand_off rejects an unknown violation, no violations at all, a context that is not active and an unknown context", () => {
  const { state, t, commands, key, context, rows } = handOffFixture();
  const handOff = (input: Record<string, unknown>) =>
    commands.handOffViolations(
      call(actors.user, key(), { context: context.id, ...input } as never, {}),
    );
  assertEquals(
    errorCode(
      handOff({
        violations: [{ ...keyOf(rows[0]), path: "eval/experiments/nope.md" }],
      }),
    ),
    "invalid_input",
  );
  assertEquals(
    errorCode(handOff({ context: ids.missingContext })),
    "not_found",
  );
  seedContext(state, { id: ids.otherContext, title: "Drafts" });
  assertEquals(
    errorCode(handOff({ context: ids.otherContext })),
    "invalid_input",
  );
  // 위반이 없으면 넘길 것이 없다
  seedViolations(state, []);
  assertEquals(errorCode(handOff({})), "invalid_input");
  assertEquals(t.runs.length, 0);
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R25 [ctx-I30]: only the user hands violations off", () => {
  const { state, t, commands, key, context } = handOffFixture();
  for (
    const actor of [
      actors.engineer,
      actors.otherAgent,
      actors.worker,
      actors.codingAgent,
    ]
  ) {
    assertEquals(
      errorCode(
        commands.handOffViolations(
          call(actor, key(), { context: context.id }, {}),
        ),
      ),
      "forbidden",
      actor.actor,
    );
  }
  assertEquals(t.runs.length, 0);
  assertEquals(state.events.length, 0);
});

Deno.test("documents/contexts#R25 [ctx-I30]: replaying a hand_off key starts one Run", () => {
  const { state, t, commands, context } = handOffFixture();
  const handOff = call(actors.user, "hand-1", { context: context.id }, {});
  const first = expectOk(commands.handOffViolations(handOff));
  assertEquals(expectOk(commands.handOffViolations(handOff)), first);
  assertEquals(t.runs.length, 1);
  assertEquals(state.events.length, 1);
  // 다른 key는 새 요청이다
  expectOk(
    commands.handOffViolations(
      call(actors.user, "hand-2", { context: context.id }, {}),
    ),
  );
  assertEquals(t.runs.length, 2);
});
