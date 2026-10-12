// context.entity와 context.series_next의 acceptance 시험이다. 구현 전이라 모두 실패해야 한다(spec 단계).
// 적용된 판의 index(state.entities)만 읽는다. fixture는 eval-project의 계약과 정답 개체다.
import { assert, assertEquals } from "@std/assert";
import type { z } from "zod";
import {
  contextEntityReadSchema,
  contextSeriesNextReadSchema,
  type ContextValue,
} from "../../../../protocol/projects/mod.ts";
import { createContextApiReads } from "./reads.ts";
import type { EntityRow } from "./state.ts";
import {
  actors,
  errorCode,
  evalContent,
  expectOk,
  id,
  ids,
  newState,
  seedActive,
  seedBundle,
  seedContext,
  testDeps,
} from "./testing.ts";

const user = actors.user;

// 정답 개체는 index가 저장하는 모양(links 포함)이다. app-data 개체는 index에 저장하지 않으므로 뺀다.
function indexed(): EntityRow[] {
  const all: EntityRow[] = JSON.parse(
    Deno.readTextFileSync(
      new URL(
        "../testdata/expected/eval-project.entities.json",
        import.meta.url,
      ),
    ),
  );
  return all.filter((row) => row.type !== "Event");
}

function setup(content: Record<string, unknown> = evalContent()) {
  const state = newState();
  const t = testDeps();
  const { context } = seedActive(state, t, { content });
  state.entities.set(context.id, indexed());
  const reads = createContextApiReads(state, { execute: () => [] });
  return { state, t, reads, context };
}

function shaped<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  assert(parsed.success, JSON.stringify(parsed.error?.issues));
  return parsed.data;
}

const entity = (type: string, key: string, context = ids.context) => ({
  actor: user,
  input: { context, type, key },
});
const nextOf = (type: string, context = ids.context) => ({
  actor: user,
  input: { context, type },
});

// ---------- context.entity ----------

Deno.test("documents/contexts#R16 [ctx-I63]: context.entity reads one entity's ref, every declared field and the bundle hash", () => {
  const { reads, state } = setup();
  const read = shaped(
    contextEntityReadSchema,
    expectOk(reads.contextEntity(entity("Experiment", "001"))),
  );
  assertEquals(read.context, ids.context);
  assertEquals(read.bundle_hash, state.bundles.get(ids.bundle)!.bundle_hash);
  assertEquals(read.ref, {
    type: "Experiment",
    key: "001",
    path: "eval/experiments/exp-001-plan.md",
    section: null,
  });
  assertEquals(read.fields, {
    id: "001",
    title: "Plan arm against baseline",
    status: "done",
    scenarios: ["schedule-basic"],
    rubric: "schedule-quality",
    question: "Does planning first beat the baseline?",
  });
  assertEquals(read.as_of_seq, String(state.seq));
  assertEquals(read.next_cursor, null);
});

Deno.test("documents/contexts#R16 [ctx-I63]: context.entity lists every declared relation in declaration order with the targets in edge order", () => {
  const { reads } = setup();
  const read = expectOk(reads.contextEntity(entity("Experiment", "002")));
  assertEquals(read.relations.map((r) => [r.name, r.label]), [
    ["runs_on", "runs on"],
    ["graded_by", "graded by"],
  ]);
  const [runsOn, gradedBy] = read.relations;
  // edge order is the via value order: schedule-basic, then travel
  assertEquals(runsOn!.targets, [{
    type: "Scenario",
    key: "schedule-basic",
    path: "eval/scenarios/schedule-basic.md",
    section: null,
  }, {
    type: "Scenario",
    key: "travel",
    path: "eval/scenarios/travel.md",
    section: null,
  }]);
  // the other context (rubrics) is not in this state, so its type cannot be reached
  assertEquals(gradedBy!.targets, []);
});

