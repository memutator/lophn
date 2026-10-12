// context API 읽기의 acceptance 시험이다. 구현 전이라 모두 실패해야 한다(spec 단계).
// 읽기마다 결과의 모양(contract schema)과 순서를 작은 메모리 상태 위에서 본다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { z } from "zod";
import type { SearchRow } from "../../../protocol/projects/mod.ts";
import {
  contextBundlesReadSchema,
  contextContainingReadSchema,
  contextContractReadSchema,
  contextDraftReadSchema,
  contextGetReadSchema,
  contextInputOptionsReadSchema,
  contextListReadSchema,
  contextOverviewReadSchema,
  contextSavedViewsReadSchema,
  contextSearchReadSchema,
  contextViolationsReadSchema,
  glossaryListReadSchema,
} from "../../../protocol/projects/mod.ts";
import { createContextApiCommands } from "./commands.ts";
import {
  type ContextApiReadDeps,
  createContextApiReads,
  type SearchExecutor,
} from "./reads.ts";
import type { ContextApiActor, EntityRow } from "./state.ts";
import {
  actors,
  entity,
  errorCode,
  evalContent,
  expectOk,
  id,
  ids,
  minimalContent,
  newState,
  optionsContent,
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

function row(key: string): SearchRow {
  const ref = {
    type: "Experiment",
    key,
    path: `eval/experiments/exp-${key}-x.md`,
    section: null,
  };
  return {
    ref,
    cells: [
      { path: "key", value: key, ref },
      { path: "status", value: "done", ref: null },
    ],
  };
}

function setup(rows: readonly SearchRow[] = []) {
  const state = newState();
  const t = testDeps();
  const executed: {
    entities: readonly EntityRow[];
    content: Record<string, unknown>;
    search: string;
    inputs: Record<string, unknown>;
  }[] = [];
  const execute: SearchExecutor = (entities, content, search, inputs) => {
    executed.push({ entities, content, search, inputs });
    return rows;
  };
  const deps: ContextApiReadDeps = { execute };
  const reads = createContextApiReads(state, deps);
  return { state, t, reads, executed };
}

// 읽기 결과가 contract의 출력 schema를 지키는지 본다.
function shaped<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  assert(parsed.success, JSON.stringify(parsed.error?.issues));
  return parsed.data;
}

const user = actors.user;

// ---------- context.list ----------

function listFixture() {
  const world = setup();
  const { state, t } = world;
  // 제목은 code unit 순이다: 대문자가 소문자보다 앞선다
  const beta = seedActive(state, t, {
    n: 3,
    slot: 11,
    context: { id: id("ctx", 11), title: "Beta" },
  });
  const alpha = seedContext(state, { id: id("ctx", 12), title: "alpha" });
  const upper = seedContext(state, { id: id("ctx", 13), title: "Alpha" });
  const archived = seedContext(state, {
    id: id("ctx", 14),
    title: "Old",
    status: "archived",
  });
  const elsewhere = seedContext(state, {
    id: id("ctx", 15),
    title: "Elsewhere",
    project: ids.otherProject,
  });
  return { ...world, beta, alpha, upper, archived, elsewhere };
}

Deno.test("documents/contexts#R1 [ctx-I31]: context.list shows the project's unarchived contexts by title in code unit order", () => {
  const { reads, beta, alpha, upper } = listFixture();
  const page = shaped(
    contextListReadSchema,
    expectOk(
      reads.contextList({ actor: user, input: { project: ids.project } }),
    ),
  );
  assertEquals(page.contexts.map((item) => item.id), [
    upper.id,
    beta.context.id,
    alpha.id,
  ]);
  assertEquals(page.complete, true);
  assertEquals(page.next_cursor, null);
  const item = page.contexts.find((entry) => entry.id === beta.context.id)!;
  assertEquals(item.applied_number, 3);
  assertEquals(item.applied_bundle, beta.bundle.id);
  assertEquals(item.status, "active");
  assertEquals(item.draft_bundle, null);
  assertEquals(item.checking_bundle, null);
});

Deno.test("documents/contexts#R1 [ctx-I31]: context.list shows the open draft and the checking bundle of each context", () => {
  const { state, t, reads, alpha } = listFixture();
  const draft = seedBundle(state, { id: ids.spareBundle, context: alpha.id });
  const checking = seedNumbered(state, t, {
    n: 1,
    slot: 60,
    status: "checking",
    context: alpha.id,
  });
  const page = shaped(
    contextListReadSchema,
    expectOk(
      reads.contextList({ actor: user, input: { project: ids.project } }),
    ),
  );
  const item = page.contexts.find((entry) => entry.id === alpha.id)!;
  assertEquals(item.draft_bundle, draft.id);
  assertEquals(item.checking_bundle, checking.id);
  assertEquals(item.applied_number, null);
});

Deno.test("documents/contexts#R4 [ctx-I31]: context.list filters by status and all includes the archived", () => {
  const { reads, beta, alpha, upper, archived } = listFixture();
  const list = (status: "drafting" | "active" | "archived" | "all") =>
    shaped(
      contextListReadSchema,
      expectOk(
        reads.contextList({
          actor: user,
          input: { project: ids.project, status },
        }),
      ),
    ).contexts.map((item) => item.id);
  assertEquals(list("drafting"), [upper.id, alpha.id]);
  assertEquals(list("active"), [beta.context.id]);
  assertEquals(list("archived"), [archived.id]);
  assertEquals(list("all"), [upper.id, beta.context.id, alpha.id, archived.id]);
});

Deno.test("documents/contexts#R17 [ctx-I31]: context.list pages by limit and cursor without gaps or repeats", () => {
  const { reads, beta, alpha, upper } = listFixture();
  const first = shaped(
    contextListReadSchema,
    expectOk(
      reads.contextList({
        actor: user,
        input: { project: ids.project, limit: 2 },
      }),
    ),
  );
  assertEquals(first.contexts.map((item) => item.id), [
    upper.id,
    beta.context.id,
  ]);
  assertEquals(first.complete, false);
  assert(first.next_cursor !== null);
  const second = shaped(
    contextListReadSchema,
    expectOk(
      reads.contextList({
        actor: user,
        input: {
          project: ids.project,
          limit: 2,
          cursor: first.next_cursor,
        },
      }),
    ),
  );
  assertEquals(second.contexts.map((item) => item.id), [alpha.id]);
  assertEquals(second.complete, true);
  assertEquals(second.next_cursor, null);
  assertEquals(
    errorCode(reads.contextList({
      actor: user,
      input: { project: ids.project, cursor: "not-a-cursor" },
    })),
    "invalid_input",
  );
});

