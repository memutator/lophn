// deno-lint-ignore-file no-explicit-any
// lophn-agent/harness/tools#R21, R22: context가 선언한 검색마다 읽기 tool이 적용된 판에서 자동으로 만들어지고
// (이름·설명·입력 JSON Schema·결과 모양을 선언에서 가져온다), 개체 하나 읽기 tool이 따로 있다. 구현은
// ctx-I56이 한다. core는 `ContractCall` fake이고 네트워크·model은 부르지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  bundleContentSchema,
  type EntityRef,
} from "../../../protocol/projects/mod.ts";
import {
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
  type ToolDefinition,
} from "./mod.ts";
import {
  buildContextReadTools,
  CONTEXT_ENTITY_CONTRACT,
  CONTEXT_ENTITY_TOOL,
  CONTEXT_SEARCH_CONTRACT,
  type ContextEntityRead,
  contextReadDefinitions,
  type ContextReadTools,
  type ContextSearchToolSource,
  type ContextToolContext,
  createContextReadToolHandlers,
} from "./context-search-tools.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const CALL = id("tcl", 1);
const CTX_EXPERIMENTS = id("ctx", 1);
const CTX_RECIPES = id("ctx", 2);
const CTX_OTHER_PROJECT = id("ctx", 3);

// ---- fixture: 판 ----

function experimentsContent(over: { statusValues?: string[] } = {}) {
  return bundleContentSchema.parse({
    schema: 1,
    contract: {
      types: [
        {
          name: "Experiment",
          summary: "하나의 실험",
          visibility: "public",
          source: {
            kind: "series",
            pattern: "eval/experiments/exp-{n:3}-*.md",
          },
          key: "id",
          fields: [
            {
              name: "id",
              from: { kind: "path", capture: "n" },
              value_type: "string",
            },
            {
              name: "status",
              from: { kind: "frontmatter", key: "status" },
              value_type: "enum",
              values: over.statusValues ?? ["planned", "running", "done"],
              required: true,
            },
            {
              name: "score",
              from: { kind: "frontmatter", key: "score" },
              value_type: "number",
            },
            {
              name: "started",
              from: { kind: "frontmatter", key: "started" },
              value_type: "date",
            },
            {
              name: "blind",
              from: { kind: "frontmatter", key: "blind" },
              value_type: "boolean",
            },
            {
              name: "scenarios",
              from: { kind: "frontmatter", key: "scenarios" },
              value_type: "list",
              item_type: "string",
            },
          ],
          relations: [{
            name: "runs_on",
            label: "실험이 돌린 시나리오",
            to: "Scenario",
            via: "scenarios",
            cardinality: "many",
          }],
        },
        {
          name: "Scenario",
          summary: "에이전트가 평가받는 과제",
          source: { kind: "docs", paths: ["eval/scenarios/*.md"] },
          key: "slug",
          fields: [{
            name: "slug",
            from: { kind: "path", capture: "file" },
            value_type: "string",
          }],
        },
      ],
    },
    searches: [
      {
        name: "experiments_by_status",
        title: "상태별 실험",
        inputs: [{
          name: "status",
          label: "상태",
          type: "value",
          of: "Experiment.status",
          many: true,
        }],
        query: {
          from: "Experiment",
          where: { path: "status", op: "in", value: { input: "status" } },
        },
        result: { kind: "board", board_by: "status" },
      },
      {
        name: "experiments_on_scenario",
        title: "시나리오를 돌린 실험",
        inputs: [{
          name: "scenario",
          label: "시나리오",
          type: "entity",
          of: "Scenario",
          required: true,
        }],
        query: {
          from: "Scenario",
          where: { path: "key", op: "eq", value: { input: "scenario" } },
          follow: [{
            relation: "runs_on",
            as: "exp",
            direction: "reverse",
          }],
        },
        result: {
          kind: "table",
          columns: [
            { label: "실험", path: "exp.key" },
            { label: "상태", path: "exp.status" },
          ],
        },
      },
      {
        name: "find_experiments",
        title: "실험 찾기",
        inputs: [
          { name: "q", label: "검색어", type: "text", required: true },
          {
            name: "score",
            label: "점수 범위",
            type: "range",
            of: "Experiment.score",
          },
          {
            name: "started",
            label: "시작일 범위",
            type: "range",
            of: "Experiment.started",
          },
          {
            name: "blind",
            label: "블라인드 여부",
            type: "value",
            of: "Experiment.blind",
          },
          {
            name: "scenarios",
            label: "시나리오들",
            type: "entity",
            of: "Scenario",
            many: true,
          },
        ],
        query: { from: "Experiment" },
        result: {
          kind: "table",
          columns: [{ label: "실험", path: "key" }],
        },
      },
    ],
    examples: [{
      kind: "search",
      search: "experiments_by_status",
      inputs: {},
      expect_keys: ["001"],
    }],
  });
}

