// 새 context 모델의 prompt 자료(lophn-agent/harness/prompt-assemble#R4, R5와 presets#R17)의 red test다.
// 구현은 ctx-I55가 한다. core는 `CoreCall` fake로 흉내 내고 네트워크·model은 부르지 않는다. fake의 모든
// 응답은 실제 route의 output schema로 먼저 검사해 fixture가 core의 모양과 어긋나지 않게 한다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  bundleContentSchema,
  contextContractReadSchema,
  contextContractRoute,
  contextGetReadSchema,
  contextGetRoute,
  contextListReadSchema,
  contextListRoute,
  contextOverviewReadSchema,
  contextOverviewRoute,
  glossaryListReadSchema,
  glossaryListRoute,
} from "../../../protocol/projects/mod.ts";
import { routePath } from "../../../protocol/server/mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import {
  loadContextMaterials,
  renderContextMaterial,
} from "./context-overview.ts";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const PROJECT = id("prj", 1);
const OTHER_PROJECT = id("prj", 2);
const CTX_EXPERIMENTS = id("ctx", 1);
const CTX_RECIPES = id("ctx", 2);
const CTX_OLD = id("ctx", 3);
const CTX_DRAFT = id("ctx", 4);
const CTX_FOREIGN = id("ctx", 5);
const AT = "2026-10-12T00:00:00.000Z";
const META = { as_of_seq: "9", complete: true, next_cursor: null };

// ---- fixture: 계약 ----

function experimentsContent() {
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
              values: ["planned", "running", "done"],
              required: true,
            },
            {
              name: "scenarios",
              from: { kind: "frontmatter", key: "scenarios" },
              value_type: "list",
              item_type: "string",
            },
          ],
          relations: [
            {
              name: "runs_on",
              label: "실험이 돌린 시나리오",
              to: "Scenario",
              via: "scenarios",
              cardinality: "many",
              visibility: "public",
            },
            {
              name: "graded_by",
              label: "점수를 매긴 기준표",
              to: "rubrics/Rubric",
              via: "id",
              cardinality: "optional",
            },
          ],
        },
        {
          name: "Scenario",
          summary: "에이전트가 평가받는 과제",
          visibility: "public",
          source: { kind: "docs", paths: ["eval/scenarios/*.md"] },
          key: "slug",
          fields: [
            {
              name: "slug",
              from: { kind: "path", capture: "file" },
              value_type: "string",
            },
          ],
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
        fields: [
          {
            name: "slug",
            from: { kind: "path", capture: "file" },
            value_type: "string",
          },
        ],
      }],
    },
  });
}

const EXPERIMENTS = experimentsContent();
const GOLDEN_HEAD = `[context] Experiments | ${CTX_EXPERIMENTS}`;
const GOLDEN = [
  GOLDEN_HEAD,
  "type:",
  "- Experiment: 하나의 실험 (12개)",
  "- Scenario: 에이전트가 평가받는 과제 (5개)",
  "관계:",
  "- Experiment → Scenario, 여럿: 실험이 돌린 시나리오",
  "- Experiment → rubrics/Rubric, 없거나 하나: 점수를 매긴 기준표",
  "용어집:",
  "- 시나리오: 에이전트에게 주는 평가 과제 하나",
  "- 실행: 실험이 한 번 돌아간 기록",
].join("\n");

const BASE = {
  context: { id: CTX_EXPERIMENTS, title: "Experiments" },
  bundle_hash: "a".repeat(64),
  contract: EXPERIMENTS.contract,
  counts: [{ type: "Experiment", count: 12 }, { type: "Scenario", count: 5 }],
  glossary: [
    { term: "시나리오", meaning: "에이전트에게 주는 평가 과제 하나" },
    { term: "실행", meaning: "실험이 한 번 돌아간 기록" },
  ],
};

// ---- fixture: fake core ----

type World = {
  contexts: {
    id: string;
    project: string;
    title: string;
    status: "drafting" | "active" | "archived";
    hash: string | null;
    content: ReturnType<typeof experimentsContent> | null;
    counts: { type: string; count: number }[];
    glossary: { term: string; meaning: string }[];
    broken?: boolean;
  }[];
  // 이 project 밖은 읽을 자격이 없다(forbidden).
  readable: Set<string>;
};