Deno.test("documents/contexts#R16 [ctx-I63]: a relation without edges or whose target is not in the index has no targets, and the relation is still listed", () => {
  const { reads } = setup();
  const none = expectOk(reads.contextEntity(entity("Experiment", "003")));
  assertEquals(none.relations.map((r) => [r.name, r.targets.length]), [
    ["runs_on", 0],
    ["graded_by", 0],
  ]);
  // exp-010 points at moon-trip, which no Scenario entity has
  const dangling = expectOk(reads.contextEntity(entity("Experiment", "010")));
  assertEquals(dangling.relations[0]!.targets, []);
  // a type without relations has an empty list
  const plain = expectOk(reads.contextEntity(entity("Scenario", "travel")));
  assertEquals(plain.relations, []);
});

Deno.test("documents/contexts#R16 [ctx-I63]: context.entity opens section and alias entities by their own key and gives the section", () => {
  const { reads } = setup();
  const decision = expectOk(
    reads.contextEntity(entity("Decision", "Use SQLite")),
  );
  assertEquals(decision.ref, {
    type: "Decision",
    key: "Use SQLite",
    path: "docs/decisions.md",
    section: "Use SQLite",
  });
  // the target of a relation opens with the ref the relation gave
  const finding = expectOk(reads.contextEntity(entity("Finding", "001")));
  const about = finding.relations[0]!.targets[0]!;
  const target = expectOk(
    reads.contextEntity(entity(about.type, about.key)),
  );
  assertEquals(target.ref, about);
});

Deno.test("documents/contexts#R16 [ctx-I63]: context.entity is not_found for an entity the index lacks and invalid_input for a type the contract lacks", () => {
  const { reads } = setup();
  assertEquals(
    errorCode(reads.contextEntity(entity("Experiment", "999"))),
    "not_found",
  );
  // key is matched exactly
  assertEquals(
    errorCode(reads.contextEntity(entity("Experiment", "1"))),
    "not_found",
  );
  assertEquals(
    errorCode(reads.contextEntity(entity("Scenario", "001"))),
    "not_found",
  );
  assertEquals(
    errorCode(reads.contextEntity(entity("Nothing", "001"))),
    "invalid_input",
  );
  // app-data entities are not stored in the index
  assertEquals(
    errorCode(reads.contextEntity(entity("Event", "ev-1"))),
    "not_found",
  );
});

Deno.test("documents/contexts#R16 [ctx-I63]: context.entity gives the first entity in extraction order when two share a type and key", () => {
  const { reads, state } = setup();
  const rows = state.entities.get(ids.context)!;
  rows.push({
    ...rows[0]!,
    path: "eval/experiments/exp-001-copy.md",
    fields: { ...rows[0]!.fields, title: "Copy" },
  });
  const read = expectOk(reads.contextEntity(entity("Experiment", "001")));
  assertEquals(read.ref.path, "eval/experiments/exp-001-plan.md");
});

Deno.test("documents/contexts#R16 [ctx-I63]: context.entity reads only this context's applied bundle and entities", () => {
  const { reads, state, t } = setup();
  const other = seedActive(state, t, {
    n: 1,
    slot: 11,
    context: { id: id("ctx", 11), title: "Other" },
  });
  state.entities.set(other.context.id, [{
    type: "Experiment",
    key: "001",
    path: "other/exp-001.md",
    section: null,
    fields: { id: "001" },
  }]);
  const read = expectOk(
    reads.contextEntity(entity("Experiment", "001", other.context.id)),
  );
  assertEquals(read.ref.path, "other/exp-001.md");
  assertEquals(read.bundle_hash, other.bundle.bundle_hash);
});