function recipesContent() {
  return bundleContentSchema.parse({
    schema: 1,
    contract: {
      types: [{
        name: "Recipe",
        summary: "요리 하나",
        source: { kind: "docs", paths: ["recipes/*.md"] },
        key: "slug",
        fields: [{
          name: "slug",
          from: { kind: "path", capture: "file" },
          value_type: "string",
        }],
      }],
    },
    searches: [
      {
        // 다른 context와 이름이 같다. tool 이름은 context가 달라 다르다.
        name: "experiments_by_status",
        title: "요리 목록",
        inputs: [],
        query: { from: "Recipe" },
        result: { kind: "table", columns: [{ label: "요리", path: "key" }] },
      },
    ],
  });
}

function experiments(
  over: Partial<ContextToolContext> = {},
): ContextToolContext {
  return {
    id: CTX_EXPERIMENTS,
    title: "Experiments",
    bundle_hash: "a".repeat(64),
    content: experimentsContent(),
    ...over,
  };
}
const RECIPES: ContextToolContext = {
  id: CTX_RECIPES,
  title: "Recipes",
  bundle_hash: "b".repeat(64),
  content: recipesContent(),
};

function source(
  over: Partial<ContextSearchToolSource> = {},
): ContextSearchToolSource {
  return { selected: [experiments(), RECIPES], allowed: null, ...over };
}

// ---- fixture: fake core ----

const REF_001: EntityRef = {
  type: "Experiment",
  key: "001",
  path: "eval/experiments/exp-001-plan.md",
  section: null,
};

type Seen = {
  contract: string;
  input: Record<string, unknown>;
  run: string;
};

function rowOf(n: number) {
  const key = String(n).padStart(3, "0");
  return {
    ref: {
      type: "Experiment",
      key,
      path: `eval/experiments/exp-${key}-x.md`,
      section: null,
    },
    cells: [{ path: "key", value: key, ref: null }],
  };
}

// 45개 행을 offset cursor로 나눠 주는 core. page_size는 요청을 따르되 100을 넘기지 않는다.
function fakeCore(options: { rows?: number; hidden?: Set<string> } = {}) {
  const seen: Seen[] = [];
  const total = options.rows ?? 45;
  const ports = {
    call(
      contract: string,
      input: unknown,
      run: string,
    ): Promise<Result<unknown>> {
      const body = input as Record<string, unknown>;
      seen.push({ contract, input: body, run });
      const context = body["context"] as string;
      if (
        context === CTX_OTHER_PROJECT || options.hidden?.has(context) === true
      ) {
        return Promise.resolve(err({
          code: "not_found",
          message: `no context ${context}`,
        }));
      }
      if (contract === CONTEXT_SEARCH_CONTRACT) {
        const start = body["cursor"] === undefined
          ? 0
          : Number(body["cursor"] as string);
        const size = Math.min(
          (body["page_size"] as number | undefined) ?? 30,
          100,
        );
        const end = Math.min(total, start + size);
        const rows = Array.from(
          { length: end - start },
          (_, i) => rowOf(start + i + 1),
        );
        return Promise.resolve(ok({
          as_of_seq: "9",
          complete: end >= total,
          next_cursor: end >= total ? null : String(end),
          context,
          search: body["search"],
          bundle_hash: "a".repeat(64),
          total,
          rows,
        }));
      }
      if (contract === CONTEXT_ENTITY_CONTRACT) {
        if (body["key"] === "999") {
          return Promise.resolve(err({
            code: "not_found",
            message: "no entity 999",
          }));
        }
        const read: ContextEntityRead = {
          context,
          bundle_hash: "a".repeat(64),
          ref: body["key"] === "002"
            ? { ...REF_001, key: "002", section: "질문" }
            : REF_001,
          fields: { id: "001", status: "running", scenarios: ["s1", "s2"] },
          relations: [{
            name: "runs_on",
            label: "실험이 돌린 시나리오",
            targets: [
              {
                type: "Scenario",
                key: "s1",
                path: "eval/scenarios/s1.md",
                section: null,
              },
              {
                type: "Scenario",
                key: "s2",
                path: "eval/scenarios/s2.md",
                section: null,
              },
            ],
          }],
        };
        return Promise.resolve(ok(read));
      }
      return Promise.resolve(err({ code: "not_found", message: "no route" }));
    },
  };
  return { ports, seen };
}