Deno.test("documents/contexts#R1 [ctx-I31]: context.list rejects an unknown project and callers outside user and lophn agents", () => {
  const { reads } = listFixture();
  assertEquals(
    errorCode(reads.contextList({
      actor: user,
      input: { project: id("prj", 99) },
    })),
    "not_found",
  );
  for (
    const actor of [actors.codingAgent, actors.worker, actors.otherMachine]
  ) {
    assertEquals(
      errorCode(
        reads.contextList({ actor, input: { project: ids.project } }),
      ),
      "forbidden",
      actor.actor,
    );
  }
  // Operator 같은 다른 lophn agent도 읽을 수 있다
  expectOk(
    reads.contextList({
      actor: actors.otherAgent,
      input: { project: ids.project },
    }),
  );
});

// ---------- context.get ----------

Deno.test("documents/contexts#R19 [ctx-I31]: context.get returns the context with its applied bundle summary and null when none is applied", () => {
  const { state, t, reads } = setup();
  const { context, bundle } = seedActive(state, t);
  const got = shaped(
    contextGetReadSchema,
    expectOk(reads.contextGet({ actor: user, input: { context: context.id } })),
  );
  assertEquals(got.context, context);
  assertEquals(got.applied, summaryOf(bundle));
  assertEquals(got.next_cursor, null);
  seedContext(state, { id: ids.otherContext, title: "Drafts" });
  const drafting = shaped(
    contextGetReadSchema,
    expectOk(
      reads.contextGet({ actor: user, input: { context: ids.otherContext } }),
    ),
  );
  assertEquals(drafting.applied, null);
  assertEquals(drafting.context.status, "drafting");
});

Deno.test("documents/contexts#R4 [ctx-I31]: context.get still shows an archived context and rejects an unknown one and a coding agent", () => {
  const { state, reads } = setup();
  seedContext(state, { status: "archived" });
  assertEquals(
    expectOk(reads.contextGet({ actor: user, input: { context: ids.context } }))
      .context.status,
    "archived",
  );
  assertEquals(
    errorCode(
      reads.contextGet({ actor: user, input: { context: ids.missingContext } }),
    ),
    "not_found",
  );
  assertEquals(
    errorCode(
      reads.contextGet({
        actor: actors.codingAgent,
        input: { context: ids.context },
      }),
    ),
    "forbidden",
  );
});

// ---------- context.overview ----------

Deno.test("documents/contexts#R23 [ctx-I31]: context.overview counts entities per type in the contract's type order and the violations", () => {
  const { state, t, reads } = setup();
  const { context, bundle } = seedActive(state, t, { content: evalContent() });
  state.entities.set(context.id, [
    entity("Scenario", "schedule-basic"),
    entity("Experiment", "001"),
    entity("Experiment", "002"),
    entity("Finding", "001"),
    entity("Experiment", "003"),
  ]);
  seedViolations(state, [
    violation(),
    violation({ path: "eval/experiments/exp-005.md" }),
  ]);
  const overview = shaped(
    contextOverviewReadSchema,
    expectOk(
      reads.contextOverview({ actor: user, input: { context: context.id } }),
    ),
  );
  assertEquals(overview.context, context);
  assertEquals(overview.bundle_hash, bundle.bundle_hash);
  // 계약의 type 순서: Experiment, Scenario, Finding, ... 개체가 없는 type은 0이다
  assertEquals(overview.types, [
    { type: "Experiment", count: 3 },
    { type: "Scenario", count: 1 },
    { type: "Finding", count: 1 },
    { type: "Decision", count: 0 },
    { type: "Guide", count: 0 },
    { type: "GuideHeading", count: 0 },
    { type: "Event", count: 0 },
  ]);
  assertEquals(overview.violation_count, 2);
});

Deno.test("documents/contexts#R23 [ctx-I31]: context.overview of a context without an applied bundle is empty and an index failure is unavailable", () => {
  const { state, t, reads } = setup();
  seedContext(state, { id: ids.otherContext, title: "Drafts" });
  const empty = shaped(
    contextOverviewReadSchema,
    expectOk(
      reads.contextOverview({
        actor: user,
        input: { context: ids.otherContext },
      }),
    ),
  );
  assertEquals(empty.bundle_hash, null);
  assertEquals(empty.types, []);
  assertEquals(empty.violation_count, 0);
  const { context } = seedActive(state, t);
  state.indexFailing.add(context.id);
  assertEquals(
    errorCode(
      reads.contextOverview({ actor: user, input: { context: context.id } }),
    ),
    "unavailable",
  );
  assertEquals(
    errorCode(
      reads.contextOverview({
        actor: user,
        input: { context: ids.missingContext },
      }),
    ),
    "not_found",
  );
});

// ---------- context.search ----------

const manyRows = ["001", "002", "003", "004", "005"].map(row);

function searchFixture(rows: readonly SearchRow[] = manyRows) {
  const world = setup(rows);
  const { state, t } = world;
  const { context, bundle } = seedActive(state, t);
  state.entities.set(context.id, [entity("Experiment", "001")]);
  seedContext(state, {
    id: ids.otherContext,
    title: "Other",
    status: "active",
    applied_bundle: null,
  });
  state.entities.set(ids.otherContext, [entity("Experiment", "other")]);
  const search = (
    input: Record<string, unknown>,
    actor: ContextApiActor = user,
  ) =>
    world.reads.contextSearch({
      actor,
      input: {
        context: context.id,
        search: "experiment_by_key",
        inputs: { experiment: "001" },
        ...input,
      },
    });
  return { ...world, context, bundle, search };
}

Deno.test("documents/contexts#R16 [ctx-I31]: context.search runs the declared search of the applied bundle over this context's entities", () => {
  const { search, executed, context, bundle, state } = searchFixture();
  const page = shaped(contextSearchReadSchema, expectOk(search({})));
  assertEquals(page.context, context.id);
  assertEquals(page.search, "experiment_by_key");
  assertEquals(page.bundle_hash, bundle.bundle_hash);
  assertEquals(executed.length, 1);
  assertEquals(executed[0].entities, state.entities.get(context.id));
  assertEquals(executed[0].content, bundle.content);
  assertEquals(executed[0].search, "experiment_by_key");
  assertEquals(executed[0].inputs, { experiment: "001" });
});

Deno.test("documents/contexts#R17 [ctx-I31]: context.search pages by the declared page_size and the cursor continues the same result", () => {
  const { search } = searchFixture();
  // experiment_by_key는 page_size 2를 선언한다
  const first = shaped(contextSearchReadSchema, expectOk(search({})));
  assertEquals(first.rows.map((entry) => entry.ref.key), ["001", "002"]);
  assertEquals(first.complete, false);
  assert(first.next_cursor !== null);
  const second = shaped(
    contextSearchReadSchema,
    expectOk(search({ cursor: first.next_cursor })),
  );
  assertEquals(second.rows.map((entry) => entry.ref.key), ["003", "004"]);
  assert(second.next_cursor !== null);
  const third = shaped(
    contextSearchReadSchema,
    expectOk(search({ cursor: second.next_cursor })),
  );
  assertEquals(third.rows.map((entry) => entry.ref.key), ["005"]);
  assertEquals(third.complete, true);
  assertEquals(third.next_cursor, null);
  const all = [...first.rows, ...second.rows, ...third.rows];
  assertEquals(all, manyRows);
});

