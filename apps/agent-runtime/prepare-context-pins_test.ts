// lophn-agent/harness/tools#R21: 선언 검색 tool은 run이 시작할 때 고정한 판으로 만든 정의를 resume 뒤에도 쓴다.
// core는 fake다: 가짜 core(testing/world.ts)가 agent·session·run을 답하고 이 시험이 context 읽기와 run 기준
// blob만 더한다. model·네트워크는 부르지 않는다. 읽을 context는 resolved agent의 context(Operator의 정의가
// 고른 context)다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { z } from "zod";
import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  systemClock,
} from "../../packages/base/mod.ts";
import {
  bundleContentSchema,
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  contextOverviewRoute,
  glossaryListRoute,
} from "../../packages/protocol/projects/mod.ts";
import {
  modelCallList,
  recoverRun,
  runBody,
  runRead,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { eventsList, routePath } from "../../packages/protocol/platform/mod.ts";
import type { CoreCall } from "./core-call.ts";
import {
  type ContextBundleReader,
  contextBundleReader,
  createContextToolkit,
} from "./context-search.ts";
import { createRunPreparer } from "./prepare.ts";
import { productToolkit } from "./product-driver.ts";
import {
  ASG,
  AT,
  HASH,
  MODEL,
  MSG,
  openWorld,
  PRJ,
  RUN,
} from "./testing/world.ts";

const CTX = "ctx_01arz3ndektsv4rrffq69g5faa";
const BUNDLE_1 = "cbn_01arz3ndektsv4rrffq69g5fa1";
const BUNDLE_2 = "cbn_01arz3ndektsv4rrffq69g5fa2";
const HASH_1 = "a1".repeat(32);
const HASH_2 = "a2".repeat(32);
const META = { as_of_seq: "5", next_cursor: null };

function content(searchTitle: string, summary = "요리 하나") {
  return bundleContentSchema.parse({
    schema: 1,
    contract: {
      types: [{
        name: "Recipe",
        summary,
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
      title: searchTitle,
      inputs: [],
      query: { from: "Recipe" },
      result: { kind: "table", columns: [{ label: "요리", path: "key" }] },
    }],
  });
}

type Applied = { bundle: string; hash: string; content: unknown } | null;

// 시험이 바꾸는 core의 context 한 개와 run이 고정한 blob. 읽을 context는 Operator의 정의가 고른 이 하나다.
function scene() {
  const state = {
    status: "active" as "active" | "archived",
    applied: {
      bundle: BUNDLE_1,
      hash: HASH_1,
      content: content("First"),
    } as Applied,
    runState: "running" as "accepted" | "running",
    startScope: null as unknown,
    // 적용된 판이 바뀐 뒤에도 id로 읽는 제출된 판들이다(`context.contract {bundle}`).
    history: new Map<string, { hash: string; content: unknown }>(),
    // `context.contract`를 부른 입력 기록이다.
    contractCalls: [] as Record<string, unknown>[],
  };
  const base = openWorld({
    role: "operator",
    session: null,
    workspaceModels: { operator: MODEL() },
    definition: { name: "Recipes", contexts: [CTX], body: "" },
    activeContexts: [CTX],
  });
  // run이 고정한 blob(목적별 마지막 값)이다. resume은 이것을 읽는다.
  const blobs = new Map<string, unknown>();
  const reply = (schema: z.ZodType, value: unknown) => {
    const parsed = schema.safeParse(value);
    return Promise.resolve(
      parsed.success
        ? ok(value)
        : err({ code: "internal" as const, message: parsed.error.message }),
    );
  };
  const contextValue = () => ({
    id: CTX,
    project: PRJ,
    title: "Recipes",
    purpose: "p",
    status: state.status,
    applied_bundle: state.status === "active"
      ? state.applied?.bundle ?? null
      : null,
    violation_mark: 0,
    revision: "1",
  });
  const machine: CoreCall = (path, body) => {
    const input = body as Record<string, unknown>;
    if (path === routePath(runRead)) {
      return reply(runRead.output, {
        run: {
          id: RUN,
          assignment: ASG,
          session: null,
          source: { kind: "message", message: MSG },
          continued_from: null,
          start_after: null,
          start_confirmed_seq: null,
          state: state.runState,
          basis: state.runState === "running" ? HASH : null,
          waiting_on: null,
          started_at: state.runState === "running" ? AT : null,
          limits: {
            model_attempts: 30,
            stall_ms: 300_000,
            active_ms: 1_800_000,
          },
          elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
          finished_at: null,
          outcome: null,
          result: null,
          state_seq: "1",
          accepted_seq: "1",
        },
        ...META,
      });
    }
    if (path === routePath(runBody)) {
      const kind = String(input["kind"]);
      const stored = blobs.get(kind);
      if (stored === undefined) {
        return Promise.resolve(err({ code: "not_found", message: "no blob" }));
      }
      return reply(runBody.output, {
        kind,
        id: RUN,
        run: RUN,
        hash: HASH,
        size_bytes: JSON.stringify(stored).length,
        value: stored,
        ...META,
      });
    }
    if (path === routePath(contextListRoute)) {
      return reply(contextListRoute.output, {
        contexts: state.status === "active" && state.applied !== null
          ? [{
            ...contextValue(),
            applied_number: 1,
            draft_bundle: null,
            checking_bundle: null,
          }]
          : [],
        complete: true,
        ...META,
      });
    }
    if (path === routePath(contextGetRoute)) {
      return reply(contextGetRoute.output, {
        ...META,
        context: contextValue(),
        applied: null,
      });
    }
    if (path === routePath(contextContractRoute)) {
      state.contractCalls.push(input);
      if (input["bundle"] !== undefined) {
        const row = state.applied?.bundle === input["bundle"]
          ? { hash: state.applied.hash, content: state.applied.content }
          : state.history.get(String(input["bundle"]));
        return row === undefined
          ? Promise.resolve(err({ code: "not_found", message: "no bundle" }))
          : reply(contextContractRoute.output, {
            ...META,
            context: CTX,
            bundle: input["bundle"],
            bundle_hash: row.hash,
            content: row.content,
          });
      }
      const applied = state.applied;
      return reply(contextContractRoute.output, {
        ...META,
        context: CTX,
        bundle: applied?.bundle ?? null,
        bundle_hash: applied?.hash ?? null,
        content: applied?.content ?? null,
      });
    }
    if (path === routePath(contextOverviewRoute)) {
      return reply(contextOverviewRoute.output, {
        ...META,
        context: contextValue(),
        bundle_hash: state.applied?.hash ?? null,
        types: [{ type: "Recipe", count: 7 }],
        violation_count: 0,
      });
    }
    if (path === routePath(glossaryListRoute)) {
      return reply(glossaryListRoute.output, {
        ...META,
        context: CTX,
        entries: [],
      });
    }
    if (path === routePath(modelCallList)) {
      return reply(modelCallList.output, { calls: [], ...META });
    }
    if (path === routePath(toolCallList)) {
      return reply(toolCallList.output, { tool_calls: [], ...META });
    }
    if (path === routePath(eventsList)) {
      return reply(eventsList.output, {
        events: [{
          seq: "2",
          type: "RunStarted",
          subject: RUN,
          actor: "machine",
          run: RUN,
          payload: { scope: state.startScope },
          at: AT,
        }],
        scanned_through_seq: "5",
        head_seq: "5",
        ...META,
      });
    }
    if (path === routePath(recoverRun)) {
      return reply(recoverRun.output, {
        run: RUN,
        state_seq: "2",
        basis: input["input"] as Record<string, unknown>,
        outcome: null,
      });
    }
    return base.calls.machine(path, body);
  };
  return { state, blobs, machine, base };
}

// 읽을 수 있는 옛 판. 판 내용은 submit 뒤 바뀌지 않으므로 지금 적용된 판이 바뀐 뒤에도 같은 값이다.
const HISTORY: ContextBundleReader = (_context, bundle) =>
  Promise.resolve(
    bundle === BUNDLE_1
      ? ok({ bundle_hash: HASH_1, content: content("First") })
      : err({ code: "not_found", message: "no such bundle" }),
  );

// "core"는 운영과 같은 길이다: runtime의 machine 호출로 `context.contract {bundle}`을 부른다.
type BundleSource = ContextBundleReader | undefined | "core";

function preparer(
  world: ReturnType<typeof scene>,
  source: BundleSource,
) {
  const bundle = source === "core"
    ? contextBundleReader(world.machine)
    : source;
  const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
  return createRunPreparer({
    clock: systemClock,
    ids,
    machine: world.machine,
    agentCall: () => world.machine,
    blobs: {
      async prepare(purpose, bytes) {
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", bytes as BufferSource),
        );
        const hash = [...digest].map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        // run 기준은 run_basis, resolved agent는 run_agent 목적으로 온다. resume이 읽는 이름과 같다.
        world.blobs.set(purpose, JSON.parse(new TextDecoder().decode(bytes)));
        return ok({ hash, size_bytes: bytes.length });
      },
    },
    resolveModel: ({ model }) =>
      Promise.resolve(ok({
        call: {
          limits: {
            context_limit: 128000,
            input_limit: 120000,
            output_limit: 8000,
          },
        },
        model,
        endpoint: "http://127.0.0.1:9",
        usageRevision: "usage-1",
        timeoutMs: null,
        pack: () => ({ body: {}, opaque_bytes: 0 }),
        invoke: () => Promise.reject(new Error("no model")),
        available: () => Promise.resolve(true),
      } as never)),
    toolkit: {
      ...productToolkit({ machine: world.machine, ids }),
      contexts: createContextToolkit({
        machine: world.machine,
        contract: () => ({
          call: () =>
            Promise.resolve(err({ code: "unavailable", message: "x" })),
        }),
        ...(bundle === undefined ? {} : { bundle }),
      }),
    },
    product: "product",
    rolePrompt: () => Promise.resolve(ok("role")),
    instructions: {
      files: {
        read: () =>
          Promise.resolve(err({ code: "unavailable", message: "none" })),
      },
      redact: (text: string) => Promise.resolve(text),
    },
    redact: (text: string) => Promise.resolve(text),
  });
}

const CREDENTIALS = {
  open: () =>
    Promise.resolve(ok({ token: "token", credential_ref: "cred" } as never)),
  end: () => {},
} as never;

// run을 시작해 basis를 고정하고 tool 목록을 돌려준다.
async function startContext(
  world: ReturnType<typeof scene>,
  bundle: BundleSource,
) {
  world.state.runState = "accepted";
  const prepared = await preparer(world, bundle).prepare({
    run: RUN,
    assignment: ASG,
    stateSeq: "1",
    session: null,
    reason: "priority",
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  world.state.startScope = prepared.value.begin.scope;
  const loop = prepared.value.loop(
    { run: RUN, assignment: ASG, token: "token", credential_ref: "cred" },
    { run: RUN, state_seq: "1", basis: HASH },
  );
  const context = await loop.deps.ports.context();
  assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
  return context.value;
}

async function start(
  world: ReturnType<typeof scene>,
  bundle: BundleSource,
) {
  return toolsOf((await startContext(world, bundle)).tools);
}

// 같은 run을 저장된 경계에서 잇고 이어진 loop가 쓰는 prompt 재료다.
async function resumeContext(
  world: ReturnType<typeof scene>,
  bundle: BundleSource,
) {
  world.state.runState = "running";
  const prepared = await preparer(world, bundle).prepareResume!(
    RUN,
    CREDENTIALS,
  );
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const recovered = await prepared.value.recover();
  assert(recovered.ok, recovered.ok ? "" : JSON.stringify(recovered.error));
  assertEquals(recovered.value.kind, "resumed");
  if (recovered.value.kind !== "resumed") throw new Error("not resumed");
  const context = await recovered.value.deps.ports.context();
  assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
  return context.value;
}

async function resume(
  world: ReturnType<typeof scene>,
  bundle: BundleSource,
) {
  return toolsOf((await resumeContext(world, bundle)).tools);
}

function toolsOf(
  tools: readonly { name: string; description: string }[],
) {
  return tools.filter((tool) => tool.name.startsWith("ctx_"));
}

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56c]: Run.basis는 선언 검색 정의를 만든 context의 판 id와 hash를 고정한다", async () => {
  const world = scene();
  const tools = await start(world, HISTORY);
  assertEquals(tools.length, 1);
  const basis = world.blobs.get("run_basis") as {
    tools: { contexts: unknown };
  };
  assertEquals(basis.tools.contexts, [{
    context: CTX,
    bundle: BUNDLE_1,
    bundle_hash: HASH_1,
    title: "Recipes",
  }]);
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56c]: 판이 바뀐 뒤 resume한 run은 시작할 때와 같은 정의를 쓰고 새 run은 새 정의를 받는다", async () => {
  const world = scene();
  const atStart = await start(world, HISTORY);
  assertEquals(atStart.length, 1);

  // 시작한 뒤 context에 새 판이 적용된다.
  world.state.applied = {
    bundle: BUNDLE_2,
    hash: HASH_2,
    content: content("Second"),
  };

  assertEquals(await resume(world, HISTORY), atStart);

  // 다음 run은 지금 적용된 판으로 새 정의를 만든다.
  const next = await start(world, HISTORY);
  assertEquals(next.length, 1);
  assertNotEquals(next, atStart);
  assert(next[0].description.includes("Second"));
  assert(atStart[0].description.includes("First"));
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56c]: 고정한 판을 읽지 못하거나 hash가 다르거나 context가 active가 아니면 그 context의 tool은 resume한 run에서 빠진다", async () => {
  const world = scene();
  const atStart = await start(world, HISTORY);
  world.state.applied = {
    bundle: BUNDLE_2,
    hash: HASH_2,
    content: content("Second"),
  };

  // 옛 판을 읽는 길이 없으면(또는 못 읽으면) 지금 판으로 대신하지 않는다.
  assertEquals(await resume(world, undefined), []);
  assertEquals(
    await resume(
      world,
      () => Promise.resolve(err({ code: "not_found", message: "gone" })),
    ),
    [],
  );
  // 읽은 판의 hash가 고정한 값과 다르면 쓰지 않는다.
  assertEquals(
    await resume(
      world,
      () =>
        Promise.resolve(ok({ bundle_hash: HASH_2, content: content("First") })),
    ),
    [],
  );
  // 지금 판이 pin과 같으면 읽는 길 없이도 같은 정의다.
  world.state.applied = {
    bundle: BUNDLE_1,
    hash: HASH_1,
    content: content("First"),
  };
  assertEquals(await resume(world, undefined), atStart);
  // 보관된 context의 tool은 빠진다.
  world.state.status = "archived";
  assertEquals(await resume(world, HISTORY), []);
});