function credential(listed: readonly ToolDefinition[]): RunCredential {
  return {
    run: RUN,
    targets: new Set(),
    operations: new Set(runOperations(listed)),
    call: CALL,
  };
}

async function toolbox(
  src: ContextSearchToolSource = source(),
  core = fakeCore(),
) {
  const tools = await buildContextReadTools(src);
  const listed = contextReadDefinitions(tools);
  const handlers = createContextReadToolHandlers(tools, core.ports);
  return {
    tools,
    listed,
    seen: core.seen,
    run: (name: string, input: unknown) =>
      executeTool(
        { listed, handlers, credential: credential(listed) },
        name,
        input,
      ),
  };
}

function nameOf(tools: ContextReadTools, context: string, search: string) {
  const found = tools.search.find((tool) =>
    tool.context === context && tool.search === search
  );
  assert(found !== undefined, `no tool for ${context} ${search}`);
  return found.definition.name;
}

// description은 문구라 구조 비교에서 뺀다.
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "description").map((
        [key, item],
      ) => [key, shape(item)]),
    );
  }
  return value;
}

function schemaOf(definition: ToolDefinition): Record<string, any> {
  assert(definition.inputSchema !== undefined);
  return definition.inputSchema;
}

// ---- R21: 선언 검색마다 tool 하나 ----

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 고른 context의 선언 검색마다 읽기 tool 하나가 결정적인 이름·설명과 함께 만들어진다", async () => {
  const tools = await buildContextReadTools(source());
  // 검색 셋 + 검색 하나.
  assertEquals(tools.search.length, 4);
  assertEquals(
    tools.search.map((tool) => [tool.context, tool.search]).sort(),
    [
      [CTX_EXPERIMENTS, "experiments_by_status"],
      [CTX_EXPERIMENTS, "experiments_on_scenario"],
      [CTX_EXPERIMENTS, "find_experiments"],
      [CTX_RECIPES, "experiments_by_status"],
    ].sort(),
  );

  const names = tools.search.map((tool) => tool.definition.name);
  assertEquals(new Set(names).size, names.length);
  for (const name of names) {
    assert(/^[A-Za-z0-9_-]{1,64}$/.test(name), name);
  }
  // 이름이 같은 검색도 context가 다르면 tool 이름이 다르다.
  assertNotEquals(
    nameOf(tools, CTX_EXPERIMENTS, "experiments_by_status"),
    nameOf(tools, CTX_RECIPES, "experiments_by_status"),
  );
  // 같은 판은 같은 이름을 만든다.
  const again = await buildContextReadTools(source());
  assertEquals(
    again.search.map((tool) => tool.definition.name),
    names,
  );

  for (const tool of tools.search) {
    const { definition } = tool;
    const declared = [experiments(), RECIPES].find((c) =>
      c.id === tool.context
    )!
      .content.searches.find((s) => s.name === tool.search)!;
    // 설명은 검색 제목에서 온다.
    assert(definition.description.includes(declared.title));
    assertEquals(definition.effect, "read");
    assertEquals(definition.origin, "context");
    assertEquals(definition.context, tool.context);
    assertEquals(definition.confirm, false);
    assertEquals(definition.idempotent, true);
    assertEquals(definition.contract, CONTEXT_SEARCH_CONTRACT);
    assertEquals(definition.errors.includes("not_found"), true);
  }
  // 개체 읽기는 선택한 context가 몇이든 tool 하나다.
  assertEquals(tools.entity?.name, CONTEXT_ENTITY_TOOL);
  assertEquals(contextReadDefinitions(tools).length, 5);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 역할 상한·assignment 범위와 preset이 고른 context의 교집합인 검색만 제공한다", async () => {
  // preset이 고르지 않은 context는 없다.
  const onlyRecipes = await buildContextReadTools(
    source({ selected: [RECIPES] }),
  );
  assertEquals(onlyRecipes.search.map((tool) => tool.context), [CTX_RECIPES]);
  assertEquals(onlyRecipes.contexts, [CTX_RECIPES]);

  // 범위가 좁히면 고른 것 중에서도 빠진다.
  const scoped = await buildContextReadTools(
    source({ allowed: new Set([CTX_EXPERIMENTS]) }),
  );
  assertEquals(
    new Set(scoped.search.map((tool) => tool.context)),
    new Set([CTX_EXPERIMENTS]),
  );
  assertEquals(scoped.contexts, [CTX_EXPERIMENTS]);

  // 범위에 있어도 preset이 고르지 않았으면 없다.
  const unchosen = await buildContextReadTools(
    source({ selected: [RECIPES], allowed: new Set([CTX_EXPERIMENTS]) }),
  );
  assertEquals(unchosen.search, []);
  assertEquals(unchosen.entity, null);
  assertEquals(contextReadDefinitions(unchosen), []);

  // 선택이 비면 tool도 없다.
  const none = await buildContextReadTools(source({ selected: [] }));
  assertEquals(contextReadDefinitions(none), []);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 입력 JSON Schema는 선언의 입력(entity·value·range·text, many, required)에서 온다", async () => {
  const tools = await buildContextReadTools(source());
  const byStatus = schemaOf(
    tools.search.find((t) =>
      t.context === CTX_EXPERIMENTS && t.search === "experiments_by_status"
    )!
      .definition,
  );
  // value 입력은 field 종류를 따르고 enum은 선언한 값만 허용하며 many는 배열이다. 필수가 없으면 required도 없다.
  assertEquals(shape(byStatus), {
    type: "object",
    properties: {
      inputs: {
        type: "object",
        properties: {
          status: {
            type: "array",
            items: { type: "string", enum: ["planned", "running", "done"] },
          },
        },
        additionalProperties: false,
      },
      cursor: { type: "string" },
    },
    additionalProperties: false,
  });

  const onScenario = schemaOf(
    tools.search.find((t) =>
      t.context === CTX_EXPERIMENTS && t.search === "experiments_on_scenario"
    )!
      .definition,
  );
  // entity 입력은 개체 key 문자열이고 필수 입력이 있으면 inputs도 필수다.
  assertEquals(shape(onScenario), {
    type: "object",
    properties: {
      inputs: {
        type: "object",
        properties: { scenario: { type: "string" } },
        required: ["scenario"],
        additionalProperties: false,
      },
      cursor: { type: "string" },
    },
    required: ["inputs"],
    additionalProperties: false,
  });

  const find = schemaOf(
    tools.search.find((t) =>
      t.context === CTX_EXPERIMENTS && t.search === "find_experiments"
    )!
      .definition,
  );
  const inputs = find.properties.inputs;
  assertEquals(find.required, ["inputs"]);
  assertEquals(inputs.required, ["q"]);
  assertEquals(inputs.additionalProperties, false);
  assertEquals(Object.keys(inputs.properties).sort(), [
    "blind",
    "q",
    "scenarios",
    "score",
    "started",
  ]);
  // text는 글, boolean field의 value는 boolean, entity many는 key 배열이다.
  assertEquals(shape(inputs.properties.q), { type: "string" });
  assertEquals(shape(inputs.properties.blind), { type: "boolean" });
  assertEquals(shape(inputs.properties.scenarios), {
    type: "array",
    items: { type: "string" },
  });
  // range는 from·to(둘 다 선택)이고 값 종류는 field를 따른다.
  assertEquals(shape(inputs.properties.score), {
    type: "object",
    properties: { from: { type: "number" }, to: { type: "number" } },
    additionalProperties: false,
  });
  assertEquals(inputs.properties.started.type, "object");
  assertEquals(inputs.properties.started.properties.from.type, "string");
  assertEquals(inputs.properties.started.properties.to.type, "string");
  // 모든 입력의 설명은 선언의 label이다.
  assert(String(inputs.properties.q.description).includes("검색어"));
  assert(String(inputs.properties.score.description).includes("점수 범위"));
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 입력 검사는 선언과 같고 어긋난 호출은 core를 부르기 전에 거절한다", async () => {
  const box = await toolbox();
  const byStatus = nameOf(box.tools, CTX_EXPERIMENTS, "experiments_by_status");
  const onScenario = nameOf(
    box.tools,
    CTX_EXPERIMENTS,
    "experiments_on_scenario",
  );
  const find = nameOf(box.tools, CTX_EXPERIMENTS, "find_experiments");

  const bad: [string, unknown][] = [
    [byStatus, { inputs: { status: ["archived"] } }], // 선언한 enum 밖
    [byStatus, { inputs: { status: "running" } }], // many는 배열
    [byStatus, { inputs: { nope: 1 } }], // 모르는 입력
    [byStatus, { stray: true }], // 모르는 최상위 키
    [onScenario, {}], // 필수 입력 누락
    [onScenario, { inputs: {} }],
    [onScenario, { inputs: { scenario: 3 } }],
    [find, { inputs: { q: "x", score: { from: "3" } } }], // 숫자 문자열을 숫자로 바꾸지 않는다
    [find, { inputs: { q: "x", score: { min: 1 } } }],
    [find, { inputs: { q: "x", blind: "true" } }],
    [byStatus, { cursor: 12 }],
  ];
  for (const [name, input] of bad) {
    const outcome = await box.run(name, input);
    assertEquals(
      outcome.outcome,
      { kind: "failure", code: "invalid_input" },
      JSON.stringify(input),
    );
    assertEquals(outcome.executed, false);
  }
  assertEquals(box.seen, []);

  // 선언대로의 입력은 통과한다.
  const good = await box.run(find, {
    inputs: {
      q: "x",
      score: { from: 1.5 },
      started: { to: "2026-10-01" },
      blind: true,
      scenarios: ["s1"],
    },
  });
  assertEquals(good.outcome.kind, "success");
  assertEquals((await box.run(byStatus, {})).outcome.kind, "success");
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 호출은 core의 선언 검색 읽기 하나이고 결과는 행(ref·cells)·total·이어 보기를 가진 검색 page다", async () => {
  const box = await toolbox();
  const name = nameOf(box.tools, CTX_EXPERIMENTS, "experiments_by_status");
  const outcome = await box.run(name, {
    inputs: { status: ["running", "done"] },
  });

  assertEquals(box.seen.length, 1);
  const call = box.seen[0]!;
  assertEquals(call.contract, CONTEXT_SEARCH_CONTRACT);
  assertEquals(call.run, RUN);
  // 어느 context의 어느 검색인지는 tool 이름이 정한다. 모델은 context id를 입력으로 주지 않는다.
  assertEquals(call.input["context"], CTX_EXPERIMENTS);
  assertEquals(call.input["search"], "experiments_by_status");
  assertEquals(call.input["inputs"], { status: ["running", "done"] });
  assertEquals("cursor" in call.input, false);
  // 한 번에 20개 요약(R13).
  assertEquals(call.input["page_size"], 20);

  assertEquals(outcome.outcome.kind, "success");
  assertEquals(outcome.effect, "read");
  const content = outcome.result.content as Record<string, any>;
  assertEquals(content["total"], 45);
  assertEquals(content["rows"].length, 20);
  assertEquals(content["rows"][0], rowOf(1));
  assertEquals(content["next_cursor"], "20");
  assertEquals(outcome.result.complete, false);
  assertEquals(outcome.result.continuation, {
    has_more: true,
    read_next: "20",
  });
});