Deno.test("documents/contexts#R17 [ctx-I31]: a page_size on the call replaces the declared one and an empty result is one complete page", () => {
  const { search } = searchFixture();
  const big = shaped(
    contextSearchReadSchema,
    expectOk(search({ page_size: 5 })),
  );
  assertEquals(big.rows.length, 5);
  assertEquals(big.complete, true);
  const small = shaped(
    contextSearchReadSchema,
    expectOk(search({ page_size: 1 })),
  );
  assertEquals(small.rows.map((entry) => entry.ref.key), ["001"]);
  assertEquals(small.complete, false);
  const none = setup([]);
  const active = seedActive(none.state, none.t);
  const page = shaped(
    contextSearchReadSchema,
    expectOk(none.reads.contextSearch({
      actor: user,
      input: {
        context: active.context.id,
        search: "experiments_by_status",
        inputs: {},
      },
    })),
  );
  assertEquals(page.rows, []);
  assertEquals(page.complete, true);
  assertEquals(page.next_cursor, null);
});

Deno.test("documents/contexts#R17 [ctx-I31]: the same call twice gives the same result and the same cursor", () => {
  const { search } = searchFixture();
  const first = expectOk(search({}));
  const again = expectOk(search({}));
  assertEquals(again, first);
  const withCursor = expectOk(search({ cursor: first.next_cursor! }));
  assertEquals(expectOk(search({ cursor: first.next_cursor! })), withCursor);
});

Deno.test("documents/contexts#R15 [ctx-I31]: context.search rejects inputs the declaration does not take", () => {
  const { search, executed } = searchFixture();
  // 선언에 없는 검색, 선언에 없는 입력, 빠진 필수 입력, 타입이 다른 입력
  assertEquals(
    errorCode(search({ search: "no_such_search" })),
    "invalid_input",
  );
  assertEquals(
    errorCode(search({ inputs: { experiment: "001", unknown: 1 } })),
    "invalid_input",
  );
  assertEquals(errorCode(search({ inputs: {} })), "invalid_input");
  assertEquals(
    errorCode(search({ inputs: { experiment: ["001"] } })),
    "invalid_input",
  );
  assertEquals(
    errorCode(search({ inputs: { experiment: 1 } })),
    "invalid_input",
  );
  assertEquals(
    errorCode(search({ inputs: { experiment: "001", note: 5 } })),
    "invalid_input",
  );
  assertEquals(
    errorCode(search({
      search: "experiments_by_status",
      inputs: { status: "running" },
    })),
    "invalid_input",
  );
  assertEquals(executed.length, 0);
  expectOk(search({ inputs: { experiment: "001", note: "free text" } }));
  expectOk(search({
    search: "experiments_by_status",
    inputs: { status: ["running", "done"] },
  }));
});

Deno.test("documents/contexts#R17 [ctx-I31]: a cursor is rejected for another search or inputs and after the applied bundle changed", () => {
  const { search, state, t, context } = searchFixture();
  const first = expectOk(search({}));
  const cursor = first.next_cursor!;
  assertEquals(errorCode(search({ cursor: "garbage" })), "invalid_input");
  assertEquals(
    errorCode(search({ cursor, inputs: { experiment: "002" } })),
    "invalid_input",
  );
  assertEquals(
    errorCode(search({ cursor, search: "experiments_by_status", inputs: {} })),
    "invalid_input",
  );
  // 판이 바뀐 뒤 옛 cursor는 이어 볼 수 없다
  const next = seedNumbered(state, t, {
    n: 2,
    slot: 70,
    status: "applied",
    parent: context.applied_bundle,
    content: minimalContent({ examples: [] }),
  });
  state.bundles.get(context.applied_bundle!)!.status = "superseded";
  state.contexts.set(context.id, { ...context, applied_bundle: next.id });
  assertEquals(errorCode(search({ cursor })), "conflict");
});

Deno.test("documents/contexts#R4 [ctx-I31]: context.search is closed for an archived context, a drafting one and an unknown one", () => {
  const { state, t, reads } = setup(manyRows);
  const { context } = seedActive(state, t);
  const call = (contextId: string, actor: ContextApiActor = user) =>
    reads.contextSearch({
      actor,
      input: {
        context: contextId,
        search: "experiments_by_status",
        inputs: {},
      },
    });
  expectOk(call(context.id));
  seedContext(state, { id: ids.otherContext, title: "Drafts" });
  assertEquals(errorCode(call(ids.otherContext)), "not_found");
  state.contexts.set(context.id, { ...context, status: "archived" });
  assertEquals(errorCode(call(context.id)), "not_found");
  assertEquals(errorCode(call(ids.missingContext)), "not_found");
  state.contexts.set(context.id, context);
  assertEquals(errorCode(call(context.id, actors.codingAgent)), "forbidden");
  state.indexFailing.add(context.id);
  assertEquals(errorCode(call(context.id)), "unavailable");
});

// ---------- context.violations ----------

Deno.test("documents/contexts#R24 [ctx-I31]: context.violations lists this context's violations in path, kind, rule, section order with their messages", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  const rows = [
    violation({
      path: "eval/experiments/exp-010.md",
      rule: "Experiment.status-known",
    }),
    violation({
      kind: "unreadable",
      rule: null,
      path: "eval/experiments/exp-005.md",
      message: "File could not be read",
    }),
    violation({
      path: "eval/experiments/exp-005.md",
      rule: "Experiment.status-required",
    }),
    violation({
      kind: "broken_link",
      rule: null,
      type: "Guide",
      path: "docs/README.md",
      target: "docs/gone.md",
      message: "Link target is missing",
    }),
    violation({
      path: "eval/experiments/exp-005.md",
      rule: "Experiment.status-known",
    }),
  ];
  seedViolations(state, rows);
  seedViolations(
    state,
    [violation({ context: ids.otherContext })],
    ids.otherContext,
  );
  const page = shaped(
    contextViolationsReadSchema,
    expectOk(
      reads.contextViolations({ actor: user, input: { context: context.id } }),
    ),
  );
  assertEquals(page.context, context.id);
  assertEquals(
    page.violations.map((item) => [item.path, item.kind, item.rule]),
    [
      ["docs/README.md", "broken_link", null],
      ["eval/experiments/exp-005.md", "rule", "Experiment.status-known"],
      ["eval/experiments/exp-005.md", "rule", "Experiment.status-required"],
      ["eval/experiments/exp-005.md", "unreadable", null],
      ["eval/experiments/exp-010.md", "rule", "Experiment.status-known"],
    ],
  );
  assert(page.violations.every((item) => item.message.length > 0));
  assert(page.violations.every((item) => item.context === context.id));
});