Deno.test("documents/contexts#R4 [ctx-I63]: context.entity is closed for an archived, a drafting and an unknown context and for an index that failed", () => {
  const { reads, state } = setup();
  state.contexts.set(ids.context, {
    ...state.contexts.get(ids.context)!,
    status: "archived",
  });
  assertEquals(
    errorCode(reads.contextEntity(entity("Experiment", "001"))),
    "not_found",
  );
  const drafting = seedContext(state, { id: ids.otherContext });
  seedBundle(state, { id: ids.spareBundle, context: drafting.id });
  assertEquals(
    errorCode(reads.contextEntity(entity("Experiment", "001", drafting.id))),
    "not_found",
  );
  assertEquals(
    errorCode(
      reads.contextEntity(entity("Experiment", "001", ids.missingContext)),
    ),
    "not_found",
  );
  state.contexts.set(ids.context, {
    ...state.contexts.get(ids.context)!,
    status: "active",
  });
  state.indexFailing.add(ids.context);
  assertEquals(
    errorCode(reads.contextEntity(entity("Experiment", "001"))),
    "unavailable",
  );
});

Deno.test("documents/contexts#R27 [ctx-I63]: context.entity and context.series_next are read by user and lophn agents and by no one else", () => {
  const { reads } = setup();
  for (const actor of [actors.user, actors.engineer, actors.otherAgent]) {
    expectOk(reads.contextEntity({ ...entity("Experiment", "001"), actor }));
    expectOk(reads.contextSeriesNext({ ...nextOf("Experiment"), actor }));
  }
  for (
    const actor of [actors.codingAgent, actors.worker, actors.otherMachine]
  ) {
    assertEquals(
      errorCode(
        reads.contextEntity({ ...entity("Experiment", "001"), actor }),
      ),
      "forbidden",
    );
    assertEquals(
      errorCode(reads.contextSeriesNext({ ...nextOf("Experiment"), actor })),
      "forbidden",
    );
  }
});

Deno.test("documents/contexts#R23 [ctx-I63]: reading an entity or the next name changes no state and the same call gives the same result", () => {
  const { reads, state } = setup();
  const before = JSON.stringify({
    seq: state.seq,
    events: state.events,
    entities: [...state.entities],
    bundles: [...state.bundles],
  });
  const a = expectOk(reads.contextEntity(entity("Experiment", "002")));
  const b = expectOk(reads.contextEntity(entity("Experiment", "002")));
  assertEquals(a, b);
  const c = expectOk(reads.contextSeriesNext(nextOf("Experiment")));
  const d = expectOk(reads.contextSeriesNext(nextOf("Experiment")));
  assertEquals(c, d);
  assertEquals(
    JSON.stringify({
      seq: state.seq,
      events: state.events,
      entities: [...state.entities],
      bundles: [...state.bundles],
    }),
    before,
  );
});

// ---------- context.series_next ----------

Deno.test("documents/series#R5 [ctx-I63]: context.series_next computes the next name from the series pattern and the index paths of that type", () => {
  const { reads, state } = setup();
  const read = shaped(
    contextSeriesNextReadSchema,
    expectOk(reads.contextSeriesNext(nextOf("Experiment"))),
  );
  assertEquals(read.context, ids.context);
  assertEquals(read.type, "Experiment");
  assertEquals(read.pattern, "eval/experiments/exp-{n:03}-*.md");
  // 001 002 003 004 010 -> the last member is exp-010, so 011 (the file name part stays *)
  assertEquals(read.next, {
    key: "011",
    path: "eval/experiments/exp-011-*.md",
    from: "eval/experiments/exp-010-tiller.md",
    complete: false,
    taken: false,
  });
  assertEquals(read.as_of_seq, String(state.seq));
  assertEquals(read.next_cursor, null);
});

Deno.test("documents/series#R7 [ctx-I63]: a pattern without a * place gives a complete path", () => {
  const { reads } = setup();
  const read = expectOk(reads.contextSeriesNext(nextOf("Finding")));
  assertEquals(read.pattern, "loop/findings/F-{n:03}.md");
  assertEquals(read.next, {
    key: "004",
    path: "loop/findings/F-004.md",
    from: "loop/findings/F-003.md",
    complete: true,
    taken: false,
  });
});

