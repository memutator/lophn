// lophn-agent/harness/tools#R23, R24와 lophn-agent/roles/context-engineer#R8, R11: Context Engineer의 쓰기 tool과
// 다음 이름 읽기 tool을 runtime이 agent 자격의 core route에 잇는 연결이다. core는 fake다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { ALL_ROUTES } from "../../packages/contracts/mod.ts";
import {
  contextCreateRoute,
  contextDraftRoute,
  contextPreviewRoute,
  contextSeriesNextRoute,
} from "../../packages/contracts/documents/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import { roleOperations } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  BUILTIN_TOOLS,
  CONTEXT_ENGINEER_TOOL_NAMES,
  executeTool,
  runOperations,
  SERIES_NEXT_TOOL,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { builtinBinding } from "./builtin-binding.ts";
import type { CoreCall } from "./core-call.ts";
import { createBuiltinToolkit } from "./toolkit.ts";

const CTX = "ctx_01arz3ndektsv4rrffq69g5fav";
const BUNDLE = "cbn_01arz3ndektsv4rrffq69g5fav";
const ENTRY = "trm_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const ASSIGNMENT = "asg_01arz3ndektsv4rrffq69g5fav";
const CALL = "tcl_01arz3ndektsv4rrffq69g5fav";
const N = CONTEXT_ENGINEER_TOOL_NAMES;

const ENGINEER_ONLY = [
  "context.create",
  "bundle.save_draft",
  "bundle.submit",
  "glossary.set",
  "glossary.remove",
  "glossary.remove",
  "context.draft",
  "context.preview",
  "context.contract",
  "context.violations",
  "glossary.list",
];

// lophn의 context 조회(`context.overview`)가 같은 자격으로 함께 읽는 두 읽기다. 읽기만 하므로 lophn도 연다.
const LOPHN_LOOKUP_READS = new Set(["context.contract", "glossary.list"]);

function definitionOf(name: string) {
  const found = BUILTIN_TOOLS.find((tool) => tool.name === name);
  assert(found !== undefined, name);
  return found;
}

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: Context Engineer만 context 생성·계약·초안·제출·용어집 contract를 operation에 가지고 네 역할 모두 다음 이름 contract를 가진다", () => {
  const engineer = roleOperations("context_engineer");
  for (const contract of ENGINEER_ONLY) {
    assert(engineer.includes(contract), contract);
  }
  for (const role of ["lophn", "app_engineer", "operator"]) {
    const operations = roleOperations(role);
    for (const contract of ENGINEER_ONLY) {
      if (role === "lophn" && LOPHN_LOOKUP_READS.has(contract)) continue;
      assert(!operations.includes(contract), `${role} may call ${contract}`);
    }
  }
  for (
    const role of ["lophn", "app_engineer", "context_engineer", "operator"]
  ) {
    assert(roleOperations(role).includes("context.series_next"), role);
  }
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: 쓰기 tool은 입력에서 정확한 대상을 읽고 비교 기준을 판정에 싣는다", async () => {
  const reads: { contract: string; input: unknown }[] = [];
  const run = {
    call(contract: string, input: unknown): Promise<Result<unknown>> {
      reads.push({ contract, input });
      return Promise.resolve(ok({}));
    },
    reach: new Set<string>(),
    run: RUN,
    assignment: ASSIGNMENT,
  };
  const resolve = async (name: string, input: unknown) => {
    const binding = builtinBinding(definitionOf(name), run);
    assert(binding !== undefined, name);
    return await binding.resolve(input, { run: RUN, toolCall: CALL });
  };

  const draft = await resolve(N.draft, {
    context: CTX,
    bundle: BUNDLE,
    base_revision: "3",
    content: {},
  });
  assert(draft.ok);
  assertEquals(draft.value.concern, "documents/contexts");
  assertEquals(draft.value.operation, "bundle.save_draft");
  assertEquals(draft.value.targets.map((t) => t.id), [CTX]);
  assertEquals(draft.value.comparison, { base_revision: "3" });
  assertEquals(reads, [{ contract: "context.draft", input: { context: CTX } }]);

  const fresh = await resolve(N.draft, { context: CTX, content: {} });
  assert(fresh.ok);
  assertEquals(fresh.value.comparison, {});

  // context 생성은 project가 대상이고 비교 기준이 없다.
  reads.length = 0;
  const create = await resolve(N.create, {
    project: PROJECT,
    title: "Recipes",
    purpose: "Keep recipes",
  });
  assert(create.ok);
  assertEquals(create.value.concern, "documents/contexts");
  assertEquals(create.value.operation, "context.create");
  assertEquals(create.value.targets.map((t) => t.id), [PROJECT]);
  assertEquals(create.value.changes, "creates a context titled Recipes");
  assertEquals(reads, []);

  const submit = await resolve(N.submit, { bundle: BUNDLE });
  assert(submit.ok);
  assertEquals(submit.value.targets.map((t) => t.id), [BUNDLE]);

  reads.length = 0;
  const added = await resolve(N.glossaryWrite, {
    context: CTX,
    term: "pie",
    meaning: "baked",
  });
  assert(added.ok);
  assertEquals(added.value.concern, "documents/terms");
  assertEquals(added.value.targets.map((t) => t.id), [CTX]);
  assertEquals(reads, [{ contract: "glossary.list", input: { context: CTX } }]);

  reads.length = 0;
  const changed = await resolve(N.glossaryWrite, {
    entry: ENTRY,
    meaning: "x",
    base_revision: "2",
  });
  assert(changed.ok);
  assertEquals(changed.value.targets.map((t) => t.id), [ENTRY]);
  assertEquals(changed.value.comparison, { base_revision: "2" });
  assertEquals(reads, []);

  const removed = await resolve(N.glossaryWrite, {
    entry: ENTRY,
    base_revision: "2",
    remove: true,
  });
  assert(removed.ok);
  assertEquals(removed.value.changes, "removes a glossary entry");
  assertEquals(removed.value.comparison, { base_revision: "2" });

  // 읽어 볼 수 없는 context는 없는 대상과 같은 답이다.
  const hidden = builtinBinding(definitionOf(N.draft), {
    ...run,
    call: () => Promise.resolve(err({ code: "not_found", message: "none" })),
  })!;
  const refused = await hidden.resolve({ context: CTX, content: {} }, {
    run: RUN,
    toolCall: CALL,
  });
  assertEquals(!refused.ok && refused.error.code, "not_found");

  // 읽기 tool에는 연결이 없다.
  assertEquals(
    builtinBinding(definitionOf(N.readContract), run),
    undefined,
  );
  assertEquals(builtinBinding(definitionOf(SERIES_NEXT_TOOL), run), undefined);
});