function sourcesOf(context: { sources: readonly unknown[] }) {
  return context.sources as {
    address: string;
    version: string;
    overview: string;
    unavailable?: string;
  }[];
}

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56b]: resume은 고정한 판을 core의 context.contract {bundle}로 읽어 tool 정의와 prompt 자료를 같은 판으로 다시 만든다", async () => {
  const world = scene();
  world.state.history.set(BUNDLE_1, {
    hash: HASH_1,
    content: content("First", "요리 하나"),
  });
  const first = await startContext(world, "core");
  assertEquals(toolsOf(first.tools).length, 1);
  assertEquals(sourcesOf(first).map((item) => item.version), [HASH_1]);
  assert(sourcesOf(first)[0].overview.includes("요리 하나 (7개)"));

  // 시작한 뒤 새 판이 적용된다. 지금 적용된 판의 overview 개수는 새 판의 것이다.
  world.state.history.set(BUNDLE_2, {
    hash: HASH_2,
    content: content("Second", "레시피 하나"),
  });
  world.state.applied = {
    bundle: BUNDLE_2,
    hash: HASH_2,
    content: content("Second", "레시피 하나"),
  };
  world.state.contractCalls.length = 0;

  const resumed = await resumeContext(world, "core");
  // tool 정의는 시작할 때와 같다.
  assertEquals(toolsOf(resumed.tools), toolsOf(first.tools));
  // prompt 자료도 고정한 판이다: 판 hash와 type 뜻이 옛 판의 것이고, 개수는 새 판의 것이라 싣지 않는다.
  const [material] = sourcesOf(resumed);
  assertEquals(sourcesOf(resumed).length, 1);
  assertEquals(material.version, HASH_1);
  assert(material.overview.includes("- Recipe: 요리 하나"));
  assert(!material.overview.includes("레시피 하나"));
  assert(!material.overview.includes("개)"));
  // 고정한 판은 판 id를 지정한 context.contract로 읽었다(tool 재료와 자료 둘 다).
  assert(
    world.state.contractCalls.some((call) => call["bundle"] === BUNDLE_1),
  );

  // 다음 run은 지금 적용된 판으로 자료를 만들고 개수를 싣는다.
  const next = await startContext(world, "core");
  assertEquals(sourcesOf(next).map((item) => item.version), [HASH_2]);
  assert(sourcesOf(next)[0].overview.includes("레시피 하나 (7개)"));
});

