// lophn-agent/harness/tools#R21, R22: 선언 검색 tool과 개체 읽기 tool을 run마다 만드는 runtime 연결이다.
// 판은 machine 자격으로 시작 전에 읽고, 호출은 agent 자격의 core route로 나간다. core는 fake다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, fingerprint, ok } from "../../packages/base/mod.ts";
import {
  bundleContentSchema,
  contextContractRoute,
  contextEntityRoute,
  contextGetRoute,
  contextListRoute,
  contextSearchRoute,
} from "../../packages/contracts/documents/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import {
  CONTEXT_ENTITY_TOOL,
  executeTool,
  listTools,
  runOperations,
  SERIES_NEXT_TOOL,
  TOOL_BUNDLES,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { roleOperations } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { ROLE_CAPS } from "../../packages/lophn-agent/presets/mod.ts";
import type { CoreCall } from "./core-call.ts";
import {
  contextReadToolsFor,
  type ContextToolkit,
  createContextToolkit,
  projectOf,
} from "./context-search.ts";
import { createBuiltinToolkit } from "./toolkit.ts";

const PRJ = "prj_01arz3ndektsv4rrffq69g5fav";
const PRJ_OTHER = "prj_01arz3ndektsv4rrffq69g5faw";
const CTX_A = "ctx_01arz3ndektsv4rrffq69g5faa";
const CTX_B = "ctx_01arz3ndektsv4rrffq69g5fab";
const CTX_DRAFT = "ctx_01arz3ndektsv4rrffq69g5fac";
const CTX_NO_BUNDLE = "ctx_01arz3ndektsv4rrffq69g5fad";
const CTX_ELSEWHERE = "ctx_01arz3ndektsv4rrffq69g5fae";
const CTX_ARCHIVED = "ctx_01arz3ndektsv4rrffq69g5faf";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";

function content(title: string) {
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
    searches: [{
      name: "all_recipes",
      title,
      inputs: [],
      query: { from: "Recipe" },
      result: { kind: "table", columns: [{ label: "요리", path: "key" }] },
    }],
  });
}

type Entry = {
  id: string;
  project: string;
  status: "drafting" | "active" | "archived";
  bundle_hash: string | null;
  title: string;
  searchTitle?: string;
};

function world(entries: Entry[]) {
  const seen: string[] = [];
  const machine: CoreCall = (path, body) => {
    seen.push(path);
    const input = body as Record<string, string | number | undefined>;
    const value = (entry: Entry) => ({
      id: entry.id,
      project: entry.project,
      title: entry.title,
      purpose: "p",
      status: entry.status,
      applied_bundle: entry.status === "active"
        ? "cbn_01arz3ndektsv4rrffq69g5fav"
        : null,
      violation_mark: 0,
      revision: "1",
    });
    if (path === routePath(contextListRoute)) {
      // 상태 필터를 일부러 무시한다: runtime이 active만 남기는지 본다.
      return Promise.resolve(ok({
        as_of_seq: "5",
        complete: true,
        next_cursor: null,
        contexts: entries.filter((e) => e.project === input["project"]).map((
          e,
        ) => ({
          ...value(e),
          applied_number: e.status === "active" ? 1 : null,
          draft_bundle: null,
          checking_bundle: null,
        })),
      }));
    }
    const entry = entries.find((e) => e.id === input["context"]);
    if (entry === undefined) {
      return Promise.resolve(err({ code: "not_found", message: "none" }));
    }
    if (path === routePath(contextGetRoute)) {
      return Promise.resolve(ok({
        as_of_seq: "5",
        next_cursor: null,
        context: value(entry),
        applied: null,
      }));
    }
    if (path === routePath(contextContractRoute)) {
      return Promise.resolve(ok({
        as_of_seq: "5",
        next_cursor: null,
        context: entry.id,
        bundle: entry.bundle_hash === null
          ? null
          : "cbn_01arz3ndektsv4rrffq69g5fav",
        bundle_hash: entry.bundle_hash,
        content: entry.bundle_hash === null
          ? null
          : content(entry.searchTitle ?? entry.title),
      }));
    }
    return Promise.resolve(err({ code: "not_found", message: "no route" }));
  };
  return { machine, seen };
}