Deno.test("lophn-agent/harness/tools#R23 [ctx-I57]: 제품 조립의 handler는 agent 자격의 열린 route로 보내고 아직 열리지 않은 미리보기는 not_found로 끝난다", async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const agent: CoreCall = (path, body) => {
    calls.push({ path, body: body as Record<string, unknown> });
    if (path === routePath(contextDraftRoute)) {
      return Promise.resolve(ok({
        as_of_seq: "5",
        complete: true,
        next_cursor: null,
        context: CTX,
        draft: null,
      }));
    }
    if (path === routePath(contextSeriesNextRoute)) {
      return Promise.resolve(ok({
        as_of_seq: "5",
        complete: true,
        next_cursor: null,
        context: CTX,
        type: "Daily",
        pattern: "daily/note-{n:3}.md",
        next: {
          key: "004",
          path: "daily/note-004.md",
          from: "daily/note-003.md",
          complete: true,
          taken: false,
        },
      }));
    }
    return Promise.resolve(ok({ saved: true, id: BUNDLE }));
  };
  const toolkit = createBuiltinToolkit({
    routes: ALL_ROUTES,
    machine: () => Promise.resolve(err({ code: "unavailable", message: "x" })),
    ids: { newId: () => "x" } as never,
  });
  const handlers = new Map([
    ...toolkit.handlers(
      { run: RUN, assignment: ASSIGNMENT, session: null },
      agent,
    ),
    // 다음 이름 읽기는 선택한 context의 읽기 묶음이 낸다.
    ...toolkit.contexts!.handlers(
      { search: [], entity: null, contexts: [CTX] },
      agent,
    ),
  ]);
  const listed = BUILTIN_TOOLS.filter((tool) =>
    tool.name === SERIES_NEXT_TOOL ||
    Object.values(N).includes(tool.name as never)
  );
  assertEquals(listed.length, 9);
  const credential = {
    run: RUN,
    targets: new Set<string>(),
    operations: new Set(runOperations(listed)),
    call: CALL,
  };
  const run = (name: string, input: unknown) =>
    executeTool({ listed, handlers, credential }, name, input);

  const draft = await run(N.readContract, { context: CTX });
  assertEquals(draft.outcome.kind, "success");
  assertEquals(calls.at(-1)!.path, routePath(contextDraftRoute));

  const next = await run(SERIES_NEXT_TOOL, { context: CTX, type: "Daily" });
  assertEquals(next.outcome.kind, "success");
  assertEquals(calls.at(-1)!.path, routePath(contextSeriesNextRoute));
  assertEquals(calls.at(-1)!.body, { context: CTX, type: "Daily" });

  // 쓰기는 command 몸통으로 간다: 입력, 최초 ToolCall ID가 idempotency key, 읽은 revision이 비교 기준이다.
  const saved = await run(N.draft, {
    context: CTX,
    bundle: BUNDLE,
    base_revision: "3",
    content: { schema: 1 },
  });
  assertEquals(saved.outcome.kind, "success");
  assertEquals(calls.at(-1)!.body, {
    input: { context: CTX, bundle: BUNDLE, content: { schema: 1 } },
    idempotency_key: CALL,
    compare: { base_revision: "3" },
    prepared: [],
  });

  // context 생성은 command 몸통으로 가고 id는 최초 ToolCall ID에서 정해진다.
  const created = await run(N.create, {
    project: PROJECT,
    title: "Recipes",
    purpose: "Keep recipes",
  });
  assertEquals(created.outcome.kind, "success");
  assertEquals(calls.at(-1)!.path, routePath(contextCreateRoute));
  const sent = calls.at(-1)!.body as {
    input: Record<string, string>;
    idempotency_key: string;
  };
  assert(/^ctx_[0-9a-hjkmnp-tv-z]{26}$/.test(sent["input"]["id"]));
  assertEquals(sent["input"], {
    id: sent["input"]["id"],
    project: PROJECT,
    title: "Recipes",
    purpose: "Keep recipes",
  });
  assertEquals(sent["idempotency_key"], CALL);

  // 미리보기 route는 core가 등록할 때까지 열리지 않아 agent 호출까지 가지 않는다.
  const before = calls.length;
  const preview = await run(N.preview, { context: CTX, bundle: BUNDLE });
  assertEquals(preview.outcome, { kind: "failure", code: "not_found" });
  assertEquals(calls.length, before);
  assertEquals(contextPreviewRoute.name, "context.preview");
});