Deno.test("lophn-agent/harness/tools#R22 [ctx-I56]: 45개 결과는 20·20·5개로 같은 조건의 이어 보기로 중복·누락 없이 읽힌다", async () => {
  const box = await toolbox();
  const name = nameOf(box.tools, CTX_EXPERIMENTS, "experiments_by_status");
  const inputs = { status: ["running"] };
  const keys: string[] = [];
  const sizes: number[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const outcome = await box.run(
      name,
      cursor === undefined ? { inputs } : { inputs, cursor },
    );
    assertEquals(outcome.outcome.kind, "success");
    const content = outcome.result.content as Record<string, any>;
    sizes.push(content["rows"].length);
    for (const row of content["rows"]) keys.push(row.ref.key);
    if (outcome.result.continuation === null) {
      assertEquals(outcome.result.complete, true);
      assertEquals(content["next_cursor"], null);
      break;
    }
    assertEquals(outcome.result.continuation.has_more, true);
    cursor = outcome.result.continuation.read_next!;
  }
  assertEquals(sizes, [20, 20, 5]);
  assertEquals(keys.length, 45);
  assertEquals(new Set(keys).size, 45);
  // 이어 보기는 첫 호출과 같은 조건·같은 검색이다.
  assertEquals(box.seen.map((call) => call.input["inputs"]), [
    inputs,
    inputs,
    inputs,
  ]);
  assertEquals(box.seen.map((call) => call.input["cursor"]), [
    undefined,
    "20",
    "40",
  ]);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 판이 바뀌면 정의의 revision과 입력이 달라지고 이미 만든 정의는 그대로다", async () => {
  const before = await buildContextReadTools(source());
  const same = await buildContextReadTools(source());
  const revisions = (tools: ContextReadTools) =>
    tools.search.map((
      tool,
    ) => [tool.definition.name, tool.definition.revision]);
  assertEquals(revisions(same), revisions(before));

  const changed = await buildContextReadTools(source({
    selected: [
      experiments({
        bundle_hash: "c".repeat(64),
        content: experimentsContent({ statusValues: ["planned", "done"] }),
      }),
      RECIPES,
    ],
  }));
  const byStatus = (tools: ContextReadTools) =>
    tools.search.find((t) =>
      t.context === CTX_EXPERIMENTS && t.search === "experiments_by_status"
    )!;
  assertNotEquals(
    byStatus(changed).definition.revision,
    byStatus(before).definition.revision,
  );
  assertEquals(
    shape(schemaOf(byStatus(changed).definition)),
    {
      type: "object",
      properties: {
        inputs: {
          type: "object",
          properties: {
            status: {
              type: "array",
              items: { type: "string", enum: ["planned", "done"] },
            },
          },
          additionalProperties: false,
        },
        cursor: { type: "string" },
      },
      additionalProperties: false,
    },
  );
  // 먼저 만든 정의는 옛 판의 값을 그대로 가진다(진행 중인 run은 옛 정의로 계속한다).
  assertEquals(byStatus(before).bundleHash, "a".repeat(64));
  assertEquals(
    schemaOf(byStatus(before).definition).properties.inputs.properties.status
      .items.enum,
    ["planned", "running", "done"],
  );
  // 바뀌지 않은 context의 tool은 그대로다.
  const recipe = (tools: ContextReadTools) =>
    nameOf(tools, CTX_RECIPES, "experiments_by_status");
  assertEquals(recipe(changed), recipe(before));
});

