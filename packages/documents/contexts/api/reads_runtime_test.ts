// agent runtime이 run 시작 전에 읽는 재료(context.list의 app 거르기, context.contract의 판 지정)와 machine
// 자격의 범위를 작은 메모리 상태 위에서 본다.
import { assertEquals } from "@std/assert";
import { createContextApiReads } from "./reads.ts";
import {
  actors,
  errorCode,
  expectOk,
  id,
  ids,
  minimalContent,
  newState,
  seedActive,
  seedContext,
  seedNumbered,
  testDeps,
} from "./testing.ts";

const APP = id("app", 1);
const OTHER_APP = id("app", 2);

function setup() {
  const state = newState();
  const t = testDeps();
  const reads = createContextApiReads(state, { execute: () => [] });
  return { state, t, reads };
}

Deno.test("documents/contexts#R1 [ctx-I56b]: context.list with app returns the active contexts whose applied bundle reads that app, across projects", () => {
  const { state, t, reads } = setup();
  const reading = seedActive(state, t, {
    n: 1,
    slot: 1,
    context: { id: id("ctx", 1), title: "Calendar" },
  }).context;
  const elsewhere = seedActive(state, t, {
    n: 2,
    slot: 2,
    context: { id: id("ctx", 2), title: "Agenda", project: ids.otherProject },
  }).context;
  const other = seedActive(state, t, {
    n: 3,
    slot: 3,
    context: { id: id("ctx", 3), title: "Mail" },
  }).context;
  seedActive(state, t, {
    n: 4,
    slot: 4,
    context: { id: id("ctx", 4), title: "Plain" },
  });
  const archived = seedContext(state, {
    id: id("ctx", 5),
    title: "Old",
    status: "archived",
    applied_bundle: id("cbn", 1),
  });
  state.appReaders.set(reading.id, [APP]);
  state.appReaders.set(elsewhere.id, [APP, OTHER_APP]);
  state.appReaders.set(other.id, [OTHER_APP]);
  state.appReaders.set(archived.id, [APP]);

  const page = expectOk(
    reads.contextList({ actor: actors.user, input: { app: APP } }),
  );
  // 제목 순이고 다른 project의 context도 든다. 보관된 것과 앱을 읽지 않는 것은 없다.
  assertEquals(page.contexts.map((item) => item.id), [
    elsewhere.id,
    reading.id,
  ]);
  assertEquals(page.contexts[0]!.applied_number, 2);
  assertEquals(
    expectOk(reads.contextList({
      actor: actors.user,
      input: { app: OTHER_APP },
    })).contexts.map((item) => item.id),
    [elsewhere.id, other.id].sort((a, b) =>
      state.contexts.get(a)!.title < state.contexts.get(b)!.title ? -1 : 1
    ),
  );
  // 읽는 context가 없는 앱은 빈 목록이다.
  assertEquals(
    expectOk(reads.contextList({
      actor: actors.user,
      input: { app: id("app", 99) },
    })).contexts,
    [],
  );
  // 보관된 것까지 보려면 status를 준다.
  assertEquals(
    expectOk(reads.contextList({
      actor: actors.user,
      input: { app: APP, status: "all" },
    })).contexts.map((item) => item.id),
    [elsewhere.id, reading.id, archived.id],
  );
});

