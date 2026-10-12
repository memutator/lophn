import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreContextsSource } from "./core-source.ts";

const PROJECT = "prj_01k6p0000000000000000000aa";
const CTX = "ctx_01k6p0000000000000000000aa";
const CONTEXT = {
  id: CTX,
  project: PROJECT,
  title: "Eval",
  purpose: "Why",
  status: "active" as const,
  applied_bundle: "cbn_01k6p0000000000000000000aa",
  violation_mark: 0,
  revision: "7",
};
const META = { as_of_seq: "1", next_cursor: null };

type Route = (body: Record<string, unknown>) => CoreReply | Promise<CoreReply>;

function routedCore(
  routes: Record<string, Route>,
): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        const route = routes[`${input.kind}:${input.resource}/${input.method}`];
        return Promise.resolve(
          route
            ? route(input.body as Record<string, unknown>)
            : { ok: false, error: { code: "not_found", message: "" } },
        );
      },
    },
  };
}

const ok = (value: unknown): CoreReply => ({ ok: true, value });
const fail = (code: string): CoreReply => ({
  ok: false,
  error: { code, message: `${code} message` },
});

Deno.test("shell/workspace#R16 [ctx-I39b]: 목록은 cursor를 끝까지 따라가 모은다", async () => {
  const pages = [
    { contexts: [{ ...CONTEXT, id: "a" }], ...META, next_cursor: "c1" },
    { contexts: [{ ...CONTEXT, id: "b" }], ...META },
  ];
  let index = 0;
  const { core, calls } = routedCore({
    "read:contexts/list": () => ok(pages[index++]),
  });
  const result = await coreContextsSource(core).list(PROJECT);
  assertEquals(
    result.ok && result.value.map((item) => item.id),
    ["a", "b"],
  );
  assertEquals(calls.map((call) => call.body), [
    { project: PROJECT, limit: 100 },
    { project: PROJECT, limit: 100, cursor: "c1" },
  ]);
});

Deno.test("shell/workspace#R19 [ctx-I39b]: 판 이력과 위반도 page를 모으고 위반은 끝까지 읽었는지 알린다", async () => {
  const violation = {
    context: CTX,
    bundle_hash: "a".repeat(64),
    kind: "unreadable",
    rule: null,
    path: "a.md",
    section: null,
    type: null,
    target: null,
    message: "x",
    handed_off: false,
  };
  let reads = 0;
  const { core } = routedCore({
    "read:contexts/bundles": () =>
      ok({ context: CTX, bundles: [], complete: true, ...META }),
    "read:contexts/violations": () =>
      ok(
        reads++ === 0
          ? {
            context: CTX,
            violations: [violation],
            complete: false,
            ...META,
            next_cursor: "c1",
          }
          : {
            context: CTX,
            violations: [{ ...violation, path: "b.md" }],
            complete: true,
            ...META,
          },
      ),
  });
  const source = coreContextsSource(core);
  assertEquals(await source.bundles(CTX), { ok: true, value: [] });
  const page = await source.violations(CTX);
  assertEquals(page.ok && page.value.violations.map((v) => v.path), [
    "a.md",
    "b.md",
  ]);
  assertEquals(page.ok && [page.value.complete, page.value.next_cursor], [
    true,
    null,
  ]);
});

Deno.test("shell/workspace#R17 [ctx-I39b]: 읽기는 계약 응답에서 화면이 쓰는 field만 옮긴다", async () => {
  const { core, calls } = routedCore({
    "read:contexts/get": () => ok({ context: CONTEXT, applied: null, ...META }),
    "read:contexts/overview": () =>
      ok({
        context: CONTEXT,
        bundle_hash: null,
        types: [{ type: "Run", count: 3 }],
        violation_count: 2,
        ...META,
      }),
    "read:terms/list": () => ok({ context: CTX, entries: [], ...META }),
    "read:contexts/saved_views": () => ok({ context: CTX, views: [], ...META }),
    "read:contexts/containing": () =>
      ok({
        contexts: [{ context: CTX, title: "Eval", types: ["Run"] }],
        ...META,
      }),
  });
  const source = coreContextsSource(core);
  assertEquals(await source.get(CTX), {
    ok: true,
    value: { context: CONTEXT, applied: null },
  });
  assertEquals(await source.overview(CTX), {
    ok: true,
    value: {
      context: CONTEXT,
      bundle_hash: null,
      types: [{ type: "Run", count: 3 }],
      violation_count: 2,
    },
  });
  assertEquals(await source.glossary(CTX), { ok: true, value: [] });
  assertEquals(await source.savedViews(CTX), { ok: true, value: [] });
  assertEquals(await source.containing(PROJECT, "a.md"), {
    ok: true,
    value: [{ context: CTX, title: "Eval", types: ["Run"] }],
  });
  assertEquals(calls.map((call) => `${call.resource}/${call.method}`), [
    "contexts/get",
    "contexts/overview",
    "terms/list",
    "contexts/saved_views",
    "contexts/containing",
  ]);
  assertEquals(calls[4]!.body, { project: PROJECT, path: "a.md" });
});

Deno.test("documents/contexts#R17 [ctx-I39b]: 검색은 요청을 그대로 보내고 page 모양으로 돌려준다", async () => {
  const { core, calls } = routedCore({
    "read:contexts/search": () =>
      ok({
        context: CTX,
        search: "all",
        bundle_hash: "a".repeat(64),
        total: 5,
        rows: [],
        complete: false,
        as_of_seq: "1",
        next_cursor: "c2",
      }),
  });
  const request = {
    context: CTX,
    search: "all",
    inputs: { who: "x" },
    cursor: "c1",
  };
  assertEquals(await coreContextsSource(core).search(request), {
    ok: true,
    value: { rows: [], complete: false, next_cursor: "c2", total: 5 },
  });
  assertEquals(calls[0]!.body, request);
});