const ENTRIES: Entry[] = [
  {
    id: CTX_A,
    project: PRJ,
    status: "active",
    bundle_hash: "a".repeat(64),
    title: "Recipes",
  },
  {
    id: CTX_B,
    project: PRJ,
    status: "active",
    bundle_hash: "b".repeat(64),
    title: "Pantry",
  },
  {
    id: CTX_DRAFT,
    project: PRJ,
    status: "drafting",
    bundle_hash: null,
    title: "Draft",
  },
  {
    id: CTX_NO_BUNDLE,
    project: PRJ,
    status: "active",
    bundle_hash: null,
    title: "Empty",
  },
  {
    id: CTX_ARCHIVED,
    project: PRJ,
    status: "archived",
    bundle_hash: "d".repeat(64),
    title: "Old",
  },
  {
    id: CTX_ELSEWHERE,
    project: PRJ_OTHER,
    status: "active",
    bundle_hash: "e".repeat(64),
    title: "Other",
  },
];

function kit(entries: Entry[] = ENTRIES): ContextToolkit & { seen: string[] } {
  const core = world(entries);
  return {
    ...createContextToolkit({
      machine: core.machine,
      contract: () => ({
        call: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
      }),
    }),
    seen: core.seen,
  };
}

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: all·project 선택은 담당 project의 active context로 풀리고 초안·보관·판 없는 context는 조용히 빠진다", async () => {
  const toolkit = kit();
  const loaded = await toolkit.load({
    project: PRJ,
    selections: [{ kind: "all", target: null }],
  });
  assertEquals(loaded.map((c) => c.id), [CTX_A, CTX_B]);
  assertEquals(loaded[0]!.bundle_hash, "a".repeat(64));
  assertEquals(loaded[0]!.title, "Recipes");
  assertEquals(loaded[0]!.content.searches[0]!.name, "all_recipes");

  // project 선택도 같은 project다. 같은 context는 한 번만 든다.
  const again = await toolkit.load({
    project: PRJ,
    selections: [
      { kind: "project", target: PRJ },
      { kind: "context", target: CTX_B },
      { kind: "all", target: null },
    ],
  });
  assertEquals(again.map((c) => c.id), [CTX_A, CTX_B]);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: project가 없으면 all은 context 0개이고 context 선택은 담당 project 밖이면 빠진다", async () => {
  const toolkit = kit();
  assertEquals(
    await toolkit.load({
      project: null,
      selections: [{ kind: "all", target: null }],
    }),
    [],
  );
  // 다른 project의 context를 골라도 담당 project 밖이면 읽지 않는다.
  assertEquals(
    (await toolkit.load({
      project: PRJ,
      selections: [{ kind: "context", target: CTX_ELSEWHERE }],
    })).length,
    0,
  );
  // project가 정해지지 않았을 때 context 선택은 그 context 하나다.
  assertEquals(
    (await toolkit.load({
      project: null,
      selections: [{ kind: "context", target: CTX_ELSEWHERE }],
    })).map((c) => c.id),
    [CTX_ELSEWHERE],
  );
  // 보관·초안·판 없는 context, 없는 context, app·document·sdk 선택은 context가 아니다.
  assertEquals(
    await toolkit.load({
      project: PRJ,
      selections: [
        { kind: "context", target: CTX_ARCHIVED },
        { kind: "context", target: CTX_DRAFT },
        { kind: "context", target: CTX_NO_BUNDLE },
        { kind: "context", target: "ctx_01arz3ndektsv4rrffq69g5fzz" },
        { kind: "app", target: "app_01arz3ndektsv4rrffq69g5fav" },
        { kind: "document", target: "doc_01arz3ndektsv4rrffq69g5fav" },
      ],
    }),
    [],
  );
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 작업 자리가 담당 범위를 넓히지 못한다", () => {
  assertEquals(
    projectOf({ kind: "project", id: PRJ } as never, {
      kind: "project",
      id: PRJ,
    }),
    PRJ,
  );
  assertEquals(
    projectOf({ kind: "project", id: PRJ } as never, { kind: "all", id: null }),
    PRJ,
  );
  assertEquals(
    projectOf({ kind: "project", id: PRJ_OTHER } as never, {
      kind: "project",
      id: PRJ,
    }),
    null,
  );
  assertEquals(
    projectOf({ kind: "global", id: null } as never, {
      kind: "project",
      id: PRJ,
    }),
    PRJ,
  );
  assertEquals(
    projectOf({ kind: "app", id: "app_01arz3ndektsv4rrffq69g5fav" } as never, {
      kind: "app",
      id: "app_01arz3ndektsv4rrffq69g5fav",
    }),
    null,
  );
});