Deno.test("documents/contexts#R24 [ctx-I31]: context.violations pages in order and a context with none is an empty complete page", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  seedViolations(
    state,
    ["c", "a", "b"].map((name) => violation({ path: `docs/${name}.md` })),
  );
  const first = expectOk(
    reads.contextViolations({
      actor: user,
      input: { context: context.id, limit: 2 },
    }),
  );
  assertEquals(first.violations.map((item) => item.path), [
    "docs/a.md",
    "docs/b.md",
  ]);
  assertEquals(first.complete, false);
  const second = expectOk(
    reads.contextViolations({
      actor: user,
      input: { context: context.id, limit: 2, cursor: first.next_cursor! },
    }),
  );
  assertEquals(second.violations.map((item) => item.path), ["docs/c.md"]);
  assertEquals(second.complete, true);
  seedViolations(state, []);
  const none = shaped(
    contextViolationsReadSchema,
    expectOk(
      reads.contextViolations({ actor: user, input: { context: context.id } }),
    ),
  );
  assertEquals(none.violations, []);
  assertEquals(none.complete, true);
  assertEquals(
    errorCode(
      reads.contextViolations({
        actor: user,
        input: { context: ids.missingContext },
      }),
    ),
    "not_found",
  );
  assertEquals(
    errorCode(
      reads.contextViolations({
        actor: actors.codingAgent,
        input: { context: context.id },
      }),
    ),
    "forbidden",
  );
});

// ---------- context.bundles ----------

Deno.test("documents/contexts#R19 [ctx-I31]: context.bundles lists the draft first and then numbers from newest, each with its check report", () => {
  const { state, t, reads } = setup();
  seedContext(state, { status: "active", applied_bundle: id("cbn", 3) });
  seedNumbered(state, t, { n: 1, status: "superseded" });
  seedNumbered(state, t, { n: 2, status: "failed", parent: id("cbn", 1) });
  const applied = seedNumbered(state, t, {
    n: 3,
    status: "applied",
    parent: id("cbn", 1),
  });
  const draft = seedBundle(state, { id: ids.spareBundle, parent: applied.id });
  seedNumbered(state, t, {
    n: 1,
    slot: 80,
    status: "applied",
    context: ids.otherContext,
  });
  const page = shaped(
    contextBundlesReadSchema,
    expectOk(
      reads.contextBundles({ actor: user, input: { context: ids.context } }),
    ),
  );
  assertEquals(
    page.bundles.map((item) => [item.bundle.id, item.bundle.number]),
    [
      [draft.id, null],
      [id("cbn", 3), 3],
      [id("cbn", 2), 2],
      [id("cbn", 1), 1],
    ],
  );
  assertEquals(page.bundles[0].check, null);
  assertEquals(page.bundles[1].check, state.checks.get(applied.check!));
  assertEquals(page.bundles[2].check!.status, "failed");
  assertEquals(page.bundles[2].check!.findings.length, 1);
  // 내용(content)은 싣지 않는다
  assert(page.bundles.every((item) => !("content" in item.bundle)));
});

Deno.test("documents/contexts#R19 [ctx-I31]: context.bundles pages and rejects an unknown context", () => {
  const { state, t, reads } = setup();
  seedContext(state);
  for (let n = 1; n <= 3; n++) {
    seedNumbered(state, t, { n, status: "superseded" });
  }
  const first = expectOk(
    reads.contextBundles({
      actor: user,
      input: { context: ids.context, limit: 2 },
    }),
  );
  assertEquals(first.bundles.map((item) => item.bundle.number), [3, 2]);
  assertEquals(first.complete, false);
  const second = expectOk(
    reads.contextBundles({
      actor: user,
      input: { context: ids.context, limit: 2, cursor: first.next_cursor! },
    }),
  );
  assertEquals(second.bundles.map((item) => item.bundle.number), [1]);
  assertEquals(second.complete, true);
  assertEquals(
    errorCode(
      reads.contextBundles({
        actor: user,
        input: { context: ids.missingContext },
      }),
    ),
    "not_found",
  );
});

// ---------- context.saved_views ----------

Deno.test("documents/contexts#R18 [ctx-I31]: context.saved_views lists the context's views by name and marks a call the applied bundle can no longer run", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  seedView(state, { id: id("viw", 3), name: "b view" });
  seedView(state, { id: id("viw", 2), name: "B view" });
  seedView(state, {
    id: id("viw", 4),
    name: "Gone search",
    search: "removed_search",
    inputs: {},
  });
  seedView(state, {
    id: id("viw", 5),
    name: "Bad inputs",
    inputs: { unknown: 1 },
  });
  seedView(state, {
    id: id("viw", 6),
    name: "Other context",
    context: ids.otherContext,
  });
  const page = shaped(
    contextSavedViewsReadSchema,
    expectOk(
      reads.contextSavedViews({ actor: user, input: { context: context.id } }),
    ),
  );
  assertEquals(page.context, context.id);
  assertEquals(page.views.map((view) => [view.name, view.broken]), [
    ["B view", false],
    ["Bad inputs", true],
    ["Gone search", true],
    ["b view", false],
  ]);
  assertEquals(page.next_cursor, null);
  // 깨졌어도 지우지 않는다
  assertEquals(state.views.size, 5);
  assertEquals(
    errorCode(
      reads.contextSavedViews({
        actor: user,
        input: { context: ids.missingContext },
      }),
    ),
    "not_found",
  );
});

// ---------- context.containing ----------

function containingFixture() {
  const world = setup();
  const { state, t } = world;
  const evalCtx = seedActive(state, t, {
    slot: 21,
    context: { id: id("ctx", 21), title: "Eval" },
    content: evalContent(),
  });
  const mini = seedActive(state, t, {
    slot: 22,
    context: { id: id("ctx", 22), title: "Mini" },
  });
  seedActive(state, t, {
    slot: 23,
    context: { id: id("ctx", 23), title: "Old", status: "archived" },
    content: evalContent(),
  });
  seedContext(state, { id: id("ctx", 24), title: "Drafts" });
  seedActive(state, t, {
    slot: 25,
    context: {
      id: id("ctx", 25),
      title: "Elsewhere",
      project: ids.otherProject,
    },
    content: evalContent(),
  });
  return { ...world, evalCtx, mini };
}

Deno.test("documents/contexts#R23 [ctx-I31]: context.containing lists active contexts whose contract covers the file with the covering types", () => {
  const { reads, evalCtx, mini } = containingFixture();
  const containing = (path: string) =>
    shaped(
      contextContainingReadSchema,
      expectOk(
        reads.contextContaining({
          actor: user,
          input: { project: ids.project, path },
        }),
      ),
    ).contexts;
  // series pattern: 두 context가 같은 파일을 덮고 제목 순으로 나온다
  assertEquals(containing("eval/experiments/exp-001-plan.md"), [
    { context: evalCtx.context.id, title: "Eval", types: ["Experiment"] },
    { context: mini.context.id, title: "Mini", types: ["Experiment"] },
  ]);
  // docs, section, index
  assertEquals(
    containing("eval/scenarios/schedule-basic.md").map((item) => item.types),
    [["Scenario"]],
  );
  assertEquals(containing("docs/decisions.md").map((item) => item.types), [[
    "Decision",
  ]]);
  assertEquals(containing("docs/README.md").map((item) => item.types), [[
    "Guide",
  ]]);
  // 계약 밖의 파일은 어느 context에도 속하지 않는다
  assertEquals(containing("notes/todo.md"), []);
  assertEquals(containing("eval/experiments/notes.md"), []);
});