Deno.test("documents/contexts#R23 [ctx-I39b]: 색인이 없어 core가 unavailable이면 search·overview·input_options는 그 code로 실패한다", async () => {
  const { core } = routedCore({
    "read:contexts/search": () => fail("unavailable"),
    "read:contexts/overview": () => fail("unavailable"),
    "read:contexts/input_options": () => fail("unavailable"),
  });
  const source = coreContextsSource(core);
  const unavailable = { ok: false, message: "unavailable" } as const;
  assertEquals(
    await source.search({ context: CTX, search: "all", inputs: {} }),
    unavailable,
  );
  assertEquals(await source.overview(CTX), unavailable);
  assertEquals(
    await source.inputOptions({ context: CTX, search: "all", input: "who" }),
    unavailable,
  );
});

Deno.test("shell/workspace#R17 [ctx-I39b]: core 통로가 throw해도 읽기와 명령은 unavailable로 답한다", async () => {
  const core: CoreSource = {
    subscribe: () => () => {},
    call: () => Promise.reject(new Error("bridge gone")),
  };
  const source = coreContextsSource(core);
  assertEquals(await source.get(CTX), { ok: false, message: "unavailable" });
  assertEquals(await source.handOffViolations({ context: CTX }), {
    ok: false,
    message: "unavailable",
  });
});

Deno.test("shell/workspace#R20 [ctx-I39b]: 명령은 input·idempotency_key·compare를 싣고 revision 비교는 호출자가 준 값을 쓴다", async () => {
  const entry = {
    id: "trm_01k6p0000000000000000000aa",
    context: CTX,
    term: "T",
    meaning: "M",
    set_by: "user" as const,
    updated_at: "2026-01-01T00:00:00.000Z",
    revision: "9",
  };
  const { core, calls } = routedCore({
    "command:terms/set": () => ok(entry),
    "command:terms/remove": () => ok({ entry: entry.id }),
    "command:contexts/save_view": () => fail("conflict"),
    "command:contexts/hand_off_violations": () =>
      ok({
        context: CTX,
        run: "run_01k6p0000000000000000000aa",
        violation_count: 1,
      }),
  });
  const source = coreContextsSource(core);
  const added = {
    id: entry.id,
    context: CTX,
    term: "T",
    meaning: "M",
  };
  assertEquals(await source.glossarySet(added), { ok: true, value: entry });
  await source.glossarySet({ entry: entry.id, term: "U" }, {
    base_revision: "8",
  });
  assertEquals(
    await source.glossaryRemove({ entry: entry.id }, { base_revision: "9" }),
    { ok: true, value: { entry: entry.id } },
  );
  assertEquals(
    await source.saveView({
      context: CTX,
      name: "v",
      search: "all",
      inputs: {},
    }),
    { ok: false, message: "conflict" },
  );
  const handed = await source.handOffViolations({ context: CTX });
  assertEquals(handed.ok && handed.value.violation_count, 1);

  const bodies = calls.map((call) => call.body as Record<string, unknown>);
  assertEquals(bodies[0]!.input, added);
  assertEquals(bodies[0]!.compare, {});
  assertEquals(bodies[0]!.prepared, []);
  assertEquals(bodies[1]!.compare, { base_revision: "8" });
  assertEquals(bodies[2]!.compare, { base_revision: "9" });
  assertEquals(
    new Set(bodies.map((body) => body.idempotency_key)).size,
    bodies.length,
  );
});

Deno.test("documents/contexts#R21 [ctx-I39b]: rollback은 context의 지금 revision을 비교 기준으로 보낸다", async () => {
  const bundle = "cbn_01k6p0000000000000000000bb";
  const { core, calls } = routedCore({
    "read:contexts/get": () => ok({ context: CONTEXT, applied: null, ...META }),
    "command:contexts/rollback": () => fail("conflict"),
  });
  const result = await coreContextsSource(core).rollback({
    context: CTX,
    bundle,
  });
  assertEquals(result, { ok: false, message: "conflict" });
  const command = calls.find((call) => call.kind === "command")!;
  assertEquals(
    (command.body as { compare: unknown }).compare,
    { base_revision: "7" },
  );
  assertEquals((command.body as { input: unknown }).input, {
    context: CTX,
    bundle,
  });
});

Deno.test("documents/contexts#R27 [ctx-I54]: Operator 수는 그 project의 Operator를 한 번씩만 읽어 context별로 센다", async () => {
  const row = (assignment: string, kind: string) => ({ assignment, kind });
  const definitions: Record<string, readonly string[] | undefined> = {
    asg_a: [CTX, "ctx_other"],
    asg_b: ["ctx_other"],
    asg_c: undefined,
    asg_d: [CTX],
  };
  const { core, calls } = routedCore({
    "read:agents/list": () =>
      ok({
        agents: [
          row("asg_a", "operator"),
          row("asg_b", "operator"),
          row("asg_c", "operator"),
          row("asg_d", "operator"),
          row("asg_e", "built_in"),
        ],
        ...META,
      }),
    "read:agents/read": (body) =>
      ok({
        definition: {
          contexts: definitions[String(body["assignment"])],
        },
        ...META,
      }),
  });
  const counted = await coreContextsSource(core).operatorCounts(PROJECT);
  assert(counted.ok);
  assertEquals(
    [...counted.value.entries()].sort(),
    [[CTX, 2], ["ctx_other", 2]],
  );
  const place = { kind: "project", id: PROJECT };
  assertEquals(calls.map((call) => call.body), [
    { place },
    { place, assignment: "asg_a" },
    { place, assignment: "asg_b" },
    { place, assignment: "asg_c" },
    { place, assignment: "asg_d" },
  ]);
});