Deno.test("documents/series#R5 [ctx-I63]: the members are the index entities of that type, so other types and other contexts' paths do not count", () => {
  const { reads, state, t } = setup();
  const rows = state.entities.get(ids.context)!;
  // a path of another type in the same folder is not a member of Experiment
  rows.push({
    type: "Scenario",
    key: "late",
    path: "eval/experiments/exp-050-late.md",
    section: null,
    fields: {},
  });
  const other = seedActive(state, t, {
    n: 1,
    slot: 11,
    context: { id: id("ctx", 11), title: "Other" },
  });
  state.entities.set(other.context.id, [{
    type: "Experiment",
    key: "090",
    path: "eval/experiments/exp-090-x.md",
    section: null,
    fields: {},
  }]);
  const read = expectOk(reads.contextSeriesNext(nextOf("Experiment")));
  assertEquals(read.next.key, "011");
  assertEquals(read.next.from, "eval/experiments/exp-010-tiller.md");
});

Deno.test("documents/series#R6 [ctx-I63]: a series type with no entity gives the empty suggestion and not an error", () => {
  const { reads, state } = setup();
  state.entities.set(
    ids.context,
    state.entities.get(ids.context)!.filter((row) => row.type !== "Finding"),
  );
  const read = shaped(
    contextSeriesNextReadSchema,
    expectOk(reads.contextSeriesNext(nextOf("Finding"))),
  );
  assertEquals(read.pattern, "loop/findings/F-{n:03}.md");
  assertEquals(read.next, {
    key: "",
    path: null,
    from: null,
    complete: false,
    taken: false,
  });
});

Deno.test("documents/series#R5 [ctx-I63]: taken says the computed key already has a member", () => {
  const content = evalContent();
  const types = (content.contract as {
    types: { name: string; source: { pattern?: string } }[];
  }).types;
  // {n+0} computes the last member's own key
  types.find((type) => type.name === "Finding")!.source.pattern =
    "loop/findings/F-{n+0:03}.md";
  const { reads } = setup(content);
  const read = shaped(
    contextSeriesNextReadSchema,
    expectOk(reads.contextSeriesNext(nextOf("Finding"))),
  );
  assertEquals(read.next, {
    key: "003",
    path: "loop/findings/F-003.md",
    from: "loop/findings/F-003.md",
    complete: true,
    taken: true,
  });
});

Deno.test("documents/series#R2 [ctx-I63]: context.series_next is invalid_input for a type that is not a series kind and for a type the contract lacks", () => {
  const { reads } = setup();
  for (const type of ["Scenario", "Decision", "Guide", "Event", "Nothing"]) {
    assertEquals(
      errorCode(reads.contextSeriesNext(nextOf(type))),
      "invalid_input",
      type,
    );
  }
});

Deno.test("documents/series#R10 [ctx-I63]: context.series_next uses the applied bundle's pattern, not the draft's, and is closed like the other index reads", () => {
  const { reads, state } = setup();
  // a newer draft with another pattern does not change the answer
  const draft = JSON.parse(JSON.stringify(evalContent()));
  draft.contract.types[0].source.pattern = "other/x-{n}.md";
  seedBundle(state, { id: ids.spareBundle, content: draft });
  assertEquals(
    expectOk(reads.contextSeriesNext(nextOf("Experiment"))).pattern,
    "eval/experiments/exp-{n:03}-*.md",
  );
  assertEquals(
    errorCode(
      reads.contextSeriesNext(nextOf("Experiment", ids.missingContext)),
    ),
    "not_found",
  );
  state.indexFailing.add(ids.context);
  assertEquals(
    errorCode(reads.contextSeriesNext(nextOf("Experiment"))),
    "unavailable",
  );
  state.indexFailing.delete(ids.context);
  state.contexts.set(ids.context, {
    ...state.contexts.get(ids.context)!,
    status: "archived",
  });
  assertEquals(
    errorCode(reads.contextSeriesNext(nextOf("Experiment"))),
    "not_found",
  );
});

