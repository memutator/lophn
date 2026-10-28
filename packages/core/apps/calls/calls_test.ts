import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import type {
  AppInvocation,
  AppToolCaller,
  ProcessCallRequest,
  ProcessCallResponse,
  ToolCallInput,
  ToolCallOutput,
} from "../../../protocol/apps/calls/mod.ts";
import type { AgentAssignment } from "../../../protocol/approvals/mod.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentId, Place } from "../../../protocol/lophn-agent/places.ts";
import type { AppProcessLink, InvocationLedger } from "../ports.ts";
import type { CallAuth } from "./caller.ts";
import { type AppCallsDeps, createAppCalls } from "./mod.ts";
import { parseProcessCall } from "../runtime/entrypoint/wire.ts";
import { processCallRequestSchema } from "../../../protocol/apps/calls/process-wire.ts";
import { decodeChangeset, settleResponse } from "./record.ts";

const clock = manualClock(Date.parse("2026-10-16T00:00:00.000Z"));
const ids = createIdSource({ clock, random: seededRandom(7) });
const madeApps: Id<"app">[] = [];
const newApp = () => {
  const app = ids.newId("app") as Id<"app">;
  madeApps.push(app);
  return app;
};
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
  const state = {
    release: REL,
    handler: null as Handler | null,
    // 지금 preview의 선언. nonce가 다르면 선언이 없다.
    preview: { nonce: "pv-nonce-1", effects: {} as Record<string, string> },
    // null이면 만든 앱을 모두 할당했다(위험 test가 범위를 줄인다).
    assignment: null as AgentAssignment["entries"] | null,
    // null이면 부른 앱이 만든 앱 모두의 tool을 부를 grant를 가졌다.
    grants: null as AppGrant[] | null,
    // agentToolCall이 돌려주는 agent와 place. agent가 null이면 tool call을 모른다.
    agent: "lophn" as AgentId | null,
    place: null as Place | null,
    // 이름에 "priv."가 붙은 tool만 비공개고 domain은 "dom"이다. 기본 tool은 공개다.
    // creator가 맡은 domain id. null이면 읽지 못한다.
    domains: [] as string[] | null,
    // 앱 domain 이름 "dom"의 id. null이면 찾지 못한다.
    toolDomainId: "dom_a" as string | null,
  };

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

  const deps: AppCallsDeps = {
    callers: {
      agentToolCall: (_s, _t, tool) =>
        ok(
          tool === TCL && state.agent !== null
            ? { agent: state.agent, place: state.place }
            : null,
        ),
    },
    lookup: {
      find: (_app, _release, tool) =>
        ok({
          release: state.release,
          effect: tool.startsWith("w.") ? "write" : "read",
          public: !tool.includes("priv."),
          domain: "dom",
        }),
      findPreview: (_app, nonce, tool) => {
        const effect =
          nonce === state.preview.nonce
            ? state.preview.effects[tool]
            : undefined;
        return Promise.resolve(
          ok(effect === undefined ? null : { effect: effect as "write" }),
        );
      },
    },
    apps: {
      activeRelease: () => ok(state.release),
      archived: () => ok(false),
    },
    ledger: ledger as InvocationLedger,
    link,
    assignmentOf: (agent) =>
      ok({
        agent,
        entries:
          state.assignment ??
          madeApps.map((app) => ({ app, removed_tools: [] })),
      }),
    agentDomainsOf: () =>
      state.domains === null
        ? err({ code: "unavailable", message: "unreadable" })
        : ok(state.domains),
    toolDomainOf: () => ok(state.toolDomainId),
    appGrantsOf: (app) =>
      Promise.resolve(
        ok(
          state.grants ??
            madeApps.map((to) =>
              appCallGrant(app, to, ["r.get", "w.one", "w.two"]),
            ),
        ),
      ),
    clock,
    ids,
  };
  const calls = createAppCalls(deps);
  return { ...calls, sent, records, state };
}

