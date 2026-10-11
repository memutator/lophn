// deno-lint-ignore-file no-explicit-any
// lophn-agent/harness/tools#R23, R24 연결: 미리보기의 20개 보기, 읽기 묶음, handler 묶음. 보호된
// `context-engineer-tools_test.ts`가 다루지 않는 연결만 시험한다. core는 `ContractCall` fake다.
import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  CONTEXT_ENGINEER_TOOL_NAMES,
  CONTEXT_ENGINEER_TOOLS,
  CONTEXT_PREVIEW_CONTRACT,
  createBuiltinToolHandlers,
  createContextReadToolHandlers,
  executeTool,
  runOperations,
  SERIES_NEXT_TOOL,
  TOOL_BUNDLES,
} from "./mod.ts";

const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const BUNDLE = "cbn_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";

function violation(index: number) {
  return {
    kind: "rule",
    rule: "Recipe.title-required",
    type: "Recipe",
    path: `recipes/r${String(index).padStart(2, "0")}.md`,
    section: null,
    target: null,
    message: "Every recipe has a title",
  };
}

// 미리보기 route는 30개씩 page를 준다. 두 page, 30개와 5개다.
function previewCore() {
  const seen: Record<string, unknown>[] = [];
  const ports = {
    call(contract: string, input: unknown): Promise<Result<unknown>> {
      assertEquals(contract, CONTEXT_PREVIEW_CONTRACT);
      const body = input as { cursor?: string };
      seen.push(body);
      const second = body.cursor === "page2";
      const rows = Array.from(
        { length: second ? 5 : 30 },
        (_, i) => violation(second ? 30 + i : i),
      );
      return Promise.resolve(ok({
        as_of_seq: "9",
        complete: second,
        next_cursor: second ? null : "page2",
        context: CTX,
        bundle: BUNDLE,
        types: [{ type: "Recipe", count: 35 }],
        violation_count: 35,
        violations: rows,
        findings: [],
      }));
    },
  };
  return { seen, ports };
}

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: 미리보기는 core가 30개를 줘도 20개씩 보이고 잃는 항목 없이 이어 읽는다", async () => {
  const core = previewCore();
  const handlers = createBuiltinToolHandlers({
    ...core.ports,
    newId: () => "x",
    runFacts: () => Promise.reject(new Error("unused")),
  } as never);
  const listed = CONTEXT_ENGINEER_TOOLS;
  const credential = {
    run: RUN,
    targets: new Set<string>(),
    operations: new Set(runOperations(listed)),
  };
  const run = (input: unknown) =>
    executeTool(
      { listed, handlers, credential },
      CONTEXT_ENGINEER_TOOL_NAMES.preview,
      input,
    );

  const seenPaths: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const reply = await run({
      context: CTX,
      bundle: BUNDLE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    assertEquals(reply.outcome.kind, "success");
    const content = reply.result.content as Record<string, any>;
    assert(content["violations"].length <= 20);
    for (const row of content["violations"]) seenPaths.push(row.path);
    const next = reply.result.continuation;
    if (next === null) {
      assertEquals(reply.result.complete, true);
      break;
    }
    assertEquals(reply.result.complete, false);
    cursor = next.read_next ?? undefined;
  }
  // 35개를 20, 10, 5로 한 번씩 읽었다.
  assertEquals(seenPaths.length, 35);
  assertEquals(new Set(seenPaths).size, 35);
  // 둘째 읽기는 같은 core page의 뒤 위치이고 core에는 첫 page의 cursor(없음)로 간다.
  assertEquals(core.seen, [
    { context: CTX, bundle: BUNDLE },
    { context: CTX, bundle: BUNDLE },
    { context: CTX, bundle: BUNDLE, cursor: "page2" },
  ]);
});

Deno.test("lophn-agent/harness/tools#R24 [ctx-I58d]: 다음 이름 읽기는 읽기 묶음에 들고 Context Engineer 일곱 동작은 자기 묶음 하나에만 있다", () => {
  assert(TOOL_BUNDLES.get("context-read")!.includes(SERIES_NEXT_TOOL));
  const names = Object.values(CONTEXT_ENGINEER_TOOL_NAMES);
  assertEquals(TOOL_BUNDLES.get("context-engineer"), names);
  for (const [bundle, tools] of TOOL_BUNDLES) {
    if (bundle === "context-engineer") continue;
    for (const name of names) {
      assert(!tools.includes(name), `${name} is in the ${bundle} bundle`);
    }
  }
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: 내장 목록에 같은 이름이 둘 없고 내장 handler 묶음은 Context Engineer tool을 모두 가지며 다음 이름 handler는 선택한 context 읽기 묶음에서만 온다", () => {
  const names = BUILTIN_TOOLS.map((tool) => tool.name);
  assertEquals(new Set(names).size, names.length);
  const handlers = createBuiltinToolHandlers({
    call: () => Promise.resolve(ok({})),
    newId: () => "x",
    runFacts: () => Promise.reject(new Error("unused")),
  } as never);
  for (const name of Object.values(CONTEXT_ENGINEER_TOOL_NAMES)) {
    assert(handlers.has(name), name);
  }
  // 선택 밖 context를 거절하는 handler라서 선택을 아는 묶음만 만든다. 선택이 비어도 있다.
  assert(!handlers.has(SERIES_NEXT_TOOL));
  const selected = createContextReadToolHandlers(
    { search: [], entity: null, contexts: [] },
    { call: () => Promise.resolve(ok({})) },
  );
  assert(selected.has(SERIES_NEXT_TOOL));
});