Deno.test("documents/contexts#R4 [ctx-I31]: context.containing leaves out archived, drafting and other projects' contexts and rejects an unknown project", () => {
  const { reads } = containingFixture();
  const result = expectOk(
    reads.contextContaining({
      actor: user,
      input: { project: ids.project, path: "eval/scenarios/schedule-basic.md" },
    }),
  );
  assertEquals(result.contexts.map((item) => item.title), ["Eval"]);
  const elsewhere = expectOk(
    reads.contextContaining({
      actor: user,
      input: {
        project: ids.otherProject,
        path: "eval/scenarios/schedule-basic.md",
      },
    }),
  );
  assertEquals(elsewhere.contexts.map((item) => item.title), ["Elsewhere"]);
  assertEquals(
    errorCode(reads.contextContaining({
      actor: user,
      input: { project: id("prj", 99), path: "a.md" },
    })),
    "not_found",
  );
  assertEquals(
    errorCode(reads.contextContaining({
      actor: actors.codingAgent,
      input: { project: ids.project, path: "a.md" },
    })),
    "forbidden",
  );
});

Deno.test("documents/contexts#R23 [ctx-T10b]: context.containing counts a path covered through from_type, follows a chain of from_type and ignores a cycle", () => {
  const { state, reads, t } = setup();
  const content = evalContent() as {
    contract: { types: Record<string, unknown>[] };
  };
  const heading = (name: string, from_type: string) => ({
    name,
    summary: "A heading inside a document",
    visibility: "private",
    source: {
      kind: "outline",
      from_type,
      format: "markdown",
      min_level: 1,
      max_level: 3,
    },
    key: "title",
    fields: [{
      name: "title",
      from: { kind: "title" },
      value_type: "string",
      required: false,
      visibility: "private",
    }],
    relations: [],
    rules: [],
  });
  content.contract.types.push(
    heading("ScenarioHeading", "Scenario"),
    heading("ScenarioSubheading", "ScenarioHeading"),
    heading("LoopA", "LoopB"),
    heading("LoopB", "LoopA"),
  );
  seedActive(state, t, {
    slot: 31,
    context: { id: id("ctx", 31), title: "Eval" },
    content,
  });
  const typesOf = (path: string) =>
    expectOk(
      reads.contextContaining({
        actor: user,
        input: { project: ids.project, path },
      }),
    ).contexts.flatMap((item) => item.types);
  // docs 문서를 따라가는 outline과 그 outline을 따라가는 outline도 덮는다
  assertEquals(typesOf("eval/scenarios/schedule-basic.md"), [
    "Scenario",
    "ScenarioHeading",
    "ScenarioSubheading",
  ]);
  // index 개체의 문서는 계약만으로 알 수 없어 index 문서 자신만 덮는다
  assertEquals(typesOf("docs/README.md"), ["Guide"]);
  assertEquals(typesOf("docs/other.md"), []);
});

// ---------- glossary.list ----------

Deno.test("documents/terms#R10 [ctx-I31]: glossary.list reads every entry of one context in lowercase byte order of the term then id", () => {
  const { state, reads } = setup();
  seedContext(state);
  seedEntry(state, { id: id("trm", 4), term: "run" });
  seedEntry(state, { id: id("trm", 3), term: "Run" });
  seedEntry(state, { id: id("trm", 2), term: "arm" });
  seedEntry(state, { id: id("trm", 5), term: "Zeta" });
  // ASCII만 접는다: 비ASCII 글자는 byte 순으로 ASCII 뒤에 온다
  seedEntry(state, { id: id("trm", 6), term: "Élan" });
  seedEntry(state, {
    id: id("trm", 7),
    term: "other context",
    context: ids.otherContext,
  });
  const page = shaped(
    glossaryListReadSchema,
    expectOk(
      reads.glossaryList({ actor: user, input: { context: ids.context } }),
    ),
  );
  assertEquals(page.context, ids.context);
  assertEquals(page.entries.map((entry) => entry.id), [
    id("trm", 2),
    id("trm", 3),
    id("trm", 4),
    id("trm", 5),
    id("trm", 6),
  ]);
  assertEquals(page.next_cursor, null);
});

Deno.test("documents/terms#R10 [ctx-I31]: the same glossary read twice gives the same entries and a new term takes its place in the order", () => {
  const { state, reads } = setup();
  seedContext(state);
  seedEntry(state, { id: id("trm", 2), term: "arm" });
  seedEntry(state, { id: id("trm", 3), term: "zeta" });
  const read = () =>
    expectOk(
      reads.glossaryList({ actor: user, input: { context: ids.context } }),
    );
  const first = read();
  assertEquals(read(), first);
  seedEntry(state, { id: id("trm", 4), term: "mid" });
  assertEquals(read().entries.map((entry) => entry.term), [
    "arm",
    "mid",
    "zeta",
  ]);
  assertNotEquals(read(), first);
});

Deno.test("documents/terms#R9 [ctx-I31]: glossary.list still reads an archived context and rejects an unknown context, a coding agent and a machine", () => {
  const { state, reads } = setup();
  seedContext(state, { status: "archived" });
  const entry = seedEntry(state);
  assertEquals(
    expectOk(
      reads.glossaryList({ actor: user, input: { context: ids.context } }),
    ).entries,
    [entry],
  );
  // Context Engineer와 다른 lophn agent는 prompt 자료로 읽는다
  expectOk(
    reads.glossaryList({
      actor: actors.otherAgent,
      input: { context: ids.context },
    }),
  );
  assertEquals(
    errorCode(
      reads.glossaryList({
        actor: user,
        input: { context: ids.missingContext },
      }),
    ),
    "not_found",
  );
  for (const actor of [actors.codingAgent, actors.worker]) {
    assertEquals(
      errorCode(reads.glossaryList({ actor, input: { context: ids.context } })),
      "forbidden",
      actor.actor,
    );
  }
});

// ---------- ctx-S26: 화면이 읽는 것 ----------

Deno.test("documents/contexts#R17 [ctx-S26]: context.search reports the total of all rows on every page", () => {
  const { search } = searchFixture();
  const first = shaped(contextSearchReadSchema, expectOk(search({})));
  assertEquals(first.rows.length, 2);
  assertEquals(first.total, 5);
  const second = shaped(
    contextSearchReadSchema,
    expectOk(search({ cursor: first.next_cursor! })),
  );
  assertEquals(second.total, 5);
  const last = shaped(
    contextSearchReadSchema,
    expectOk(search({ cursor: second.next_cursor! })),
  );
  assertEquals(last.rows.length, 1);
  assertEquals(last.total, 5);
  assertEquals(
    shaped(contextSearchReadSchema, expectOk(search({ page_size: 5 })))
      .total,
    5,
  );
  assertEquals(expectOk(search({ page_size: 1 })).total, 5);
  const none = searchFixture([]);
  const page = shaped(contextSearchReadSchema, expectOk(none.search({})));
  assertEquals(page.total, 0);
  assertEquals(page.rows, []);
});

