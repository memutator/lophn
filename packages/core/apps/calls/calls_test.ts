import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import type {
  AppApiCaller,
  AppApiCallInput,
  AppApiCallOutput,
  AppInvocation,
  ProcessCallRequest,
  ProcessCallResponse,
} from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Approvals } from "../../approvals/ports.ts";
import type { AppProcessLink, InvocationLedger } from "../ports.ts";
import { type AppCallsDeps, createAppCalls } from "./mod.ts";
import { decodeChangeset, settleResponse } from "./record.ts";

const clock = manualClock(Date.parse("2026-10-16T00:00:00.000Z"));
const ids = createIdSource({ clock, random: seededRandom(7) });
const newApp = () => ids.newId("app") as Id<"app">;
const REL = ids.newId("rel") as Id<"rel">;
const REL2 = ids.newId("rel") as Id<"rel">;
const SES = ids.newId("ses");
const TRN = ids.newId("trn");
const TCL = ids.newId("tcl");

type Handler = (
  request: ProcessCallRequest,
  app: Id<"app">,
) => Promise<ProcessCallResponse | null>;

// 앱 process와 ledger를 흉내 낸다. 시계와 timer는 만들지 않는다.
function setup() {
  const sent: { app: Id<"app">; request: ProcessCallRequest }[] = [];
  const records = new Map<string, AppInvocation>();
  const state = { release: REL, handler: null as Handler | null };

  const ledger: Pick<InvocationLedger, "begin" | "finish" | "recordOnce"> = {
    begin: (row) => {
      const started = { ...row, status: "running" } as AppInvocation;
      records.set(row.id, started);
      return ok(started);
    },
    finish: (id, result) => {
      const done = { ...records.get(id)!, ...result } as AppInvocation;
      records.set(id, done);
      return Promise.resolve(ok(done));
    },
    recordOnce: (row) => {
      records.set(row.id, row);
      return Promise.resolve(ok(row));
    },
  };

  const link: AppProcessLink = {
    call: async (target, request) => {
      const app = target.app as Id<"app">;
      sent.push({ app, request });
      const response = state.handler
        ? await state.handler(request, app)
        : { status: "ok" as const, result: null, changeset: null };
      return { sent: true, response };
    },
    apply: () => Promise.resolve(err({ code: "internal", message: "unused" })),
  };

  const approvals = {
    judge: () => Promise.resolve(ok({ verdict: "run" as const })),
  } as unknown as Approvals;

  const deps: AppCallsDeps = {
    callers: {
      agentToolCall: (_s, _t, tool) =>
        ok(tool === TCL ? { agent: { role: "lophn" }, place: null } : null),
    },
    projects: {
      list: () => ok([]),
      get: (id) => ok({ id, name: "p", purpose: "", archived: false }),
    },
    lookup: {
      find: (_app, _release, api) =>
        ok({
          release: state.release,
          effect: api.startsWith("w.") ? "write" : "read",
        }),
    },
    apps: {
      activeRelease: () => ok(state.release),
      archived: () => ok(false),
    },
    ledger: ledger as InvocationLedger,
    link,
    approvals,
    clock,
    ids,
  };
  const calls = createAppCalls(deps);
  return { ...calls, sent, records, state };
}

function person(app: Id<"app">, api: string): AppApiCallInput {
  return {
    target: { mode: "live", app, release: null },
    api,
    caller: { kind: "person", view_session: "v1" },
  };
}

function appCaller(
  from: Id<"app">,
  to: Id<"app">,
  parent: string | null,
  api = "r.get",
): AppApiCallInput {
  return {
    target: { mode: "live", app: to, release: null },
    api,
    caller: {
      kind: "app",
      app: from,
      release: REL,
      parent_invocation: parent,
    } as AppApiCaller,
  };
}

// 해시 계산이 실제 thread를 지나므로 macrotask를 넉넉히 비운다.
async function tick() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