function world(): World {
  return {
    readable: new Set([PROJECT]),
    contexts: [
      {
        id: CTX_EXPERIMENTS,
        project: PROJECT,
        title: "Experiments",
        status: "active",
        hash: "a".repeat(64),
        content: EXPERIMENTS,
        counts: [{ type: "Experiment", count: 12 }, {
          type: "Scenario",
          count: 5,
        }],
        glossary: BASE.glossary,
      },
      {
        id: CTX_RECIPES,
        project: PROJECT,
        title: "Recipes",
        status: "active",
        hash: "b".repeat(64),
        content: recipesContent() as never,
        counts: [{ type: "Recipe", count: 3 }],
        glossary: [],
      },
      {
        id: CTX_OLD,
        project: PROJECT,
        title: "Old notes",
        status: "archived",
        hash: "c".repeat(64),
        content: recipesContent() as never,
        counts: [{ type: "Recipe", count: 1 }],
        glossary: [],
      },
      {
        id: CTX_DRAFT,
        project: PROJECT,
        title: "Drafting",
        status: "drafting",
        hash: null,
        content: null,
        counts: [],
        glossary: [],
      },
      {
        id: CTX_FOREIGN,
        project: OTHER_PROJECT,
        title: "Foreign",
        status: "active",
        hash: "d".repeat(64),
        content: recipesContent() as never,
        counts: [{ type: "Recipe", count: 9 }],
        glossary: [],
      },
    ],
  };
}

const READ_PATHS = new Set([
  routePath(contextListRoute),
  routePath(contextGetRoute),
  routePath(contextContractRoute),
  routePath(contextOverviewRoute),
  routePath(glossaryListRoute),
]);

function valueOf(item: World["contexts"][number], revision = "3") {
  return {
    id: item.id,
    project: item.project,
    title: item.title,
    purpose: `${item.title} purpose`,
    status: item.status,
    applied_bundle: item.hash === null ? null : id("cbn", 1),
    violation_mark: 0,
    revision,
  };
}

function core(state: World) {
  const paths: string[] = [];
  const call: CoreCall = (path, body): Promise<Result<unknown>> => {
    paths.push(path);
    const request = body as Record<string, unknown>;
    const found = state.contexts.find((item) => item.id === request["context"]);
    const hidden = found !== undefined && !state.readable.has(found.project);
    const missing = (): Promise<Result<unknown>> =>
      Promise.resolve(err({ code: "not_found", message: "no such target" }));
    if (path === routePath(contextListRoute)) {
      const project = request["project"] as string;
      if (!state.readable.has(project)) {
        return Promise.resolve(
          err({ code: "forbidden", message: "out of scope" }),
        );
      }
      const status = request["status"] as string | undefined;
      const shown = state.contexts
        .filter((item) => item.project === project)
        .filter((item) =>
          status === "all"
            ? true
            : status === undefined
            ? item.status !== "archived"
            : item.status === status
        )
        .sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
      return Promise.resolve(ok(contextListReadSchema.parse({
        ...META,
        contexts: shown.map((item) => ({
          ...valueOf(item),
          applied_number: item.hash === null ? null : 1,
          draft_bundle: null,
          checking_bundle: null,
        })),
      })));
    }
    if (found === undefined || hidden) return missing();
    if (found.broken) {
      return Promise.resolve(
        err({ code: "unavailable", message: "read failed" }),
      );
    }
    if (path === routePath(contextGetRoute)) {
      return Promise.resolve(ok(contextGetReadSchema.parse({
        ...META,
        context: valueOf(found),
        applied: found.hash === null ? null : {
          id: id("cbn", 1),
          context: found.id,
          number: 1,
          parent: null,
          bundle_hash: found.hash,
          status: "applied",
          check: id("chk", 1),
          created_by: `agent:${id("asg", 1)}`,
          revision: "4",
        },
      })));
    }
    if (path === routePath(contextContractRoute)) {
      return Promise.resolve(ok(contextContractReadSchema.parse({
        ...META,
        context: found.id,
        bundle: found.hash === null ? null : id("cbn", 1),
        bundle_hash: found.hash,
        content: found.content,
      })));
    }
    if (path === routePath(contextOverviewRoute)) {
      return Promise.resolve(ok(contextOverviewReadSchema.parse({
        ...META,
        context: valueOf(found),
        bundle_hash: found.hash,
        types: found.counts,
        violation_count: 0,
      })));
    }
    if (path === routePath(glossaryListRoute)) {
      return Promise.resolve(ok(glossaryListReadSchema.parse({
        ...META,
        context: found.id,
        entries: found.glossary.map((entry, index) => ({
          id: id("trm", index + 1),
          context: found.id,
          term: entry.term,
          meaning: entry.meaning,
          set_by: "user",
          updated_at: AT,
          revision: "2",
        })),
      })));
    }
    return Promise.resolve(
      err({ code: "not_found", message: "no such route" }),
    );
  };
  return { call, paths };
}

function ids(set: { materials: readonly { context: string }[] }): string[] {
  return set.materials.map((material) => material.context);
}