Deno.test("documents/contexts#R19 [ctx-I56b]: the agent runtime machine reads context.list, get and contract and nothing else", () => {
  const { state, t, reads } = setup();
  const { context, bundle } = seedActive(state, t);
  state.appReaders.set(context.id, [APP]);
  const runtime = actors.runtime;

  expectOk(
    reads.contextList({ actor: runtime, input: { project: ids.project } }),
  );
  expectOk(reads.contextList({ actor: runtime, input: { app: APP } }));
  expectOk(
    reads.contextGet({ actor: runtime, input: { context: context.id } }),
  );
  assertEquals(
    expectOk(
      reads.contextContract({ actor: runtime, input: { context: context.id } }),
    ).bundle,
    bundle.id,
  );

  // 다른 읽기는 모두 forbidden이다.
  const input = { context: context.id };
  const refused: [string, () => string][] = [
    [
      "overview",
      () => errorCode(reads.contextOverview({ actor: runtime, input })),
    ],
    ["draft", () => errorCode(reads.contextDraft({ actor: runtime, input }))],
    [
      "bundles",
      () => errorCode(reads.contextBundles({ actor: runtime, input })),
    ],
    [
      "violations",
      () => errorCode(reads.contextViolations({ actor: runtime, input })),
    ],
    [
      "saved_views",
      () => errorCode(reads.contextSavedViews({ actor: runtime, input })),
    ],
    [
      "glossary",
      () => errorCode(reads.glossaryList({ actor: runtime, input })),
    ],
  ];
  for (const [name, run] of refused) assertEquals(run(), "forbidden", name);
  assertEquals(
    errorCode(reads.contextSearch({
      actor: runtime,
      input: {
        context: context.id,
        search: "experiments_by_status",
        inputs: {},
      },
    })),
    "forbidden",
  );
  assertEquals(
    errorCode(reads.contextContaining({
      actor: runtime,
      input: { project: ids.project, path: "a.md" },
    })),
    "forbidden",
  );
  // 다른 machine 자격은 list·get·contract도 못 읽는다.
  for (const actor of [actors.worker, actors.otherMachine]) {
    assertEquals(
      errorCode(reads.contextList({ actor, input: { project: ids.project } })),
      "forbidden",
    );
    assertEquals(
      errorCode(reads.contextGet({ actor, input })),
      "forbidden",
    );
    assertEquals(
      errorCode(reads.contextContract({ actor, input })),
      "forbidden",
    );
  }
});

Deno.test("documents/contexts#R15 [ctx-I56b]: context.contract with a bundle reads that submitted bundle even after it is superseded, and refuses other bundles", () => {
  const { state, t, reads } = setup();
  const first = seedNumbered(state, t, {
    n: 1,
    status: "superseded",
    content: minimalContent({ examples: [] }),
  });
  const current = seedNumbered(state, t, { n: 2, status: "applied" });
  const failed = seedNumbered(state, t, { n: 3, status: "failed" });
  const checking = seedNumbered(state, t, { n: 4, status: "checking" });
  seedContext(state, { status: "active", applied_bundle: current.id });
  const draft = {
    ...current,
    id: ids.spareBundle,
    number: null,
    bundle_hash: null,
    status: "draft" as const,
    parent: current.id,
  };
  state.bundles.set(draft.id, draft);
  state.bundles.set(id("cbn", 60), {
    ...draft,
    id: id("cbn", 60),
    status: "discarded",
  });
  const read = (bundle: string, actor = actors.runtime) =>
    reads.contextContract({ actor, input: { context: ids.context, bundle } });

  // 지금 적용된 판이 아닌 판도 그 판의 id·hash·content다.
  const old = expectOk(read(first.id));
  assertEquals(old.bundle, first.id);
  assertEquals(old.bundle_hash, first.bundle_hash);
  assertEquals(old.content?.examples, []);
  assertEquals(expectOk(read(current.id)).bundle, current.id);
  assertEquals(expectOk(read(failed.id)).bundle_hash, failed.bundle_hash);
  assertEquals(expectOk(read(checking.id, actors.user)).bundle, checking.id);

  // draft, discarded, 없는 판, 다른 context의 판은 없는 것과 같다.
  assertEquals(errorCode(read(draft.id)), "not_found");
  assertEquals(errorCode(read(id("cbn", 60))), "not_found");
  assertEquals(errorCode(read(ids.missingBundle)), "not_found");
  const foreign = seedNumbered(state, t, {
    n: 5,
    status: "applied",
    context: id("ctx", 7),
  });
  seedContext(state, { id: id("ctx", 7), title: "Other" });
  assertEquals(errorCode(read(foreign.id)), "not_found");
  assertEquals(
    errorCode(reads.contextContract({
      actor: actors.runtime,
      input: { context: ids.missingContext, bundle: first.id },
    })),
    "not_found",
  );
});