function appCallGrant(
  app: Id<"app">,
  to: Id<"app">,
  tools: string[],
  status: "active" | "revoked" = "active",
): AppGrant {
  const at = "2026-10-16T00:00:00.000Z";
  return {
    id: ids.newId("grt") as AppGrant["id"],
    app,
    scope: { kind: "app.call", app: to, app_tools: tools },
    status,
    created_at: at,
    revoked_at: status === "revoked" ? at : null,
  } as AppGrant;
}

function person(app: Id<"app">, tool: string): ToolCallInput {
  return {
    target: { mode: "live", app, release: null },
    tool: tool,
    caller: { kind: "person", view_session: "v1" },
  };
}

function appCaller(
  from: Id<"app">,
  to: Id<"app">,
  parent: string | null,
  tool = "r.get",
): ToolCallInput {
  return {
    target: { mode: "live", app: to, release: null },
    tool: tool,
    caller: {
      kind: "app",
      app: from,
      release: REL,
      parent_invocation: parent,
    } as AppToolCaller,
  };
}

const JOB = ids.newId("job") as Id<"job">;
const RUN = ids.newId("jbr") as Id<"jbr">;

function programCaller(job: Id<"job">, run: Id<"jbr">): AppToolCaller {
  return { kind: "program", job, job_run: run };
}

const WFI = ids.newId("wfi") as Id<"wfi">;
const PRJ = ids.newId("prj") as Id<"prj">;

function flowCaller(instance: Id<"wfi">): AppToolCaller {
  return { kind: "flow", instance };
}

function flowAuth(instance = WFI): CallAuth {
  return {
    actor: "flow",
    flow: {
      instance,
      agent: "lophn",
      place: { kind: "project", id: PRJ },
    },
  };
}