const PLACE = { kind: "project", id: PRJ } as never;
const SCOPE = { kind: "project", id: PRJ };

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 고른 context의 검색 tool만 목록에 들고 개체 읽기는 preset·역할이 이름으로 고를 때 든다", async () => {
  const toolkit = kit();
  const tools = await contextReadToolsFor(toolkit, {
    place: PLACE,
    scope: SCOPE,
    selections: [{ kind: "context", target: CTX_A }],
  });
  assertEquals(tools.contexts, [CTX_A]);
  assertEquals(tools.search.length, 1);
  assert(tools.entity !== null);

  const source = {
    builtin: tools.entity === null ? [] : [tools.entity],
    app: [],
    context: tools.search.map((tool) => tool.definition),
    external: [],
  };
  const roleTools = ROLE_CAPS.get("operator")!.tools;
  // 개체 읽기는 preset이 이름으로 고른다. 검색 tool은 context 선택이 정한다.
  const listed = listTools(source, {
    presetTools: [CONTEXT_ENTITY_TOOL],
    roleTools,
    contexts: tools.contexts,
  });
  assertEquals(listed.length, 2);
  assert(listed.some((d) => d.name === CONTEXT_ENTITY_TOOL));
  assertEquals(
    listed.filter((d) => d.origin === "context").map((d) => d.context),
    [CTX_A],
  );
  const without = listTools(source, {
    presetTools: [],
    roleTools,
    contexts: tools.contexts,
  });
  assertEquals(without.map((d) => d.origin), ["context"]);

  // 선택한 context가 없으면 tool이 하나도 없다. context 도구 묶음이 없는 runtime도 같다.
  const empty = await contextReadToolsFor(toolkit, {
    place: PLACE,
    scope: SCOPE,
    selections: [],
  });
  assertEquals([empty.search, empty.entity, empty.contexts], [[], null, []]);
  const none = await contextReadToolsFor(undefined, {
    place: PLACE,
    scope: SCOPE,
    selections: [{ kind: "all", target: null }],
  });
  assertEquals([none.search, none.entity, none.contexts], [[], null, []]);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 판이 바뀌면 Run.basis의 정의 hash가 달라지고 같은 판이면 같다", async () => {
  const hashOf = async (entries: Entry[]) => {
    const tools = await contextReadToolsFor(kit(entries), {
      place: PLACE,
      scope: SCOPE,
      selections: [{ kind: "all", target: null }],
    });
    const listed = listTools(
      {
        builtin: tools.entity === null ? [] : [tools.entity],
        app: [],
        context: tools.search.map((tool) => tool.definition),
        external: [],
      },
      {
        presetTools: [CONTEXT_ENTITY_TOOL],
        roleTools: [CONTEXT_ENTITY_TOOL],
        contexts: tools.contexts,
      },
    );
    // prepare가 Run.basis에 싣는 값과 같은 식이다.
    return fingerprint(listed.map((tool) => [tool.name, tool.revision]));
  };
  const before = await hashOf(ENTRIES);
  assertEquals(await hashOf(ENTRIES), before);
  const changed = ENTRIES.map((e) =>
    e.id === CTX_A
      ? { ...e, bundle_hash: "f".repeat(64), searchTitle: "All" }
      : e
  );
  assertNotEquals(await hashOf(changed), before);
  // 읽을 수 없는 context가 늘거나 줄면 목록이 달라진다.
  assertNotEquals(await hashOf(ENTRIES.filter((e) => e.id !== CTX_B)), before);
});