Deno.test("documents/contexts#R16 [ctx-S26]: context.search rows keep the runner's ref and cells, so an alias column links to its own entity", () => {
  const ref = {
    type: "Experiment",
    key: "001",
    path: "eval/experiments/exp-001-plan.md",
    section: null,
  };
  const scenario = {
    type: "Scenario",
    key: "query-leave-still",
    path: "eval/scenarios/query-leave-still/r1.yaml",
    section: null,
  };
  const finding = {
    type: "Finding",
    key: "F-009",
    path: "loop/findings/F-009.md",
    section: "Effect",
  };
  const rows: SearchRow[] = [{
    ref,
    cells: [
      { path: "key", value: "001", ref },
      { path: "scenario.key", value: scenario.key, ref: scenario },
      { path: "scenario.path", value: scenario.path, ref: null },
      { path: "status", value: "done", ref: null },
      { path: "tags", value: ["a", "b"], ref: null },
      { path: "round", value: null, ref: null },
    ],
  }, {
    ref: finding,
    cells: [{ path: "key", value: "F-009", ref: finding }],
  }];
  const { search } = searchFixture(rows);
  const page = shaped(contextSearchReadSchema, expectOk(search({})));
  assertEquals(page.rows, rows);
  assertEquals(page.total, 2);
  assertEquals(page.rows[0].cells[1].ref, scenario);
  assertEquals(page.rows[1].ref.section, "Effect");
});

Deno.test("documents/contexts#R16 [ctx-S26]: a board search carries refs and the total too", () => {
  const { search } = searchFixture(manyRows);
  const board = shaped(
    contextSearchReadSchema,
    expectOk(search({
      search: "experiments_by_status",
      inputs: { status: ["done"] },
    })),
  );
  assertEquals(board.total, 5);
  assertEquals(board.rows.map((entry) => entry.ref.key), [
    "001",
    "002",
    "003",
    "004",
    "005",
  ]);
  assert(board.rows.every((entry) => entry.ref.type === "Experiment"));
  assert(board.rows.every((entry) => entry.cells[0].ref !== null));
});

// ---------- context.contract ----------

Deno.test("documents/contexts#R15 [ctx-S26]: context.contract returns the content of the applied bundle with its hash", () => {
  const { state, t, reads } = setup();
  const content = evalContent() as {
    contract: unknown;
    saved_views: unknown[];
    examples: unknown[];
  };
  const { context, bundle } = seedActive(state, t, { content });
  // 적용되지 않은 판은 보이지 않는다
  seedBundle(state, {
    id: ids.spareBundle,
    parent: bundle.id,
    content: minimalContent(),
  });
  const read = shaped(
    contextContractReadSchema,
    expectOk(
      reads.contextContract({ actor: user, input: { context: context.id } }),
    ),
  );
  assertEquals(read.context, context.id);
  assertEquals(read.bundle, bundle.id);
  assertEquals(read.bundle_hash, bundle.bundle_hash);
  assertEquals(read.content?.contract, content.contract);
  assertEquals(read.content?.searches.map((entry) => entry.name), [
    "findings_for_experiment",
    "experiments_by_status",
    "experiments_on_scenario",
  ]);
  assertEquals(read.content?.saved_views.length, content.saved_views.length);
  assertEquals(read.content?.examples.length, content.examples.length);
  assertEquals(read.as_of_seq, String(state.seq));
  assertEquals(read.next_cursor, null);
});

Deno.test("documents/contexts#R15 [ctx-S26]: context.contract is null for a context with no applied bundle and follows a rollback", () => {
  const { state, reads } = setup();
  const drafting = seedContext(state);
  seedBundle(state);
  const none = shaped(
    contextContractReadSchema,
    expectOk(
      reads.contextContract({ actor: user, input: { context: drafting.id } }),
    ),
  );
  assertEquals(none.bundle, null);
  assertEquals(none.bundle_hash, null);
  assertEquals(none.content, null);

  const second = setup();
  const first = seedNumbered(second.state, second.t, {
    n: 1,
    status: "superseded",
  });
  const current = seedNumbered(second.state, second.t, {
    n: 2,
    status: "applied",
    content: minimalContent({ examples: [] }),
  });
  seedContext(second.state, { status: "active", applied_bundle: first.id });
  const call = () =>
    expectOk(second.reads.contextContract({
      actor: user,
      input: { context: ids.context },
    }));
  assertEquals(call().bundle, first.id);
  second.state.contexts.set(ids.context, {
    ...second.state.contexts.get(ids.context)!,
    applied_bundle: current.id,
  });
  assertEquals(call().bundle, current.id);
});

Deno.test("documents/contexts#R15 [ctx-S26]: context.contract still reads an archived context and rejects missing contexts and other actors", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  state.contexts.set(context.id, { ...context, status: "archived" });
  const read = expectOk(
    reads.contextContract({ actor: user, input: { context: context.id } }),
  );
  assert(read.content !== null);
  expectOk(reads.contextContract({
    actor: actors.otherAgent,
    input: { context: context.id },
  }));
  assertEquals(
    errorCode(reads.contextContract({
      actor: user,
      input: { context: ids.missingContext },
    })),
    "not_found",
  );
  for (const actor of [actors.codingAgent, actors.worker]) {
    assertEquals(
      errorCode(
        reads.contextContract({ actor, input: { context: context.id } }),
      ),
      "forbidden",
      actor.actor,
    );
  }
});

// ---------- context.draft ----------

function draftOf(
  reads: ReturnType<typeof setup>["reads"],
  context: string = ids.context,
) {
  return shaped(
    contextDraftReadSchema,
    expectOk(reads.contextDraft({ actor: user, input: { context } })),
  ).draft;
}

Deno.test("documents/contexts#R19 [ctx-S26]: context.draft is step 1 with nothing yet while a drafting context has no bundle", () => {
  const { state, reads } = setup();
  seedContext(state);
  assertEquals(draftOf(reads), {
    step: 1,
    bundle: null,
    content: null,
    check: null,
  });
  // 버린 draft는 진행이 아니다
  seedBundle(state, { status: "discarded" });
  assertEquals(draftOf(reads)?.step, 1);
});

Deno.test("documents/contexts#R19 [ctx-S26]: context.draft is step 2 with the draft bundle and its content", () => {
  const { state, reads } = setup();
  seedContext(state);
  const content = { schema: 1, contract: { types: [] }, note: "unfinished" };
  const bundle = seedBundle(state, { content });
  assertEquals(draftOf(reads), {
    step: 2,
    bundle: summaryOf(bundle),
    content,
    check: null,
  });
  // 검사에서 떨어진 판이 있어도 지금의 draft가 먼저다
  const t = testDeps();
  seedNumbered(state, t, {
    n: 1,
    slot: 7,
    status: "failed",
    content: minimalContent(),
  });
  const read = draftOf(reads)!;
  assertEquals(read.step, 2);
  assertEquals(read.bundle, summaryOf(bundle));
  assertEquals(read.content, content);
  assertEquals(read.check, null);
});