// ---- R4: 모양 ----

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: 자료는 머리에 context 이름과 id, 이어서 type·뜻·개수와 관계와 용어집이다", () => {
  const text = renderContextMaterial(BASE);
  assertEquals(text, GOLDEN);
  assertEquals(text.split("\n")[0], GOLDEN_HEAD);
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: 관점·watch·변경됨 표시와 검색 결과·검색 선언·개체 field·문서 경로가 자료에 없다", () => {
  const text = renderContextMaterial(BASE);
  for (
    const forbidden of [
      "basis",
      "reference",
      "watch",
      "perspective",
      "기준 자료",
      "참고",
      "변경됨",
      "experiments_by_status",
      "상태별 실험",
      "eval/experiments",
      "frontmatter",
      "status",
      "planned",
    ]
  ) {
    assert(!text.includes(forbidden), `material must not carry ${forbidden}`);
  }
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: 개수는 type 순서를 따르는 계약 순서로 쓰고 빠진 type은 0개이며 관계·용어집이 없으면 없음이라 쓴다", () => {
  const shuffled = renderContextMaterial({
    ...BASE,
    counts: [{ type: "Scenario", count: 5 }, { type: "Experiment", count: 12 }],
  });
  assertEquals(shuffled, GOLDEN);

  const missing = renderContextMaterial({
    ...BASE,
    counts: [{ type: "Scenario", count: 5 }],
  });
  assert(missing.includes("- Experiment: 하나의 실험 (0개)"));

  const recipes = renderContextMaterial({
    context: { id: CTX_RECIPES, title: "Recipes" },
    bundle_hash: "b".repeat(64),
    contract: recipesContent().contract,
    counts: [{ type: "Recipe", count: 3 }],
    glossary: [],
  });
  assertEquals(
    recipes,
    [
      `[context] Recipes | ${CTX_RECIPES}`,
      "type:",
      "- Recipe: 요리 하나 (3개)",
      "관계: 없음",
      "용어집: 없음",
    ].join("\n"),
  );
});

// ---- R5: byte 같음 ----

Deno.test("lophn-agent/harness/prompt-assemble#R5 [ctx-I55]: 같은 판과 같은 시작 개수는 입력 객체가 달라도 byte가 같고 개수가 바뀌면 그 줄만 달라진다", () => {
  const first = renderContextMaterial(BASE);
  const copy = renderContextMaterial(JSON.parse(JSON.stringify(BASE)));
  assertEquals(copy, first);

  const grown = renderContextMaterial({
    ...BASE,
    counts: [{ type: "Experiment", count: 13 }, { type: "Scenario", count: 5 }],
  });
  const before = first.split("\n");
  const after = grown.split("\n");
  assertEquals(after.length, before.length);
  assertEquals(
    after.flatMap((line, index) => line === before[index] ? [] : [line]),
    ["- Experiment: 하나의 실험 (13개)"],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R5 [ctx-I55]: 용어집은 core가 준 순서를 그대로 쓰고 다시 정렬하지 않는다", () => {
  const reversed = renderContextMaterial({
    ...BASE,
    glossary: [...BASE.glossary].reverse(),
  });
  assert(reversed.indexOf("- 실행:") < reversed.indexOf("- 시나리오:"));
  assertNotEquals(reversed, GOLDEN);
});

Deno.test("lophn-agent/harness/prompt-assemble#R5 [ctx-I55]: 로드한 자료의 본문은 같은 판과 같은 개수에서 렌더 결과와 byte가 같고 두 번 읽어도 같다", async () => {
  const state = world();
  const contexts = [CTX_EXPERIMENTS, CTX_RECIPES];
  const first = await loadContextMaterials(core(state).call, { contexts });
  const second = await loadContextMaterials(core(state).call, { contexts });
  assertEquals(second, first);
  const experiments = first.materials.find((m) =>
    m.context === CTX_EXPERIMENTS
  );
  assert(experiments !== undefined);
  assertEquals(experiments.text, GOLDEN);
  assertEquals(experiments.title, "Experiments");
  assertEquals(experiments.bundle_hash, "a".repeat(64));
  assertEquals(first.omitted, []);
});

Deno.test("lophn-agent/harness/prompt-assemble#R5 [ctx-I55]: 새 판이 적용되면 다음 run부터 새 hash와 새 계약의 자료가 쓰이고 개수만 바뀌면 hash는 그대로다", async () => {
  const state = world();
  const contexts = [CTX_EXPERIMENTS];
  const before = await loadContextMaterials(core(state).call, { contexts });

  const experiments = state.contexts[0]!;
  experiments.counts = [{ type: "Experiment", count: 99 }, {
    type: "Scenario",
    count: 5,
  }];
  const grown = await loadContextMaterials(core(state).call, { contexts });
  assertEquals(
    grown.materials[0]!.bundle_hash,
    before.materials[0]!.bundle_hash,
  );
  assertNotEquals(grown.materials[0]!.text, before.materials[0]!.text);
  // 이미 읽은 자료는 파일이 바뀌어도 바뀌지 않는다.
  assertEquals(before.materials[0]!.text, GOLDEN);

  experiments.hash = "e".repeat(64);
  experiments.content = recipesContent() as never;
  experiments.counts = [{ type: "Recipe", count: 2 }];
  const replaced = await loadContextMaterials(core(state).call, { contexts });
  assertEquals(replaced.materials[0]!.bundle_hash, "e".repeat(64));
  assert(replaced.materials[0]!.text.includes("- Recipe: 요리 하나 (2개)"));
  assert(!replaced.materials[0]!.text.includes("- Experiment:"));
});

Deno.test("lophn-agent/harness/prompt-assemble#R5 [ctx-I55]: resolved agent의 context에 같은 context가 여러 번 있어도 자료는 한 번만 들어가고 순서는 agent의 순서다", async () => {
  const state = world();
  const set = await loadContextMaterials(core(state).call, {
    contexts: [CTX_RECIPES, CTX_EXPERIMENTS, CTX_RECIPES],
  });
  assertEquals(ids(set), [CTX_RECIPES, CTX_EXPERIMENTS]);
});

// ---- agents#R15, R16: 자료는 resolved agent의 context만이다 ----

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: resolved agent의 context마다 머리에 이름과 id가 있고 읽기 route만 부른다", async () => {
  const fake = core(world());
  const set = await loadContextMaterials(fake.call, {
    contexts: [CTX_EXPERIMENTS, CTX_RECIPES],
  });
  assertEquals(ids(set), [CTX_EXPERIMENTS, CTX_RECIPES]);
  for (const material of set.materials) {
    assertEquals(
      material.text.split("\n")[0],
      `[context] ${material.title} | ${material.context}`,
    );
  }
  // 읽기만 한다. 어느 context인지는 agent 층이 정했으므로 목록은 읽지 않는다.
  for (const path of fake.paths) assert(READ_PATHS.has(path), path);
  assert(!fake.paths.includes(routePath(contextListRoute)));
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: 읽을 자격이 없는 project의 context는 아무것도 드러내지 않고 빠진다", async () => {
  const foreign = await loadContextMaterials(core(world()).call, {
    contexts: [CTX_FOREIGN],
  });
  assertEquals(foreign.materials, []);
  assertEquals(JSON.stringify(foreign).includes("Foreign"), false);
});