// 조건이 안 되면 조용히 지나가지 않고 실패한다. 부하에서는 tick 수보다 시간 상한이 안정적이다.
async function until(done: () => boolean) {
  const limit = Date.now() + 2000;
  while (!done()) {
    if (Date.now() > limit) throw new Error("until: condition not met in 2s");
    await new Promise((r) => setTimeout(r, 1));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const okResponse: ProcessCallResponse = {
  status: "ok",
  result: 1,
  changeset: null,
};

function status(result: Result<AppApiCallOutput>): string {
  assert(result.ok);
  return result.value.outcome.status === "denied"
    ? result.value.outcome.denial.code
    : result.value.outcome.status;
}

Deno.test("부른 쪽 종류가 credential과 다르거나 모르는 부모 invocation을 주장하면 handler까지 가지 않는다", async () => {
  const t = setup();
  const a = newApp();
  const b = newApp();
  const rows: [string, Promise<Result<AppApiCallOutput>>][] = [
    // 사람 credential로 agent라고 주장
    [
      "kind",
      t.path.call(
        {
          ...person(a, "r.get"),
          caller: { kind: "agent", session: SES, turn: TRN, tool_call: TCL },
        },
        { actor: "user" },
      ),
    ],
    // 모르는 tool call
    [
      "tool call",
      t.path.call(
        {
          ...person(a, "r.get"),
          caller: {
            kind: "agent",
            session: SES,
            turn: TRN,
            tool_call: ids.newId("tcl"),
          },
        },
        { actor: "agent" },
      ),
    ],
    // 다른 앱 credential로 앱이라고 주장
    [
      "app",
      t.path.call(appCaller(b, a, ids.newId("inv")), {
        actor: "app",
        app: a,
      }),
    ],
    // 모르는 부모와 부모 없음
    [
      "unknown parent",
      t.path.call(appCaller(a, b, ids.newId("inv")), {
        actor: "app",
        app: a,
      }),
    ],
    [
      "no parent",
      t.path.call(appCaller(a, b, null), {
        actor: "app",
        app: a,
      }),
    ],
  ];
  for (const [name, pending] of rows) {
    const result = await pending;
    assert(!result.ok && result.error.code === "forbidden", name);
  }
  assertEquals(t.sent.length, 0);

  // 이미 끝난 부모도 모른다.
  const gate = deferred<ProcessCallResponse>();
  t.state.handler = () => gate.promise;
  const first = t.path.call(person(a, "r.get"), { actor: "user" });
  await until(() => t.sent.length > 0);
  const parent = t.sent[0].request.invocation;
  gate.resolve(okResponse);
  await first;
  t.state.handler = null;
  const after = await t.path.call(appCaller(a, b, parent), {
    actor: "app",
    app: a,
  });
  assert(!after.ok && after.error.code === "forbidden");
});

Deno.test("write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다", async () => {
  const t = setup();
  const a = newApp();
  const other = newApp();
  const gates = new Map<
    string,
    ReturnType<typeof deferred<ProcessCallResponse>>
  >();
  t.state.handler = (request) => {
    const gate = deferred<ProcessCallResponse>();
    gates.set(request.invocation, gate);
    return gate.promise;
  };

  const w1 = t.path.call(person(a, "w.one"), { actor: "user" });
  const w2 = t.path.call(person(a, "w.two"), { actor: "user" });
  const r1 = t.path.call(person(a, "r.get"), { actor: "user" });
  const wOther = t.path.call(person(other, "w.one"), { actor: "user" });
  await until(() => t.sent.length >= 3);
  await tick();
  // 해시 계산 순서는 부하에 따라 달라서 같은 앱의 어느 write가 먼저 도는지는 정해지지 않는다.
  // 같은 앱의 write 하나만 돌고 나머지 하나는 기다린다.
  assertEquals(t.sent.length, 3);
  const aWrites = t.sent.filter(
    (s) => s.app === a && s.request.api.startsWith("w."),
  );
  assertEquals(aWrites.length, 1);
  assertEquals(
    t.sent.filter((s) => s.app === a && s.request.api === "r.get").length,
    1,
  );
  assertEquals(
    t.sent.filter((s) => s.app === other).map((s) => s.request.api),
    ["w.one"],
  );
  const first = aWrites[0];

  gates.get(first.request.invocation)!.resolve(okResponse);
  await until(() => t.sent.length >= 4);
  assertEquals(t.sent.length, 4);
  assertEquals(
    t.sent
      .filter((s) => s.app === a && s.request.api.startsWith("w."))
      .map((s) => s.request.api)
      .sort(),
    ["w.one", "w.two"],
  );

  for (const gate of gates.values()) gate.resolve(okResponse);
  const results = await Promise.all([w1, w2, r1, wOther]);
  assertEquals(results.map(status), Array(4).fill("succeeded"));
  const read = results[2];
  assert(read.ok && read.value.invocation === null);
  // write는 끝에서 닫힌 기록이 남는다.
  assertEquals(
    [...t.records.values()].filter((r) => r.status === "succeeded").length,
    3,
  );
});

Deno.test("호출 루프와 깊이 8 초과는 handler 전에 거절되고, 접수를 닫은 동안 온 호출은 붙잡혔다가 열리면 넘어간다", async () => {
  const t = setup();
  const apps = Array.from({ length: 10 }, newApp);

  // 앱 i가 앱 i+1을 잇달아 부른다. 마지막 결과를 그대로 올려 준다.
  const results: AppApiCallOutput[] = [];
  t.state.handler = async (request, app) => {
    const next = apps[apps.indexOf(app) + 1];
    if (next === undefined) return okResponse;
    const inner = await t.path.call(
      appCaller(app, next, request.invocation),
      { actor: "app", app },
    );
    assert(inner.ok);
    results.push(inner.value);
    return okResponse;
  };
  const chain = await t.path.call(person(apps[0], "r.get"), {
    actor: "user",
  });
  assertEquals(status(chain), "succeeded");
  // 호출 깊이 8까지 가고 아홉째는 거절된다.
  assertEquals(t.sent.length, 8);
  assertEquals(
    results.map((r) => r.outcome.status === "denied" && r.outcome.denial.code)
      .filter(Boolean),
    ["call_too_deep"],
  );

  // 자기 앱을 다시 부르는 사슬은 루프다.
  t.sent.length = 0;
  t.state.handler = async (request, app) => {
    const loop = await t.path.call(
      appCaller(app, apps[0], request.invocation),
      { actor: "app", app },
    );
    results.push(loop.ok ? loop.value : ({} as AppApiCallOutput));
    return okResponse;
  };
  await t.path.call(person(apps[0], "r.get"), { actor: "user" });
  assertEquals(t.sent.length, 1);
  assert(
    results.at(-1)!.outcome.status === "denied" &&
      (results.at(-1)!.outcome as { denial: { code: string } }).denial.code ===
        "call_loop",
  );

  // 접수를 닫은 동안 온 호출은 붙잡힌다. 열릴 때 활성 release로 다시 정한다.
  t.sent.length = 0;
  t.state.handler = null;
  t.intake.close(apps[0], "activation");
  const held = t.path.call(person(apps[0], "r.get"), { actor: "user" });
  await tick();
  assertEquals(t.sent.length, 0);
  t.state.release = REL2;
  t.intake.open(apps[0]);
  assertEquals(status(await held), "succeeded");
  assertEquals(t.sent[0].request.context.release, REL2);
});

Deno.test("changeset_dropped가 있는 응답은 unknown이 아니라 닫히고 요약에 남는다", () => {
  const ok = settleResponse({
    status: "ok",
    result: 1,
    changeset: null,
    changeset_dropped: "too_large",
  });
  assertEquals(ok.status, "succeeded");
  assertEquals(ok.summary, {
    outcome: "succeeded",
    changeset_dropped: "too_large",
  });
  const failed = settleResponse({
    status: "error",
    error: { code: "internal", message: "x" },
    changeset: null,
    changeset_dropped: "too_large",
  });
  assertEquals(failed.status, "failed");
  assertEquals(failed.summary.changeset_dropped, "too_large");
  assertEquals(
    decodeChangeset({
      status: "ok",
      result: 1,
      changeset: null,
      changeset_dropped: "too_large",
    }),
    null,
  );
});