Deno.test("documents/contexts#R19 [ctx-S26]: context.draft is step 3 with the checking bundle and its running check", () => {
  const { state, t, reads } = setup();
  seedContext(state);
  const bundle = seedNumbered(state, t, { n: 1, status: "checking" });
  const read = draftOf(reads)!;
  assertEquals(read.step, 3);
  assertEquals(read.bundle, summaryOf(bundle));
  assertEquals(read.content, bundle.content);
  assertEquals(read.check?.status, "running");
  assertEquals(read.check?.bundle, bundle.id);
});

Deno.test("documents/contexts#R19 [ctx-S26]: after a failed check the draft goes back to step 2 with the failed bundle and its findings, the latest failure first", () => {
  const { state, t, reads } = setup();
  seedContext(state);
  const older = seedNumbered(state, t, { n: 1, status: "failed" });
  const latest = seedNumbered(state, t, {
    n: 2,
    status: "failed",
    content: minimalContent({ examples: [] }),
    parent: older.id,
  });
  const read = draftOf(reads)!;
  assertEquals(read.step, 2);
  assertEquals(read.bundle, summaryOf(latest));
  assertEquals(read.content, latest.content);
  assertEquals(read.check?.status, "failed");
  assertEquals(read.check?.findings.length, 1);
});

Deno.test("documents/contexts#R19 [ctx-S26]: context.draft is null for an active or archived context and rejects missing contexts and other actors", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  seedBundle(state, { id: ids.spareBundle, parent: ids.bundle });
  assertEquals(draftOf(reads, context.id), null);
  state.contexts.set(context.id, { ...context, status: "archived" });
  assertEquals(draftOf(reads, context.id), null);
  assertEquals(
    errorCode(reads.contextDraft({
      actor: user,
      input: { context: ids.missingContext },
    })),
    "not_found",
  );
  for (const actor of [actors.codingAgent, actors.worker]) {
    assertEquals(
      errorCode(reads.contextDraft({ actor, input: { context: context.id } })),
      "forbidden",
      actor.actor,
    );
  }
});

// ---------- context.input_options ----------

function optionsFixture() {
  const world = setup();
  const { state, t } = world;
  const { context } = seedActive(state, t, { content: optionsContent() });
  state.entities.set(context.id, [
    entity("Experiment", "003", {
      title: "Third",
      status: "weird",
      round: 10,
      tags: ["x", "y"],
    }),
    entity("Experiment", "001", {
      title: "First",
      status: "done",
      round: 2,
      tags: ["y", "a"],
    }),
    entity("Experiment", "002", { status: "running", round: 2 }),
    entity("Scenario", "s-1", { title: "Not an experiment" }),
  ]);
  const options = (
    input: Record<string, unknown>,
    actor: ContextApiActor = user,
  ) =>
    world.reads.contextInputOptions({
      actor,
      input: {
        context: context.id,
        search: "experiment_picker",
        input: "experiment",
        ...input,
      },
    });
  return { ...world, context, options };
}

const shapedOptions = (
  result: ReturnType<ReturnType<typeof optionsFixture>["options"]>,
) => shaped(contextInputOptionsReadSchema, expectOk(result));

Deno.test("documents/contexts#R15 [ctx-S26]: an entity input offers the keys and titles of that type in key order", () => {
  const { options, context } = optionsFixture();
  const read = shapedOptions(options({}));
  assertEquals(read.context, context.id);
  assertEquals(read.search, "experiment_picker");
  assertEquals(read.input, "experiment");
  assertEquals(read.options, [
    { value: "001", label: "First" },
    { value: "002", label: "002" },
    { value: "003", label: "Third" },
  ]);
  assertEquals(read.complete, true);
});

Deno.test("documents/contexts#R15 [ctx-S26]: a value input offers the enum values in declared order first and then the other values", () => {
  const { options, state, context } = optionsFixture();
  // 선언: planned, running, done. 행이 없는 값도 후보다. 선언 밖 값은 그 뒤다.
  assertEquals(
    shapedOptions(options({ input: "status" })).options.map((entry) =>
      entry.value
    ),
    ["planned", "running", "done", "weird"],
  );
  state.entities.set(context.id, [
    entity("Experiment", "001", { status: "done" }),
    entity("Experiment", "002", { status: "aaa" }),
    entity("Experiment", "003", { status: "bbb" }),
  ]);
  assertEquals(
    shapedOptions(options({ input: "status" })).options.map((entry) =>
      entry.value
    ),
    ["planned", "running", "done", "aaa", "bbb"],
  );
});

Deno.test("documents/contexts#R15 [ctx-S26]: a value input offers the distinct values of the field: texts in code unit order, numbers by size, list items flattened", () => {
  const { options } = optionsFixture();
  assertEquals(shapedOptions(options({ input: "title" })).options, [
    { value: "First", label: "First" },
    { value: "Third", label: "Third" },
  ]);
  assertEquals(shapedOptions(options({ input: "round" })).options, [
    { value: 2, label: "2" },
    { value: 10, label: "10" },
  ]);
  assertEquals(
    shapedOptions(options({ input: "tag" })).options.map((entry) =>
      entry.value
    ),
    ["a", "x", "y"],
  );
});

Deno.test("documents/contexts#R15 [ctx-S26]: the typed prefix filters on the value or the label without caring about ASCII case", () => {
  const { options } = optionsFixture();
  assertEquals(
    shapedOptions(options({ prefix: "fi" })).options.map((entry) =>
      entry.value
    ),
    ["001"],
  );
  assertEquals(
    shapedOptions(options({ prefix: "00" })).options.map((entry) =>
      entry.value
    ),
    ["001", "002", "003"],
  );
  assertEquals(
    shapedOptions(options({ prefix: "TH" })).options.map((entry) =>
      entry.value
    ),
    ["003"],
  );
  assertEquals(
    shapedOptions(options({ input: "status", prefix: "RUN" })).options.map((
      entry,
    ) => entry.value),
    ["running"],
  );
  assertEquals(
    shapedOptions(options({ input: "round", prefix: "1" })).options.map((
      entry,
    ) => entry.value),
    [10],
  );
  const none = shapedOptions(options({ prefix: "zzz" }));
  assertEquals(none.options, []);
  assertEquals(none.complete, true);
  // 빈 prefix는 걸러내지 않는다
  assertEquals(shapedOptions(options({ prefix: "" })).options.length, 3);
});

