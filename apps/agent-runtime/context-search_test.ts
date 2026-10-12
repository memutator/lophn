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
} from "../../packages/protocol/projects/mod.ts";
import { routePath } from "../../packages/protocol/platform/mod.ts";
import {
  CONTEXT_ENTITY_TOOL,
  executeTool,
  listTools,
  runOperations,
  SERIES_NEXT_TOOL,
  TOOL_BUNDLES,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { roleOperations } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { ROLE_CAPS } from "../../packages/lophn-agent/agents/mod.ts";
import type { CoreCall } from "./core-call.ts";
import {
  contextReadToolsFor,
  type ContextToolkit,
  createContextToolkit,
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
  // 적용된 판이 app-data로 읽는 앱(`context.list {app}`가 거른다).
  app?: string;
};

const OLD_BUNDLE = "cbn_01arz3ndektsv4rrffq69g5fa1";
const OLD_HASH = "0".repeat(64);

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
        contexts: entries.filter((e) =>
          input["project"] !== undefined
            ? e.project === input["project"]
            : e.app === input["app"]
        ).map((e) => ({
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
      // 판을 지정한 읽기는 제출된 옛 판의 내용이다(적용된 판과 다르다).
      if (input["bundle"] === OLD_BUNDLE) {
        return Promise.resolve(ok({
          as_of_seq: "5",
          next_cursor: null,
          context: entry.id,
          bundle: OLD_BUNDLE,
          bundle_hash: OLD_HASH,
          content: content("Old"),
        }));
      }
      if (input["bundle"] !== undefined) {
        return Promise.resolve(err({ code: "not_found", message: "none" }));
      }
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

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: resolved agent의 context 중 active이고 적용된 판이 있는 것만 정의 재료가 되고 초안·보관·판 없는 context는 조용히 빠진다", async () => {
  const toolkit = kit();
  const loaded = await toolkit.load({
    contexts: [
      CTX_A,
      CTX_B,
      CTX_ARCHIVED,
      CTX_DRAFT,
      CTX_NO_BUNDLE,
      "ctx_01arz3ndektsv4rrffq69g5fzz",
    ],
  });
  assertEquals(loaded.map((c) => c.id), [CTX_A, CTX_B]);
  assertEquals(loaded[0]!.bundle_hash, "a".repeat(64));
  assertEquals(loaded[0]!.title, "Recipes");
  assertEquals(loaded[0]!.content.searches[0]!.name, "all_recipes");

  // 같은 context는 한 번만 들고 순서는 agent의 순서다.
  const again = await toolkit.load({ contexts: [CTX_B, CTX_A, CTX_B] });
  assertEquals(again.map((c) => c.id), [CTX_B, CTX_A]);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: context가 없으면 정의 재료도 core 읽기도 없고 어느 project의 context인지는 agent 층이 정한 대로 읽는다", async () => {
  const toolkit = kit();
  assertEquals(await toolkit.load({ contexts: [] }), []);
  assertEquals(toolkit.seen, []);
  // agent 층이 앱을 읽는 context로 준 다른 project의 context도 그대로 읽는다.
  assertEquals(
    (await toolkit.load({ contexts: [CTX_ELSEWHERE] })).map((c) => c.id),
    [CTX_ELSEWHERE],
  );
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 고른 context의 검색 tool만 목록에 들고 개체 읽기는 agent의 tools에 이름이 있을 때 든다", async () => {
  const toolkit = kit();
  const tools = await contextReadToolsFor(toolkit, {
    contexts: [CTX_A],
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
  // 개체 읽기는 agent의 tools가 이름으로 고른다. 검색 tool은 agent의 context가 정한다.
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

  // agent에 context가 없으면 tool이 하나도 없다. context 도구 묶음이 없는 runtime도 같다.
  const empty = await contextReadToolsFor(toolkit, { contexts: [] });
  assertEquals([empty.search, empty.entity, empty.contexts], [[], null, []]);
  const none = await contextReadToolsFor(undefined, { contexts: [CTX_A] });
  assertEquals([none.search, none.entity, none.contexts], [[], null, []]);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56]: 판이 바뀌면 Run.basis의 정의 hash가 달라지고 같은 판이면 같다", async () => {
  const hashOf = async (entries: Entry[]) => {
    const tools = await contextReadToolsFor(kit(entries), {
      contexts: [CTX_A, CTX_B],
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
  const tools = await contextReadToolsFor(toolkit, { contexts: [CTX_A] });
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

Deno.test("lophn-agent/harness/tools#R21 lophn-agent/roles/app-engineer#R2 [ctx-I56b]: 앱 자리의 App Engineer가 받은 context는 다른 project에 있어도 정의 재료가 된다", async () => {
  const toolkit = kit();
  // agent 층이 담당 앱을 읽는 active context로 준 목록이다(agent-layers).
  const loaded = await toolkit.load({ contexts: [CTX_A, CTX_ELSEWHERE] });
  assertEquals(loaded.map((c) => c.id), [CTX_A, CTX_ELSEWHERE]);

  const tools = await contextReadToolsFor(toolkit, {
    contexts: [CTX_A, CTX_ELSEWHERE],
  });
  assertEquals(tools.contexts, [CTX_A, CTX_ELSEWHERE]);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56b]: 제품 toolkit은 고정한 판을 machine 자격의 context.contract {bundle}로 읽어 지금 적용된 판이 아니어도 정의를 다시 만든다", async () => {
  const core = world(ENTRIES);
  const product = createBuiltinToolkit({
    routes: [],
    machine: core.machine,
    ids: { newId: () => "x" } as never,
  });
  const pin = {
    context: CTX_A,
    bundle: OLD_BUNDLE,
    bundle_hash: OLD_HASH,
    title: "Recipes",
  };
  const loaded = await product.contexts!.loadPinned([pin]);
  assertEquals(loaded.map((c) => [c.id, c.bundle, c.bundle_hash]), [
    [CTX_A, OLD_BUNDLE, OLD_HASH],
  ]);
  assertEquals(loaded[0]!.content.searches[0]!.title, "Old");
  // 읽은 판의 hash가 고정한 값과 다르거나 읽을 수 없는 판이면 빠진다.
  assertEquals(
    await product.contexts!.loadPinned([{
      ...pin,
      bundle_hash: "f".repeat(64),
    }]),
    [],
  );
  assertEquals(
    await product.contexts!.loadPinned([{
      ...pin,
      bundle: "cbn_01arz3ndektsv4rrffq69g5fa9",
    }]),
    [],
  );
});