function programAuth(): CallAuth {
  return {
    actor: "program",
    program: { job: JOB, job_run: RUN, agent: "lophn", place: null },
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

function status(result: Result<ToolCallOutput>): string {
  assert.ok(result.ok);
  return result.value.outcome.status === "denied"
    ? result.value.outcome.denial.code
    : result.value.outcome.status;
}

test("부른 쪽 종류가 credential과 다르거나 모르는 부모 invocation을 주장하면 handler까지 가지 않는다", async () => {
  const t = setup();
  const a = newApp();
  const b = newApp();
  const rows: [string, Promise<Result<ToolCallOutput>>][] = [
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
    // 사람·agent credential로 program이라고 주장, program 자격이 다른 job_run의 본문을 보냄
    [
      "person claims program",
      t.path.call(
        { ...person(a, "r.get"), caller: programCaller(JOB, RUN) },
        { actor: "user" },
      ),
    ],
    [
      "agent claims program",
      t.path.call(
        { ...person(a, "r.get"), caller: programCaller(JOB, RUN) },
        { actor: "agent" },
      ),
    ],
    [
      "other job run",
      t.path.call(
        {
          ...person(a, "r.get"),
          caller: programCaller(JOB, ids.newId("jbr") as Id<"jbr">),
        },
        programAuth(),
      ),
    ],
    // flow 주장: 사람·agent credential, program 자격, 다른 종류 본문, 다른 instance
    [
      "person claims flow",
      t.path.call(
        { ...person(a, "r.get"), caller: flowCaller(WFI) },
        { actor: "user" },
      ),
    ],
    [
      "agent claims flow",
      t.path.call(
        { ...person(a, "r.get"), caller: flowCaller(WFI) },
        { actor: "agent" },
      ),
    ],
    [
      "program credential claims flow",
      t.path.call(
        { ...person(a, "r.get"), caller: flowCaller(WFI) },
        programAuth(),
      ),
    ],
    [
      "flow credential claims program",
      t.path.call(
        { ...person(a, "r.get"), caller: programCaller(JOB, RUN) },
        flowAuth(),
      ),
    ],
    [
      "other instance",
      t.path.call(
        { ...person(a, "r.get"), caller: flowCaller(WFI) },
        flowAuth(ids.newId("wfi") as Id<"wfi">),
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
    assert.ok(!result.ok && result.error.code === "forbidden", name);
  }
  assert.deepStrictEqual(t.sent.length, 0);

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
  assert.ok(!after.ok && after.error.code === "forbidden");
});

test("write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다", async () => {
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
  assert.deepStrictEqual(t.sent.length, 3);
  const aWrites = t.sent.filter(
    (s) => s.app === a && s.request.tool.startsWith("w."),
  );
  assert.deepStrictEqual(aWrites.length, 1);
  assert.deepStrictEqual(
    t.sent.filter((s) => s.app === a && s.request.tool === "r.get").length,
    1,
  );
  assert.deepStrictEqual(
    t.sent.filter((s) => s.app === other).map((s) => s.request.tool),
    ["w.one"],
  );
  const first = aWrites[0];

  gates.get(first.request.invocation)!.resolve(okResponse);
  await until(() => t.sent.length >= 4);
  assert.deepStrictEqual(t.sent.length, 4);
  assert.deepStrictEqual(
    t.sent
      .filter((s) => s.app === a && s.request.tool.startsWith("w."))
      .map((s) => s.request.tool)
      .sort(),
    ["w.one", "w.two"],
  );

  for (const gate of gates.values()) gate.resolve(okResponse);
  const results = await Promise.all([w1, w2, r1, wOther]);
  assert.deepStrictEqual(results.map(status), Array(4).fill("succeeded"));
  const read = results[2];
  assert.ok(read.ok && read.value.invocation === null);
  // write는 끝에서 닫힌 기록이 남는다.
  assert.deepStrictEqual(
    [...t.records.values()].filter((r) => r.status === "succeeded").length,
    3,
  );
});

test("write tool 호출은 응답의 changeset을 붙여 invocation을 닫고, 성공한 read는 기록을 남기지 않는다", async () => {
  const t = setup();
  const a = newApp();
  t.state.handler = () =>
    Promise.resolve({ status: "ok", result: 1, changeset: btoa("cs") });

  const write = await t.path.call(person(a, "w.one"), { actor: "user" });
  assert.deepStrictEqual(status(write), "succeeded");
  const row = t.records.get(write.ok ? write.value.invocation! : "");
  assert.deepStrictEqual(row?.status, "succeeded");
  assert.ok(row?.changeset);

  const before = t.records.size;
  const read = await t.path.call(person(a, "r.get"), { actor: "user" });
  assert.ok(read.ok && read.value.invocation === null);
  assert.deepStrictEqual(t.records.size, before);
});

test("호출 루프와 깊이 8 초과는 handler 전에 거절되고, 접수를 닫은 동안 온 호출은 붙잡혔다가 열리면 넘어간다", async () => {
  const t = setup();
  const apps = Array.from({ length: 10 }, newApp);

  // 앱 i가 앱 i+1을 잇달아 부른다. 마지막 결과를 그대로 올려 준다.
  const results: ToolCallOutput[] = [];
  t.state.handler = async (request, app) => {
    const next = apps[apps.indexOf(app) + 1];
    if (next === undefined) return okResponse;
    const inner = await t.path.call(appCaller(app, next, request.invocation), {
      actor: "app",
      app,
    });
    assert.ok(inner.ok);
    results.push(inner.value);
    return okResponse;
  };
  const chain = await t.path.call(person(apps[0], "r.get"), {
    actor: "user",
  });
  assert.deepStrictEqual(status(chain), "succeeded");
  // 호출 깊이 8까지 가고 아홉째는 거절된다.
  assert.deepStrictEqual(t.sent.length, 8);
  assert.deepStrictEqual(
    results
      .map((r) => r.outcome.status === "denied" && r.outcome.denial.code)
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
    results.push(loop.ok ? loop.value : ({} as ToolCallOutput));
    return okResponse;
  };
  await t.path.call(person(apps[0], "r.get"), { actor: "user" });
  assert.deepStrictEqual(t.sent.length, 1);
  assert.ok(
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
  assert.deepStrictEqual(t.sent.length, 0);
  t.state.release = REL2;
  t.intake.open(apps[0]);
  assert.deepStrictEqual(status(await held), "succeeded");
  assert.deepStrictEqual(t.sent[0].request.context.release, REL2);
});

test("changeset_dropped가 있는 응답은 unknown이 아니라 닫히고 요약에 남는다", () => {
  const ok = settleResponse({
    status: "ok",
    result: 1,
    changeset: null,
    changeset_dropped: "too_large",
  });
  assert.deepStrictEqual(ok.status, "succeeded");
  assert.deepStrictEqual(ok.summary, {
    outcome: "succeeded",
    changeset_dropped: "too_large",
  });
  const failed = settleResponse({
    status: "error",
    error: { code: "internal", message: "x" },
    changeset: null,
    changeset_dropped: "too_large",
  });
  assert.deepStrictEqual(failed.status, "failed");
  assert.deepStrictEqual(failed.summary.changeset_dropped, "too_large");
  assert.deepStrictEqual(
    decodeChangeset({
      status: "ok",
      result: 1,
      changeset: null,
      changeset_dropped: "too_large",
    }),
    null,
  );
});

test("previewOnly 호출은 live로 새지 않고 preview 호출은 ledger를 남기지 않는다", async () => {
  const t = setup();
  const a = newApp();
  const preview = (tool: string, nonce = "pv-nonce-1"): ToolCallInput => ({
    ...person(a, tool),
    target: { mode: "preview", app: a, process_nonce: nonce },
  });
  const only = { actor: "user" as const, previewOnly: true as const };

  // live target과 사람이 아닌 호출자는 앱 process에 아무것도 보내지 않는다.
  const live = await t.path.call(person(a, "r.get"), only);
  assert.ok(!live.ok && live.error.code === "forbidden");
  const agent = await t.path.call(
    {
      ...preview("r.get"),
      caller: { kind: "agent", session: SES, turn: TRN, tool_call: TCL },
    },
    { actor: "agent", previewOnly: true },
  );
  assert.ok(!agent.ok && agent.error.code === "forbidden");
  assert.deepStrictEqual(t.sent.length, 0);

  // release 없는 새 tool도 그 preview bundle의 선언 effect로 간다. 기록은 없다.
  t.state.preview.effects["w.new"] = "write";
  const done = await t.path.call(preview("w.new"), only);
  assert.ok(done.ok && done.value.invocation === null);
  assert.deepStrictEqual(status(done), "succeeded");
  assert.deepStrictEqual(t.sent.length, 1);
  assert.deepStrictEqual(t.sent[0].request.context.effect, "write");
  assert.deepStrictEqual(t.sent[0].request.context.release, null);

  // 선언 없는 tool과 지금 preview가 아닌 nonce는 보내지 않는다.
  assert.deepStrictEqual(
    status(await t.path.call(preview("w.none"), only)),
    "not_declared",
  );
  assert.deepStrictEqual(
    status(await t.path.call(preview("w.new", "pv-nonce-2"), only)),
    "not_declared",
  );
  assert.deepStrictEqual(t.sent.length, 1);
  assert.deepStrictEqual(t.records.size, 0);
});

test("그 앱 place의 session만 그 앱의 preview tool을 부르고, 다른 place의 session은 앱 process에 닿지 못한다", async () => {
  const a = newApp();
  const b = newApp();
  const project = ids.newId("prj");
  const rows: [string, AgentId | null, Place | null, string][] = [
    ["app A place session", "lophn", { kind: "app", id: a }, "succeeded"],
    ["app B place session", "lophn", { kind: "app", id: b }, "forbidden"],
    ["home session", "lophn", null, "forbidden"],
    [
      "project place session",
      "lophn",
      { kind: "project", id: project },
      "forbidden",
    ],
    ["unknown tool call", null, null, "forbidden"],
  ];
  for (const [label, agent, place, expected] of rows) {
    const t = setup();
    t.state.agent = agent;
    t.state.place = place;
    t.state.preview.effects["w.new"] = "write";
    const done = await t.path.call(
      {
        target: { mode: "preview", app: a, process_nonce: "pv-nonce-1" },
        tool: "w.new",
        caller: { kind: "agent", session: SES, turn: TRN, tool_call: TCL },
      },
      { actor: "agent" },
    );
    if (expected === "succeeded") {
      assert.ok(done.ok && done.value.invocation === null, label);
      assert.deepStrictEqual(status(done), "succeeded", label);
      assert.deepStrictEqual(t.sent.length, 1, label);
    } else {
      assert.ok(!done.ok && done.error.code === expected, label);
      assert.deepStrictEqual(t.sent.length, 0, label);
    }
    assert.deepStrictEqual(t.records.size, 0, label);
  }
});

test("앱이 다른 앱 tool을 부를 때 active grant app.call이 그 tool을 덮지 않으면 handler에 가지 않고 막힌다", async () => {
  const t = setup();
  const from = newApp();
  const to = newApp();
  const third = newApp();
  const rows: [string, AppGrant[], string][] = [
    ["no grant", [], "gate_blocked"],
    ["other tool", [appCallGrant(from, to, ["r.other"])], "gate_blocked"],
    [
      "other target app",
      [appCallGrant(from, third, ["r.get"])],
      "gate_blocked",
    ],
    ["revoked", [appCallGrant(from, to, ["r.get"], "revoked")], "gate_blocked"],
    ["covered", [appCallGrant(from, to, ["r.get"])], "succeeded"],
  ];
  const seen: string[] = [];
  t.state.handler = async (request, app) => {
    if (app !== from) return okResponse;
    for (const [name, grants, want] of rows) {
      t.state.grants = grants;
      const before = t.sent.length;
      const result = await t.path.call(
        appCaller(from, to, request.invocation),
        { actor: "app", app: from },
      );
      const reached = t.sent.length - before;
      seen.push(`${name}:${status(result)}:${reached}`);
      assert.deepStrictEqual(status(result), want, name);
      assert.deepStrictEqual(reached, want === "succeeded" ? 1 : 0, name);
    }
    return okResponse;
  };
  await t.path.call(person(from, "r.get"), { actor: "user" });
  assert.deepStrictEqual(seen.length, rows.length);
});

test("agent는 할당하지 않은 앱의 tool과 할당에서 뺀 tool을 부르지 못한다", async () => {
  const t = setup();
  const assigned = newApp();
  const other = newApp();
  const agentCall = (app: Id<"app">, tool: string): ToolCallInput => ({
    ...person(app, tool),
    caller: { kind: "agent", session: SES, turn: TRN, tool_call: TCL },
  });
  t.state.assignment = [{ app: assigned, removed_tools: ["r.removed"] }];

  const rows: [string, Id<"app">, string, string][] = [
    ["not assigned", other, "r.get", "gate_blocked"],
    ["removed tool", assigned, "r.removed", "gate_blocked"],
    ["assigned", assigned, "r.get", "succeeded"],
  ];
  for (const [name, app, tool, want] of rows) {
    const before = t.sent.length;
    const result = await t.path.call(agentCall(app, tool), {
      actor: "agent",
    });
    assert.deepStrictEqual(status(result), want, name);
    assert.deepStrictEqual(
      t.sent.length - before,
      want === "succeeded" ? 1 : 0,
      name,
    );
  }
});

test("job과 workflow instance가 부르는 앱 tool은 만든 agent(job의 creator, flow instance의 creator)의 할당이나 domain 밖이면 실행되지 않는다", async () => {
  const assigned = newApp();
  const other = newApp();
  const rows: {
    name: string;
    app: Id<"app">;
    tool: string;
    domains?: string[] | null;
    toolDomainId?: string | null;
    want: string;
  }[] = [
    { name: "not assigned", app: other, tool: "r.get", want: "gate_blocked" },
    {
      name: "removed tool",
      app: assigned,
      tool: "r.removed",
      want: "gate_blocked",
    },
    {
      name: "private tool of another domain",
      app: assigned,
      tool: "priv.get",
      domains: ["dom_b"],
      want: "gate_blocked",
    },
    {
      name: "unreadable creator domains",
      app: assigned,
      tool: "priv.get",
      domains: null,
      want: "gate_blocked",
    },
    {
      name: "tool domain not found",
      app: assigned,
      tool: "priv.get",
      domains: ["dom_a"],
      toolDomainId: null,
      want: "gate_blocked",
    },
    {
      name: "lophn creator, private tool",
      app: assigned,
      tool: "priv.get",
      domains: [],
      want: "gate_blocked",
    },
    {
      name: "public tool of another domain",
      app: assigned,
      tool: "r.get",
      domains: ["dom_b"],
      want: "succeeded",
    },
    {
      name: "private tool of own domain",
      app: assigned,
      tool: "priv.get",
      domains: ["dom_a"],
      want: "succeeded",
    },
  ];
  const kinds: [string, AppToolCaller, () => CallAuth][] = [
    ["program", programCaller(JOB, RUN), programAuth],
    ["flow", flowCaller(WFI), flowAuth],
  ];
  for (const [kind, caller, auth] of kinds) {
    for (const row of rows) {
      const name = `${kind}: ${row.name}`;
      const t = setup();
      t.state.assignment = [{ app: assigned, removed_tools: ["r.removed"] }];
      t.state.domains = row.domains === undefined ? [] : row.domains;
      if (row.toolDomainId !== undefined) {
        t.state.toolDomainId = row.toolDomainId;
      }
      const result = await t.path.call(
        { ...person(row.app, row.tool), caller },
        auth(),
      );
      assert.deepStrictEqual(status(result), row.want, name);
      if (row.want === "gate_blocked") {
        assert.deepStrictEqual(t.sent.length, 0, name);
        const [record] = [...t.records.values()];
        assert.deepStrictEqual(record.status, "denied", name);
        assert.deepStrictEqual(record.caller, caller, name);
      } else {
        assert.deepStrictEqual(t.sent.length, 1, name);
      }
    }
  }
});

test("앱 process의 parseProcessCall은 다섯 caller 종류에서 processCallRequestSchema와 같은 판정을 한다", () => {
  const callers: [string, unknown, boolean][] = [
    ["person", { kind: "person", view_session: "v1" }, true],
    ["agent", { kind: "agent", session: SES, turn: TRN, tool_call: TCL }, true],
    [
      "app",
      {
        kind: "app",
        app: newApp(),
        release: REL,
        parent_invocation: null,
      },
      true,
    ],
    ["program", programCaller(JOB, RUN), true],
    ["flow", flowCaller(WFI), true],
    ["flow without instance", { kind: "flow" }, false],
    ["flow with a job field", { kind: "flow", instance: WFI, job: JOB }, false],
    ["flow with another id kind", { kind: "flow", instance: JOB }, false],
    ["program without job_run", { kind: "program", job: JOB }, false],
    ["unknown kind", { kind: "timer", job: JOB }, false],
  ];
  for (const [name, caller, accepted] of callers) {
    const request = {
      invocation: ids.newId("inv"),
      tool: "r.get",
      context: {
        app: newApp(),
        release: REL,
        mode: "live",
        effect: "read",
        caller,
      },
    };
    assert.deepStrictEqual(
      processCallRequestSchema.safeParse(request).success,
      accepted,
      name,
    );
    assert.deepStrictEqual(
      parseProcessCall(request) !== undefined,
      accepted,
      name,
    );
  }
});