Deno.test("documents/contexts#R15 [ctx-S26]: the cap cuts the candidates and says the list is not complete", () => {
  const { options, state, context } = optionsFixture();
  const capped = shapedOptions(options({ limit: 2 }));
  assertEquals(capped.options.map((entry) => entry.value), ["001", "002"]);
  assertEquals(capped.complete, false);
  assertEquals(shapedOptions(options({ limit: 3 })).complete, true);
  assertEquals(
    shapedOptions(options({ limit: 1, prefix: "zzz" })).complete,
    true,
  );
  state.entities.set(
    context.id,
    Array.from(
      { length: 60 },
      (_, n) => entity("Experiment", String(n).padStart(3, "0")),
    ),
  );
  const standard = shapedOptions(options({}));
  assertEquals(standard.options.length, 50);
  assertEquals(standard.complete, false);
  assertEquals(standard.options[0].value, "000");
  assertEquals(standard.options[49].value, "049");
  assertEquals(shapedOptions(options({ limit: 200 })).options.length, 60);
});

Deno.test("documents/contexts#R15 [ctx-S26]: input_options only reads this context's entities of the declared type", () => {
  const { options, state, context } = optionsFixture();
  state.entities.set(ids.otherContext, [entity("Experiment", "other")]);
  assertEquals(
    shapedOptions(options({})).options.map((entry) => entry.value),
    ["001", "002", "003"],
  );
  state.entities.set(context.id, []);
  assertEquals(shapedOptions(options({})).options, []);
});

Deno.test("documents/contexts#R15 [ctx-S26]: input_options rejects inputs it cannot offer candidates for and contexts it cannot search", () => {
  const { options, state, context } = optionsFixture();
  for (
    const input of [
      { search: "no_such_search" },
      { input: "no_such_input" },
      { input: "note" },
      { input: "window" },
    ]
  ) {
    assertEquals(errorCode(options(input)), "invalid_input", String(input));
  }
  assertEquals(
    errorCode(options({}, actors.otherAgent)),
    "ok",
  );
  for (const actor of [actors.codingAgent, actors.worker]) {
    assertEquals(errorCode(options({}, actor)), "forbidden", actor.actor);
  }
  assertEquals(
    errorCode(options({ context: ids.missingContext })),
    "not_found",
  );
  state.indexFailing.add(context.id);
  assertEquals(errorCode(options({})), "unavailable");
  state.indexFailing.clear();
  state.contexts.set(context.id, {
    ...state.contexts.get(context.id)!,
    status: "archived",
  });
  assertEquals(errorCode(options({})), "not_found");
  const drafting = seedContext(state, {
    id: ids.otherContext,
    title: "Other",
  });
  assertEquals(
    errorCode(options({ context: drafting.id })),
    "not_found",
  );
});

// ---------- context.violations handed_off ----------

function handOffEvent(
  state: ReturnType<typeof setup>["state"],
  context: string,
  keys: {
    kind: string;
    rule: string | null;
    path: string;
    section: string | null;
  }[],
) {
  state.events.push({
    seq: String(state.events.length + 1),
    type: "ContextViolationsHandedOff",
    subject: context,
    actor: "user",
    at: "2026-10-12T00:00:00.000Z",
    payload: {
      violations: keys,
      evidence: { hash: "e".repeat(64), size_bytes: 10 },
      run: id("run", 5),
    },
  });
}

Deno.test("documents/contexts#R25 [ctx-S26]: context.violations marks the violations already handed to the Context Engineer", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  seedViolations(state, [
    violation({ path: "docs/a.md" }),
    violation({ path: "docs/b.md" }),
    violation({
      kind: "broken_link",
      rule: null,
      type: "Guide",
      path: "docs/c.md",
      target: "docs/gone.md",
      message: "Link target is missing",
    }),
    violation({ path: "docs/d.md", section: "Intro" }),
  ]);
  const handedOf = () =>
    shaped(
      contextViolationsReadSchema,
      expectOk(
        reads.contextViolations({
          actor: user,
          input: { context: context.id },
        }),
      ),
    ).violations.map((item) => [item.path, item.handed_off]);
  assertEquals(handedOf(), [
    ["docs/a.md", false],
    ["docs/b.md", false],
    ["docs/c.md", false],
    ["docs/d.md", false],
  ]);
  handOffEvent(state, context.id, [
    {
      kind: "rule",
      rule: "Experiment.status-required",
      path: "docs/a.md",
      section: null,
    },
    { kind: "broken_link", rule: null, path: "docs/c.md", section: null },
    // 같은 경로라도 section이 다르면 다른 위반이다
    {
      kind: "rule",
      rule: "Experiment.status-required",
      path: "docs/d.md",
      section: null,
    },
  ]);
  assertEquals(handedOf(), [
    ["docs/a.md", true],
    ["docs/b.md", false],
    ["docs/c.md", true],
    ["docs/d.md", false],
  ]);
  // 나중에 넘긴 것까지 합쳐서 본다
  handOffEvent(state, context.id, [{
    kind: "rule",
    rule: "Experiment.status-required",
    path: "docs/b.md",
    section: null,
  }, {
    kind: "rule",
    rule: "Experiment.status-required",
    path: "docs/d.md",
    section: "Intro",
  }]);
  assertEquals(handedOf(), [
    ["docs/a.md", true],
    ["docs/b.md", true],
    ["docs/c.md", true],
    ["docs/d.md", true],
  ]);
});

Deno.test("documents/contexts#R25 [ctx-S26]: a hand-off of another context or another event type does not mark a violation", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  seedViolations(state, [violation({ path: "docs/a.md" })]);
  const key = {
    kind: "rule",
    rule: "Experiment.status-required",
    path: "docs/a.md",
    section: null,
  };
  handOffEvent(state, ids.otherContext, [key]);
  state.events.push({
    seq: "9",
    type: "ContextViolationsRecorded",
    subject: context.id,
    actor: "machine",
    at: "2026-10-12T00:00:00.000Z",
    payload: { before: 0, after: 1, bundle_hash: "a".repeat(64) },
  });
  const read = () =>
    expectOk(
      reads.contextViolations({ actor: user, input: { context: context.id } }),
    ).violations.map((item) => item.handed_off);
  assertEquals(read(), [false]);
  handOffEvent(state, context.id, [key]);
  assertEquals(read(), [true]);
});

Deno.test("documents/contexts#R25 [ctx-S26]: the hand-off command marks exactly the violations it handed off", () => {
  const { state, t, reads } = setup();
  const { context } = seedActive(state, t);
  seedViolations(state, [
    violation({ path: "docs/a.md" }),
    violation({ path: "docs/b.md" }),
  ]);
  const commands = createContextApiCommands(state, t.deps);
  expectOk(commands.handOffViolations({
    actor: user,
    key: "k1",
    input: {
      context: context.id,
      violations: [{
        kind: "rule",
        rule: "Experiment.status-required",
        path: "docs/b.md",
        section: null,
      }],
    },
    compare: {},
  }));
  assertEquals(
    expectOk(
      reads.contextViolations({ actor: user, input: { context: context.id } }),
    ).violations.map((item) => [item.path, item.handed_off]),
    [["docs/a.md", false], ["docs/b.md", true]],
  );
});