// ---- R22: 개체 하나 읽기 ----

Deno.test("lophn-agent/harness/tools#R22 [ctx-I56]: 개체 읽기 tool은 context·type·key를 받아 field·관계와 이어 읽을 파일 경로·section을 돌려준다", async () => {
  const box = await toolbox();
  const definition = box.listed.find((d) => d.name === CONTEXT_ENTITY_TOOL)!;
  assertEquals(definition.effect, "read");
  assertEquals(definition.contract, CONTEXT_ENTITY_CONTRACT);
  assertEquals(shape(definition.inputSchema), {
    type: "object",
    properties: {
      context: { type: "string" },
      type: { type: "string" },
      key: { type: "string" },
    },
    required: ["context", "type", "key"],
    additionalProperties: false,
  });

  const outcome = await box.run(CONTEXT_ENTITY_TOOL, {
    context: CTX_EXPERIMENTS,
    type: "Experiment",
    key: "001",
  });
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(box.seen.length, 1);
  assertEquals(box.seen[0]!.contract, CONTEXT_ENTITY_CONTRACT);
  assertEquals(box.seen[0]!.input, {
    context: CTX_EXPERIMENTS,
    type: "Experiment",
    key: "001",
  });
  const content = outcome.result.content as Record<string, any>;
  assertEquals(content["fields"], {
    id: "001",
    status: "running",
    scenarios: ["s1", "s2"],
  });
  assertEquals(content["relations"].length, 1);
  assertEquals(content["relations"][0].name, "runs_on");
  assertEquals(content["relations"][0].targets.map((t: EntityRef) => t.key), [
    "s1",
    "s2",
  ]);
  assertEquals(content["ref"], REF_001);
  // 원문은 파일 경로로 이어 읽는다.
  assertEquals(outcome.result.source?.target, REF_001.path);

  // section이 있는 개체는 경로와 section을 함께 가리킨다.
  const sectioned = await box.run(CONTEXT_ENTITY_TOOL, {
    context: CTX_EXPERIMENTS,
    type: "Experiment",
    key: "002",
  });
  assertEquals(sectioned.result.source?.target, `${REF_001.path}#질문`);
});