Deno.test("lophn-agent/harness/tools#R21 [ctx-I56b]: 고정한 판이 아직 적용된 판이면 resume한 자료는 개수를 싣고, 판을 읽지 못하면 tool과 자료가 함께 빠진다", async () => {
  const world = scene();
  const first = await startContext(world, "core");
  // 판이 그대로면 시작할 때와 같다.
  const same = await resumeContext(world, "core");
  assertEquals(sourcesOf(same), sourcesOf(first));
  assert(sourcesOf(same)[0].overview.includes("요리 하나 (7개)"));

  // 새 판이 적용됐고 옛 판을 core가 읽어 주지 않으면(history가 없다) 지금 판으로 대신하지 않는다.
  world.state.applied = {
    bundle: BUNDLE_2,
    hash: HASH_2,
    content: content("Second", "레시피 하나"),
  };
  const gone = await resumeContext(world, "core");
  assertEquals(toolsOf(gone.tools), []);
  // 자료는 조용히 빠지지 않고 읽지 못한 이유를 남긴 자리가 된다.
  assertEquals(sourcesOf(gone).map((item) => [item.address, item.version]), [
    [CTX, null],
  ]);
  assert(sourcesOf(gone)[0].overview.includes("[자료 없음]"));
  assert(sourcesOf(gone)[0].overview.includes("not_found"));
  // [ctx-T10d] 같은 이유가 prompt-assemble의 구조화 생략(load_failed)이 되도록 source에 실린다.
  assert(sourcesOf(gone)[0].unavailable?.includes("not_found"));

  // core가 읽어 준 판의 hash가 고정한 값과 다르면 같다.
  world.state.history.set(BUNDLE_1, {
    hash: HASH_2,
    content: content("First"),
  });
  const mismatch = await resumeContext(world, "core");
  assertEquals(toolsOf(mismatch.tools), []);
  assert(sourcesOf(mismatch)[0].overview.includes("[자료 없음]"));
  assertEquals(sourcesOf(mismatch)[0].version, null);
});