// ---------- relations to another context (ctx-I36) ----------

const RUBRICS = id("ctx", 11);

function rubricsContent(visibility: "public" | "private") {
  return {
    schema: 1,
    contract: {
      types: [{
        name: "Rubric",
        summary: "How an experiment is graded",
        visibility,
        source: { kind: "docs", paths: ["eval/rubrics/*.md"] },
        key: "id",
        fields: [{
          name: "id",
          from: { kind: "path", capture: "file" },
          value_type: "string",
          required: false,
          visibility,
        }],
        relations: [],
        rules: [],
      }],
    },
    searches: [],
    saved_views: [],
    examples: [],
  };
}

function withRubrics(
  options: {
    visibility?: "public" | "private";
    context?: Partial<ContextValue>;
  } = {},
) {
  const world = setup();
  const rubrics = seedActive(world.state, world.t, {
    n: 1,
    slot: 11,
    context: { id: RUBRICS, title: "rubrics", ...options.context },
    content: rubricsContent(options.visibility ?? "public"),
  });
  world.state.entities.set(RUBRICS, [{
    type: "Rubric",
    key: "schedule-quality",
    path: "eval/rubrics/schedule-quality.md",
    section: null,
    fields: { id: "schedule-quality" },
    links: [],
  }]);
  return { ...world, rubrics };
}

const gradedBy = (
  world: ReturnType<typeof withRubrics>,
  key = "001",
) =>
  expectOk(world.reads.contextEntity(entity("Experiment", key)))
    .relations.find((relation) => relation.name === "graded_by")!.targets;

Deno.test("documents/contexts#R14 #R16 [ctx-I36]: context.entity follows a `<title>/<Type>` relation into the other context's index and names that context in the ref", () => {
  const world = withRubrics();
  assertEquals(gradedBy(world), [{
    context: RUBRICS,
    type: "Rubric",
    key: "schedule-quality",
    path: "eval/rubrics/schedule-quality.md",
    section: null,
  }]);
  // the ref opens the rubric in its own context
  const opened = shaped(
    contextEntityReadSchema,
    expectOk(world.reads.contextEntity(
      entity("Rubric", "schedule-quality", RUBRICS),
    )),
  );
  assertEquals(opened.ref.path, "eval/rubrics/schedule-quality.md");
  // a relation of the same context gives refs without a context
  const runsOn =
    expectOk(world.reads.contextEntity(entity("Experiment", "002")))
      .relations[0]!.targets;
  assert(runsOn.length > 0 && runsOn.every((ref) => !("context" in ref)));
});

Deno.test("documents/contexts#R14 [ctx-I36]: a relation to another context has no targets when that context is another project's, archived, or drafting, when its type is private, or when the index does not have the key", () => {
  const cases: [string, ReturnType<typeof withRubrics>][] = [
    [
      "another project",
      withRubrics({ context: { project: ids.otherProject } }),
    ],
    ["archived", withRubrics({ context: { status: "archived" } })],
    ["a title that differs", withRubrics({ context: { title: "Rubrics" } })],
    ["a private type", withRubrics({ visibility: "private" })],
  ];
  for (const [what, world] of cases) assertEquals(gradedBy(world), [], what);

  const drafting = withRubrics();
  drafting.state.contexts.set(RUBRICS, {
    ...drafting.state.contexts.get(RUBRICS)!,
    status: "drafting",
    applied_bundle: null,
  });
  assertEquals(gradedBy(drafting), [], "drafting");

  const missing = withRubrics();
  missing.state.entities.set(RUBRICS, []);
  assertEquals(gradedBy(missing), [], "no entity");

  const failing = withRubrics();
  failing.state.indexFailing.add(RUBRICS);
  assertEquals(gradedBy(failing), [], "index not readable");
});