Deno.test("lophn-agent/harness/tools#R22 [ctx-I56]: 없는 개체와 닿지 않는 context는 존재를 드러내지 않고 같은 not_found로 거절한다", async () => {
  const core = fakeCore();
  const box = await toolbox(
    source({ allowed: new Set([CTX_EXPERIMENTS]) }),
    core,
  );

  const missing = await box.run(CONTEXT_ENTITY_TOOL, {
    context: CTX_EXPERIMENTS,
    type: "Experiment",
    key: "999",
  });
  assertEquals(missing.outcome, { kind: "failure", code: "not_found" });

  // 범위 밖(선택 밖)·다른 project의 context는 core를 부르기 전에 같은 답이다.
  const callsBefore = box.seen.length;
  for (const context of [CTX_RECIPES, CTX_OTHER_PROJECT, id("ctx", 77)]) {
    const outcome = await box.run(CONTEXT_ENTITY_TOOL, {
      context,
      type: "Recipe",
      key: "pie",
    });
    assertEquals(outcome.outcome, { kind: "failure", code: "not_found" });
    assertEquals(outcome.result.summary, missing.result.summary);
    assertEquals(JSON.stringify(outcome.result).includes(context), false);
  }
  assertEquals(box.seen.length, callsBefore);
  assertEquals(JSON.stringify(missing.result).includes("999"), false);
});

