// deno-lint-ignore-file no-explicit-any
// roles/lophn#R3, R14: 제품 runtime 조립이 lophn의 context 조회 셋(`context.list`·`context.overview`·
// `context.containing`)의 handler를 run의 agent 자격 core route에 잇고, overview 글을 prompt 자료와 같은
// 함수로 만든다. core는 fake다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import { ALL_ROUTES } from "../../../protocol/mod.ts";
import { bundleContentSchema } from "../../../protocol/projects/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  CONTEXT_LOOKUP_TOOL_NAMES,
  CONTEXT_LOOKUP_TOOLS,
  executeTool,
  runOperations,
} from "./mod.ts";
import { roleOperations } from "../run-loop/mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import { renderContextMaterial } from "../prompt-assembly/context-overview.ts";
import { createBuiltinToolkit } from "./toolkit.ts";

const PRJ = "prj_01arz3ndektsv4rrffq69g5fav";
const CTX = "ctx_01arz3ndektsv4rrffq69g5faa";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);
const N = CONTEXT_LOOKUP_TOOL_NAMES;

const CONTENT = bundleContentSchema.parse({
  schema: 1,
  contract: {
    types: [{
      name: "Recipe",
      summary: "음식 하나",
      visibility: "public",
      source: { kind: "docs", paths: ["recipes/*.md"] },
      key: "slug",
      fields: [{
        name: "slug",
        from: { kind: "path", capture: "file" },
        value_type: "string",
      }],
    }],
  },
});

const PATHS = new Map(
  [
    "project.list",
    "context.list",
    "context.get",
    "context.contract",
    "context.overview",
    "glossary.list",
    "context.containing",
  ].map((name) => {
    const route = ALL_ROUTES.find((entry) => entry.name === name);
    assert(route !== undefined, name);
    return [routePath(route), name] as const;
  }),
);

function setup() {
  const calls: { name: string; body: any }[] = [];
  const agent: CoreCall = (path, body) => {
    const name = PATHS.get(path);
    if (name === undefined) {
      return Promise.resolve(err({ code: "not_found", message: "no route" }));
    }
    calls.push({ name, body });
    const context = {
      id: CTX,
      project: PRJ,
      title: "Recipes",
      purpose: "Cook well",
      status: "active",
    };
    switch (name) {
      case "project.list":
        return Promise.resolve(ok({
          projects: [{ id: PRJ, name: "kitchen", title: "Kitchen" }],
          next_cursor: null,
        }));
      case "context.list":
        return Promise.resolve(ok({ contexts: [context], next_cursor: null }));
      case "context.get":
        return Promise.resolve(ok({ context, applied: null }));
      case "context.contract":
        return Promise.resolve(ok({
          context: CTX,
          bundle_hash: HASH,
          content: CONTENT,
        }));
      case "context.overview":
        return Promise.resolve(ok({
          context,
          bundle_hash: HASH,
          types: [{ type: "Recipe", count: 4 }],
          violation_count: 0,
        }));
      case "glossary.list":
        return Promise.resolve(ok({
          context: CTX,
          entries: [{ term: "pie", meaning: "a baked dish" }],
        }));
      default:
        return Promise.resolve(ok({
          contexts: [{ context: CTX, title: "Recipes", types: ["Recipe"] }],
        }));
    }
  };
  const toolkit = createBuiltinToolkit({
    routes: ALL_ROUTES,
    machine: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
    ids: { newId: () => "x" } as never,
  });
  const handlers = toolkit.handlers(
    { run: RUN, assignment: "asg_01arz3ndektsv4rrffq69g5fav", session: null },
    agent,
  );
  const credential = {
    run: RUN,
    targets: new Set<string>(),
    operations: new Set(runOperations(CONTEXT_LOOKUP_TOOLS)),
  };
  return {
    calls,
    run: (name: string, input: unknown) =>
      executeTool(
        { listed: CONTEXT_LOOKUP_TOOLS, handlers, credential },
        name,
        input,
      ),
  };
}

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: the product toolkit reads every project's contexts through the agent routes and no other route", async () => {
  const box = setup();
  const outcome = await box.run(N.list, {});
  assertEquals(outcome.outcome.kind, "success");
  assertEquals((outcome.result.content as any).contexts, [{
    id: CTX,
    title: "Recipes",
    purpose: "Cook well",
    project: PRJ,
    project_title: "Kitchen",
  }]);
  assertEquals(box.calls.map((call) => call.name), [
    "project.list",
    "context.list",
  ]);
});

Deno.test("lophn-agent/roles/lophn#R3 [ctx-I58g]: context.overview text is the prompt material text of the same context", async () => {
  const box = setup();
  const outcome = await box.run(N.overview, { context: CTX });
  assertEquals(outcome.outcome.kind, "success");
  const content = outcome.result.content as any;
  assertEquals(
    content.text,
    renderContextMaterial({
      context: { id: CTX, title: "Recipes" },
      bundle_hash: HASH,
      contract: CONTENT.contract,
      counts: [{ type: "Recipe", count: 4 }],
      glossary: [{ term: "pie", meaning: "a baked dish" }],
    }),
  );
  assert(content.text.startsWith(`[context] Recipes | ${CTX}`));
  assert(content.text.includes("- Recipe: 음식 하나 (4개)"));
  assert(content.text.includes("- pie: a baked dish"));
  assertEquals(content.purpose, "Cook well");
});

Deno.test("lophn-agent/roles/lophn#R14 [ctx-I58g]: context.containing goes to the agent route and only lophn's run access holds context.containing", async () => {
  const box = setup();
  const outcome = await box.run(N.containing, {
    project: PRJ,
    path: "recipes/pie.md",
  });
  assertEquals(outcome.outcome.kind, "success");
  assertEquals(box.calls.at(-1), {
    name: "context.containing",
    body: { project: PRJ, path: "recipes/pie.md" },
  });
  // lophn만 `context.containing`을 열고 조회 tool 셋을 가진다. 목록·get·overview·용어집은 모든 역할이
  // prompt의 context 자료를 읽는 읽기로 가진다(prompt-assemble#R4). 어느 context가 보이는지는 core가 정한다.
  const lookup = [
    "context.list",
    "context.overview",
    "context.containing",
    "context.get",
    "glossary.list",
  ];
  const lophn = roleOperations("lophn");
  for (const name of lookup) assert(lophn.includes(name), name);
  for (const role of ["app_engineer", "operator", "context_engineer"]) {
    const ops = roleOperations(role);
    assertEquals(ops.includes("context.containing"), false, role);
    for (const name of lookup.filter((n) => n !== "context.containing")) {
      assert(ops.includes(name), `${role} ${name}`);
    }
  }
});