Deno.test("lophn-agent/harness/tools#R22 [ctx-I56]: 네 역할 모두 개체 읽기를 상한에 두고 검색·개체 읽기 contract를 operation에 가진다", () => {
  assertEquals(TOOL_BUNDLES.get("context-read"), [
    CONTEXT_ENTITY_TOOL,
    SERIES_NEXT_TOOL,
  ]);
  for (
    const role of ["lophn", "app_engineer", "context_engineer", "operator"]
  ) {
    assert(ROLE_CAPS.get(role)!.tools.includes(CONTEXT_ENTITY_TOOL), role);
    const operations = roleOperations(role);
    assert(operations.includes("context.search"), role);
    assert(operations.includes("context.entity"), role);
  }
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: handler는 agent 자격의 열린 route로 검색 page 20개와 개체 하나를 읽고 열리지 않은 contract는 없는 것과 같다", async () => {
  const toolkit = kit();
  const tools = await contextReadToolsFor(toolkit, {
    place: PLACE,
    scope: SCOPE,
    selections: [{ kind: "context", target: CTX_A }],
  });
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const agent: CoreCall = (path, body) => {
    calls.push({ path, body: body as Record<string, unknown> });
    if (path === routePath(contextSearchRoute)) {
      return Promise.resolve(ok({
        as_of_seq: "5",
        complete: true,
        next_cursor: null,
        context: CTX_A,
        search: "all_recipes",
        bundle_hash: "a".repeat(64),
        total: 0,
        rows: [],
      }));
    }
    return Promise.resolve(err({ code: "not_found", message: "none" }));
  };
  // 제품 조립이 낸 묶음이 같은 연결을 쓴다. entity route는 core가 등록할 때까지 열리지 않는다.
  const product = createBuiltinToolkit({
    routes: [contextSearchRoute],
    machine: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
    ids: { newId: () => "x" } as never,
  });
  assert(product.contexts !== undefined);
  const handlers = product.contexts.handlers(tools, agent);
  const listed = [
    ...tools.search.map((tool) => tool.definition),
    ...(tools.entity === null ? [] : [tools.entity]),
  ];
  const credential = {
    run: RUN,
    targets: new Set<string>(),
    operations: new Set(runOperations(listed)),
  };
  const search = tools.search[0]!.definition.name;
  const found = await executeTool({ listed, handlers, credential }, search, {});
  assertEquals(found.outcome.kind, "success");
  assertEquals(calls.length, 1);
  assertEquals(calls[0]!.path, routePath(contextSearchRoute));
  assertEquals(calls[0]!.body, {
    context: CTX_A,
    search: "all_recipes",
    inputs: {},
    page_size: 20,
  });

  const entity = await executeTool(
    { listed, handlers, credential },
    CONTEXT_ENTITY_TOOL,
    { context: CTX_A, type: "Recipe", key: "pie" },
  );
  assertEquals(entity.outcome, { kind: "failure", code: "not_found" });
  // 열리지 않은 route는 agent 호출까지 가지 않는다.
  assertEquals(calls.length, 1);
  assertEquals(contextEntityRoute.name, "context.entity");
});