Deno.test("lophn-agent/harness/tools#R22 [ctx-I56]: 개체 읽기 입력도 선언 밖 값과 추가 입력을 거절한다", async () => {
  const box = await toolbox();
  for (
    const input of [
      {},
      { context: CTX_EXPERIMENTS, type: "Experiment" },
      { context: CTX_EXPERIMENTS, type: "Experiment", key: 1 },
      {
        context: CTX_EXPERIMENTS,
        type: "Experiment",
        key: "001",
        path: "x.md",
      },
    ]
  ) {
    const outcome = await box.run(CONTEXT_ENTITY_TOOL, input);
    assertEquals(outcome.outcome, { kind: "failure", code: "invalid_input" });
  }
  assertEquals(box.seen, []);
});

// ---- R21: 목록에는 preset의 context 선택이 덮는 context의 tool만 든다 ----

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: listTools는 preset의 context 선택이 그 context를 덮을 때만 context 출처 tool을 목록에 둔다", async () => {
  const tools = await buildContextReadTools(source());
  const definitions = tools.search.map((tool) => tool.definition);
  const fromSource = {
    builtin: [],
    app: [],
    context: definitions,
    external: [],
  };
  const names = (listed: readonly ToolDefinition[]) =>
    listed.map((definition) => definition.name).sort();
  const all = names(definitions);

  // 이름 목록(preset·역할)이 비어도 선택이 덮으면 app command 정의처럼 들어온다.
  assertEquals(
    names(listTools(fromSource, {
      presetTools: [],
      roleTools: [],
      contexts: [CTX_EXPERIMENTS, CTX_RECIPES],
    })),
    all,
  );
  // 선택이 덮지 않는 context의 tool은 빠진다.
  const onlyRecipes = listTools(fromSource, {
    presetTools: [],
    roleTools: [],
    contexts: [CTX_RECIPES],
  });
  assertEquals(
    new Set(onlyRecipes.map((d) => d.context)),
    new Set([CTX_RECIPES]),
  );
  assertEquals(onlyRecipes.length, 1);
  // 선택이 비었거나 없거나 null이면 하나도 없다(fail closed).
  for (const contexts of [[], undefined, null]) {
    assertEquals(
      listTools(fromSource, { presetTools: [], roleTools: [], contexts }),
      [],
    );
  }
  // 역할 상한이 없으면(null) 선택이 덮어도 목록은 비어 있다.
  assertEquals(
    listTools(fromSource, {
      presetTools: [],
      roleTools: null,
      contexts: [CTX_EXPERIMENTS],
    }),
    [],
  );
  // 이름이 같은 context 정의는 먼저 온 것 하나만 남는다.
  assertEquals(
    listTools(
      {
        builtin: [],
        app: [],
        context: [...definitions, ...definitions],
        external: [],
      },
      {
        presetTools: [],
        roleTools: [],
        contexts: [CTX_EXPERIMENTS, CTX_RECIPES],
      },
    ).length,
    definitions.length,
  );
});