Deno.test("lophn-agent/harness/prompt-assemble#R5 [ctx-I55]: context를 보관하면 다음 run부터 자료에서 빠진다", async () => {
  const state = world();
  const contexts = [CTX_EXPERIMENTS, CTX_RECIPES];
  assertEquals(
    ids(await loadContextMaterials(core(state).call, { contexts })),
    [CTX_EXPERIMENTS, CTX_RECIPES],
  );
  state.contexts.find((item) => item.id === CTX_RECIPES)!.status = "archived";
  assertEquals(
    ids(await loadContextMaterials(core(state).call, { contexts })),
    [CTX_EXPERIMENTS],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: 보관된 context와 초안 context와 없는 context는 자료가 없다", async () => {
  const state = world();
  const picked = await loadContextMaterials(core(state).call, {
    contexts: [CTX_RECIPES],
  });
  assertEquals(ids(picked), [CTX_RECIPES]);

  const gone = await loadContextMaterials(core(state).call, {
    contexts: [CTX_OLD, CTX_DRAFT],
  });
  assertEquals(gone.materials, []);
  // 보관·초안은 읽지 못한 것이 아니라서 이유 줄도 남기지 않는다.
  assertEquals(gone.omitted, []);
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: 계약을 읽을 수 없는 context는 부분 자료 없이 통째로 빠지고 나머지는 남는다", async () => {
  const state = world();
  state.contexts[0]!.broken = true;
  const set = await loadContextMaterials(core(state).call, {
    contexts: [CTX_EXPERIMENTS, CTX_RECIPES],
  });
  assertEquals(ids(set), [CTX_RECIPES]);
  assertEquals(set.omitted.map((item) => item.context), [CTX_EXPERIMENTS]);
});

Deno.test("lophn-agent/harness/prompt-assemble#R4 [ctx-I55]: resolved agent에 context가 없으면 자료 0개이고 core를 부르지 않는다", async () => {
  const fake = core(world());
  const set = await loadContextMaterials(fake.call, { contexts: [] });
  assertEquals(set.materials, []);
  assertEquals(set.omitted, []);
  assertEquals(fake.paths, []);
});
