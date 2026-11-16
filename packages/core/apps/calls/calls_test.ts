import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
// 앱 bundle이 싣는 cap-store처럼 전역 STORE_HOOKS를 설치한다. runtime은 그 hook으로 앱과 같은 연결을 쓴다.
import {
  closeConnection,
  openConnection,
} from "../../../sdk/cap-store/connection.node.ts";

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
import type { Assignment } from "../../../protocol/approvals/mod.ts";
import type { AppGrant } from "../../../protocol/apps/grants.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { AppProcessLink, InvocationLedger } from "../ports.ts";
import type { CallAuth } from "./caller.ts";
import { type AppCallsDeps, createAppCalls } from "./mod.ts";
import { parseProcessCall } from "../runtime/entrypoint/wire.ts";
import { processCallRequestSchema } from "../../../protocol/apps/calls/process-wire.ts";
import { decodeChangeset, settleResponse } from "./record.ts";
import {
  dumpClocks,
  dumpData,
  ensureSyncTables,
  hlcAtMs,
  openClock,
  stampLocal,
  type SyncDb,
} from "../../../protocol/apps/sync/mod.ts";
import { nodeSyncDb } from "../../../protocol/apps/sync/node-db.ts";
import type { FolderChange } from "../../folder/ports.ts";
import type { SyncLog, SyncLogRow } from "../sync/log.ts";
import { createStoreAccess } from "../runtime/entrypoint/cap-host.ts";
import {
  handleSnapshotMerge,
  handleSyncApply,
  handleSyncCleanup,
  handleSyncReapply,
} from "../runtime/entrypoint/control-server.ts";
import { createRuntimeState } from "../runtime/entrypoint/state.ts";
import {
  openSyncStore,
  syncedWrite,
  writeSnapshot,
} from "../runtime/entrypoint/sync.ts";

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
    assignment: null as Assignment["entries"] | null,
    // null이면 부른 앱이 만든 앱 모두의 tool을 부를 grant를 가졌다.
    grants: null as AppGrant[] | null,
    // agentToolCall이 돌려주는 agent와 workspace. agent가 null이면 tool call을 모른다.
    agent: "lophn_home" as AgentId | null,
    workspace: null as Workspace | null,
    // 이름에 "priv."가 붙은 tool만 비공개다. 기본 tool은 공개다.
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
    syncApply: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
    snapshot: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
    snapshotMerge: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
    syncCleanup: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
    syncReapply: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
  };

  const deps: AppCallsDeps = {
    callers: {
      agentToolCall: (_s, _t, tool) =>
        ok(
          tool === TCL && state.agent !== null
            ? { agent: state.agent, workspace: state.workspace }
            : null,
        ),
    },
    lookup: {
      // 이름이 "op."로 시작하면 operation이다(비공개).
      find: (_app, _release, kind, name) =>
        ok({
          release: state.release,
          effect: name.includes("w.") ? "write" : "read",
          public: kind === "command" && !name.includes("priv."),
        }),
      findPreview: (_app, nonce, _kind, name) => {
        const effect =
          nonce === state.preview.nonce
            ? state.preview.effects[name]
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
    kind: "command",
    name: tool,
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
    kind: "command",
    name: tool,
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

function flowAuth(
  instance = WFI,
  workspace: Workspace | null = { kind: "project", id: PRJ },
): CallAuth {
  return { actor: "flow", flow: { instance, agent: "lophn_home", workspace } };
}

function programAuth(): CallAuth {
  return {
    actor: "program",
    program: { job: JOB, job_run: RUN },
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
    // 화면이 폰 기기에서 맞춰진 변경이라고 주장(그 invocation은 core만 만든다)
    [
      "person claims device",
      t.path.call(
        {
          ...person(a, "w.one"),
          caller: {
            kind: "person",
            view_session: "v1",
            device: ids.newId("dev") as Id<"dev">,
          },
        },
        { actor: "user" },
      ),
    ],
    // 화면이 다른 기계에서 온 변경이라고 주장(그 invocation도 core만 만든다)
    [
      "person claims machine",
      t.path.call(
        {
          ...person(a, "w.one"),
          caller: {
            kind: "person",
            view_session: "v1",
            machine: ids.newId("mch") as Id<"mch">,
          },
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
    (s) => s.app === a && s.request.name.startsWith("w."),
  );
  assert.deepStrictEqual(aWrites.length, 1);
  assert.deepStrictEqual(
    t.sent.filter((s) => s.app === a && s.request.name === "r.get").length,
    1,
  );
  assert.deepStrictEqual(
    t.sent.filter((s) => s.app === other).map((s) => s.request.name),
    ["w.one"],
  );
  const first = aWrites[0];

  gates.get(first.request.invocation)!.resolve(okResponse);
  await until(() => t.sent.length >= 4);
  assert.deepStrictEqual(t.sent.length, 4);
  assert.deepStrictEqual(
    t.sent
      .filter((s) => s.app === a && s.request.name.startsWith("w."))
      .map((s) => s.request.name)
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

test("그 앱 workspace의 session만 그 앱의 preview tool을 부르고, 다른 workspace의 session은 앱 process에 닿지 못한다", async () => {
  const a = newApp();
  const b = newApp();
  const project = ids.newId("prj");
  const rows: [string, AgentId | null, Workspace | null, string][] = [
    [
      "app A workspace session",
      "lophn_home",
      { kind: "app", id: a },
      "succeeded",
    ],
    [
      "app B workspace session",
      "lophn_home",
      { kind: "app", id: b },
      "forbidden",
    ],
    ["home session", "lophn_home", null, "forbidden"],
    [
      "project workspace session",
      "lophn_home",
      { kind: "project", id: project },
      "forbidden",
    ],
    ["unknown tool call", null, null, "forbidden"],
  ];
  for (const [label, agent, workspace, expected] of rows) {
    const t = setup();
    t.state.agent = agent;
    t.state.workspace = workspace;
    t.state.preview.effects["w.new"] = "write";
    const done = await t.path.call(
      {
        target: { mode: "preview", app: a, process_nonce: "pv-nonce-1" },
        kind: "command",
        name: "w.new",
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

// 두 층을 core가 지키는 자리다. operation은 사람(화면) 말고는 handler에 닿지 못한다.
test("agent, 다른 앱, job, flow가 operation을 부르면 handler에 보내기 전에 denied로 막고 사람은 부른다", async () => {
  const t = setup();
  const from = newApp();
  const to = newApp();
  const operation = (app: Id<"app">, name = "op.w.save"): ToolCallInput => ({
    ...person(app, name),
    kind: "operation",
  });
  const rows: [string, ToolCallInput, CallAuth][] = [
    [
      "agent",
      {
        ...operation(to),
        caller: { kind: "agent", session: SES, turn: TRN, tool_call: TCL },
      },
      { actor: "agent" },
    ],
    [
      "program",
      { ...operation(to), caller: programCaller(JOB, RUN) },
      programAuth(),
    ],
    ["flow", { ...operation(to), caller: flowCaller(WFI) }, flowAuth()],
  ];
  for (const [label, input, auth] of rows) {
    const done = await t.path.call(input, auth);
    assert.deepStrictEqual(status(done), "gate_blocked", label);
  }
  // 앱은 실행 중인 부모 invocation이 있어야 자격을 얻는다.
  const gate = deferred<ProcessCallResponse>();
  t.state.handler = (request) =>
    request.name === "w.hold" ? gate.promise : Promise.resolve(okResponse);
  const holding = t.path.call(person(from, "w.hold"), { actor: "user" });
  await until(() => t.sent.length === 1);
  const parentId = t.sent[0].request.invocation;
  const byApp = await t.path.call(
    {
      ...operation(to),
      caller: {
        kind: "app",
        app: from,
        release: REL,
        parent_invocation: parentId,
      } as AppToolCaller,
    },
    { actor: "app", app: from },
  );
  assert.deepStrictEqual(status(byApp), "gate_blocked", "app");
  gate.resolve(okResponse);
  await holding;
  // 막힌 호출은 handler에 가지 않았고 operation으로 기록에 남았다.
  assert.deepStrictEqual(
    t.sent.filter((s) => s.request.kind === "operation").length,
    0,
  );
  assert.ok(
    [...t.records.values()].some(
      (row) =>
        row.status === "denied" &&
        row.operation.kind === "operation" &&
        row.caller?.kind === "agent",
    ),
  );

  const byPerson = await t.path.call(operation(to), { actor: "user" });
  assert.deepStrictEqual(status(byPerson), "succeeded");
  const sent = t.sent.at(-1)!.request;
  assert.deepStrictEqual([sent.kind, sent.name], ["operation", "op.w.save"]);
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

test("workflow instance가 부르는 앱 tool은 flow instance의 creator의 할당이나 앱 workspace 밖이면 실행되지 않는다", async () => {
  const assigned = newApp();
  const other = newApp();
  const rows: {
    name: string;
    app: Id<"app">;
    tool: string;
    workspace?: (app: Id<"app">) => Workspace | null;
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
      name: "private tool from a project workspace",
      app: assigned,
      tool: "priv.get",
      want: "gate_blocked",
    },
    {
      name: "private tool from another app workspace",
      app: assigned,
      tool: "priv.get",
      workspace: () => ({ kind: "app", id: other }),
      want: "gate_blocked",
    },
    {
      name: "lophn creator, private tool",
      app: assigned,
      tool: "priv.get",
      workspace: () => null,
      want: "gate_blocked",
    },
    {
      name: "public tool from a project workspace",
      app: assigned,
      tool: "r.get",
      want: "succeeded",
    },
    {
      name: "private tool of the app's own workspace",
      app: assigned,
      tool: "priv.get",
      workspace: (app) => ({ kind: "app", id: app }),
      want: "succeeded",
    },
  ];
  const caller = flowCaller(WFI);
  for (const row of rows) {
    const name = `flow: ${row.name}`;
    const t = setup();
    t.state.assignment = [{ app: assigned, removed_tools: ["r.removed"] }];
    const workspace =
      row.workspace === undefined ? undefined : row.workspace(row.app);
    const result = await t.path.call(
      { ...person(row.app, row.tool), caller },
      workspace === undefined ? flowAuth() : flowAuth(WFI, workspace),
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
      kind: "command",
      name: "r.get",
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

// 폴더·폰에서 온 것을 받는 컴퓨터 하나: 진짜 앱 DB와 같은 thread의 runtime handler, 흉내 낸 ledger와 sync log.
type LogLine = Omit<SyncLogRow, "changeset"> & {
  change_id: string | null;
  bytes: Uint8Array | null;
  resolved_at: string | null;
};

function receiver(schema: string) {
  const app = newApp();
  const file = join(
    mkdtempSync(join(tmpdir(), "lophn-folder-apply-")),
    "app.sqlite",
  );
  const raw = openConnection(file);
  raw.exec(schema);
  const store = createStoreAccess();
  const state = createRuntimeState({
    identity: {
      app,
      release: REL,
      bundleHash: "hash",
      mode: "live",
      processNonce: "nonce",
    },
    declaration: { operations: [], commands: [] } as never,
    broker: {} as never,
    store,
    dataSchema: 1,
    controlSocket: "socket",
  });
  state.ready = true;
  const sync = openSyncStore({
    database: store.database() as DatabaseSync,
    node: "receiver",
    machine: ids.newId("mch"),
    record: store,
    nowMs: () => clock.nowMs(),
    startChangeset: null,
  });
  state.sync = sync;

  const records = new Map<string, AppInvocation>();
  const ledger: Pick<InvocationLedger, "begin" | "finish"> = {
    begin: (row) => {
      const started = { ...row, status: "running" } as AppInvocation;
      records.set(row.id, started);
      return ok(started);
    },
    finish: (id, result) => {
      const changeset =
        result.changeset === null
          ? null
          : { hash: "h", size_bytes: result.changeset.length };
      const done = { ...records.get(id)!, ...result, changeset };
      records.set(id, done as AppInvocation);
      return Promise.resolve(ok(done as AppInvocation));
    },
  };

  const lines: LogLine[] = [];
  const append = (
    line: Partial<LogLine> & Pick<LogLine, "kind" | "origin">,
  ) => {
    const seq = lines.length + 1;
    lines.push({
      seq,
      release: REL,
      device: null,
      machine: null,
      hlc: null,
      invocation: null,
      change_id: null,
      bytes: null,
      resolved_at: null,
      ...line,
    });
    return ok(seq);
  };
  const log: Pick<
    SyncLog,
    | "duplicate"
    | "duplicateFrom"
    | "written"
    | "unknown"
    | "phone"
    | "machine"
    | "rebaseline"
    | "held"
    | "heldList"
    | "resolve"
    | "readChangeset"
  > = {
    duplicate: (device, id) =>
      ok(
        lines.find((l) => l.device === device && l.change_id === id)?.seq ??
          null,
      ),
    duplicateFrom: (machine, id) =>
      ok(
        lines.find((l) => l.machine === machine && l.change_id === id)?.seq ??
          null,
      ),
    async written(inv, hlc, bytes) {
      if (hlc !== undefined) {
        append({
          kind: "change",
          origin: "computer",
          hlc,
          bytes,
          invocation: inv.id,
        });
      }
    },
    async unknown(inv) {
      append({ kind: "snapshot", origin: "computer", invocation: inv.id });
    },
    phone: (inv, change, status) =>
      Promise.resolve(
        append({
          kind: status === "applied" ? "change" : "skipped",
          origin: "device",
          device: change.device,
          change_id: change.id,
          hlc: change.hlc,
          bytes: change.changeset,
          invocation: inv.id,
        }),
      ),
    machine: (inv, change, status) =>
      Promise.resolve(
        append({
          kind: status === "applied" ? "change" : "skipped",
          origin: "machine",
          machine: change.machine,
          change_id: change.id,
          hlc: change.hlc,
          bytes: change.changeset,
          invocation: inv.id,
        }),
      ),
    rebaseline: () =>
      Promise.resolve(append({ kind: "snapshot", origin: "computer" })),
    held: (_app, _release, change) =>
      Promise.resolve(
        append({
          kind: "held",
          origin: change.origin,
          device: change.device ?? null,
          machine: change.machine ?? null,
          change_id: change.id ?? null,
          hlc: change.hlc,
          bytes: change.changeset,
        }),
      ),
    heldList: () =>
      lines
        .filter((l) => l.kind === "held" && l.resolved_at === null)
        .map((l) => ({
          ...l,
          changeset: { hash: String(l.seq), size: l.bytes!.length },
        })),
    resolve(seq, at) {
      lines[seq - 1]!.resolved_at = at;
      return ok(undefined);
    },
    readChangeset: (hash) =>
      Promise.resolve(ok(lines[Number(hash) - 1]!.bytes!)),
  };

  const body = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  const reply = <T>(done: { status: number; body: unknown }): Result<T> =>
    done.status === 200
      ? ok(done.body as T)
      : err(
          (done.body as { error: { code: "conflict"; message: string } }).error,
        );
  const unused = () =>
    Promise.resolve(err({ code: "internal" as const, message: "unused" }));
  const link: AppProcessLink = {
    call: () => Promise.resolve({ sent: true, response: null }),
    apply: unused,
    snapshot: unused,
    syncApply: async (_app, request) =>
      reply(await handleSyncApply(state, body(request))),
    snapshotMerge: async (_app, request) =>
      reply(await handleSnapshotMerge(state, body(request))),
    syncCleanup: async (_app, request) =>
      reply(await handleSyncCleanup(state, body(request))),
    syncReapply: async (_app, request) =>
      reply(await handleSyncReapply(state, body(request))),
  };
  const calls = createAppCalls({
    callers: { agentToolCall: () => ok(null) },
    lookup: {
      find: () => ok(null),
      findPreview: () => Promise.resolve(ok(null)),
    },
    apps: { activeRelease: () => ok(REL), archived: () => ok(false) },
    ledger: ledger as InvocationLedger,
    link,
    assignmentOf: () => err({ code: "internal", message: "unused" }),
    appGrantsOf: () =>
      Promise.resolve(err({ code: "internal", message: "unused" })),
    clock,
    ids,
    sync: log,
  });

  // 이 기계의 write 하나(앱 handler가 바꾼 것과 그 clock).
  async function write(atMs: number, text: string) {
    clock.set(atMs);
    const done = await syncedWrite(sync, () => Promise.resolve(raw.exec(text)));
    assert.ok(done.ok);
  }
  return {
    app,
    raw,
    file,
    calls,
    link,
    records,
    lines,
    write,
    dump: () => `${dumpData(sync.db)}\n${dumpClocks(sync.db)}`,
    rows: (text: string) =>
      raw
        .prepare(text)
        .all()
        .map((row) => ({ ...row })),
    close: () => closeConnection(file),
  };
}

// 다른 replica(다른 기계나 폰)의 DB. 자기 node의 clock으로 write를 찍는다.
function replica(schema: string, node: string) {
  const db: SyncDb = nodeSyncDb(new DatabaseSync(":memory:"));
  db.exec(schema);
  ensureSyncTables(db, node);
  let seq = 0;
  return {
    db,
    write(atMs: number, text: string): FolderChange {
      db.exec("begin immediate");
      const session = db.session();
      db.exec(text);
      const changeset = session.changeset();
      session.close();
      const hlc = openClock(db).next(atMs);
      assert.ok(stampLocal(db, changeset, hlc).ok);
      db.exec("commit");
      seq += 1;
      return {
        id: String(seq),
        hlc: String(hlc),
        operation: "edit",
        started_at: new Date(atMs).toISOString(),
        changeset,
      };
    },
  };
}

const T0 = Date.parse("2026-11-16T00:00:00.000Z");
const OTHER = ids.newId("mch") as Id<"mch">;

// 지우면 다시 읽은 file이 변경을 두 번 적용해 Activity에 같은 변경이 둘 남거나, 제약에 걸린 변경 하나가 file 전체를 막거나,
// 다른 release의 file이 일부만 적용돼 사람의 data가 반쯤 바뀐다.
test("폴더 file을 적용해도 사람의 data를 잃거나 망가뜨리지 않는다: 같은 묶음을 두 번 적용하면 둘째는 data도 clock도 그대로이고 invocation과 log 줄이 늘지 않으며, 제약에 걸린 변경만 빠지고, 표가 맞지 않는 변경이 하나라도 있으면 묶음 전체가 아무것도 바꾸지 않는다", async () => {
  const schema =
    "create table item (id text primary key, title text, code text unique)";
  const here = receiver(schema);
  const other = replica(
    `${schema}; create table extra (id text primary key)`,
    "other",
  );
  await here.write(T0 + 500, "insert into item values ('r', 'mine', 'x')");
  const batch = [
    other.write(T0 + 1000, "insert into item values ('a', 'milk', 'm')"),
    other.write(T0 + 1001, "insert into item values ('b', 'eggs', 'x')"),
    other.write(T0 + 1002, "update item set title = 'milk 2' where id = 'a'"),
  ];
  const apply = (changes: FolderChange[]) =>
    here.calls.folder.applyChanges({
      app: here.app,
      release: REL,
      origin: OTHER,
      changes,
    });

  clock.set(T0 + 2000);
  assert.deepEqual(await apply(batch), {
    ok: true,
    value: { applied: 2, skipped: 1, duplicate: 0, held: 0 },
  });
  assert.deepEqual(here.rows("select id, title, code from item order by id"), [
    { id: "a", title: "milk 2", code: "m" },
    { id: "r", title: "mine", code: "x" },
  ]);
  const caller = [...here.records.values()][0]!.caller;
  assert.deepEqual(caller, {
    kind: "person",
    view_session: "1",
    machine: OTHER,
  });
  assert.deepEqual(
    here.lines.map((l) => [l.kind, l.origin, l.machine, l.change_id]),
    [
      ["change", "machine", OTHER, "1"],
      ["skipped", "machine", OTHER, "2"],
      ["change", "machine", OTHER, "3"],
    ],
  );

  const before = here.dump();
  const invocations = here.records.size;
  const logged = here.lines.length;
  assert.deepEqual(await apply(batch), {
    ok: true,
    value: { applied: 0, skipped: 0, duplicate: 3, held: 0 },
  });
  assert.equal(here.dump(), before);
  assert.equal(here.records.size, invocations);
  assert.equal(here.lines.length, logged);

  const mixed = await apply([
    other.write(T0 + 3000, "insert into item values ('c', 'tea', 't')"),
    other.write(T0 + 3001, "insert into extra values ('e')"),
  ]);
  assert.equal(!mixed.ok && mixed.error.code, "conflict");
  assert.equal(here.dump(), before);
  assert.equal(here.lines.length, logged);
  here.close();
});

// 지우면 받는 쪽이 아직 내보내지 않은 칸의 고침이 다른 기계의 옛 값으로 덮이거나, 합친 변경을 폰이 받지 못해 갈라진다.
test("snapshot 합치기는 받는 쪽만 고친 칸을 지우지 않고 다른 기계의 고침과 row를 더하며, 폰에는 '다시 snapshot' 줄이 남는다", async () => {
  const here = receiver(
    "create table item (id text primary key, title text, done integer)",
  );
  await here.write(T0 + 1000, "insert into item values ('a', 'milk', 0)");
  const dir = mkdtempSync(join(tmpdir(), "lophn-folder-merge-"));
  const copy = join(dir, "copy.sqlite");
  assert.ok(writeSnapshot(nodeSyncDb(here.raw), copy).ok);
  const there = nodeSyncDb(new DatabaseSync(copy));
  there.run("update lophn_sync_state set value = 'other' where key = 'node'");
  const otherWrite = (atMs: number, text: string) => {
    there.exec("begin immediate");
    const session = there.session();
    there.exec(text);
    const changeset = session.changeset();
    session.close();
    assert.ok(stampLocal(there, changeset, openClock(there).next(atMs)).ok);
    there.exec("commit");
  };
  otherWrite(T0 + 2000, "update item set done = 1 where id = 'a'");
  otherWrite(T0 + 2001, "insert into item values ('b', 'eggs', 0)");
  await here.write(
    T0 + 3000,
    "update item set title = 'milk R' where id = 'a'",
  );
  const snapshot = join(dir, "7.sqlite");
  assert.ok(writeSnapshot(there, snapshot).ok);

  const merge = () =>
    here.calls.folder.mergeSnapshot({
      app: here.app,
      release: REL,
      origin: OTHER,
      n: 7,
      path: snapshot,
    });
  assert.deepEqual(await merge(), {
    ok: true,
    value: { changed: true, deleted: 0 },
  });
  assert.deepEqual(here.rows("select id, title, done from item order by id"), [
    { id: "a", title: "milk R", done: 1 },
    { id: "b", title: "eggs", done: 0 },
  ]);
  const merged = [...here.records.values()].at(-1)!;
  assert.deepEqual(
    [merged.operation, merged.caller, merged.status, merged.changeset !== null],
    [
      { kind: "operation", name: "lophn.snapshot_merge" },
      { kind: "person", view_session: "snapshot:7", machine: OTHER },
      "succeeded",
      true,
    ],
  );
  assert.deepEqual(
    here.lines.map((l) => [l.kind, l.origin, l.invocation]),
    [["snapshot", "computer", null]],
  );

  // 같은 snapshot을 다시 합치면 바뀐 것이 없고 '다시 snapshot' 줄도 없다.
  assert.deepEqual(await merge(), {
    ok: true,
    value: { changed: false, deleted: 0 },
  });
  assert.equal(here.lines.length, 1);
  here.close();
});

// 지우면 흔적을 정리한 뒤 늦게 온 변경이 지운 row를 몰래 되살리거나, 그 변경이 아무 데도 남지 않고 버려진다.
test("정리된 흔적과 부딪는 변경은 버려지지 않는다: horizon 이하 clock으로 지운 row를 되살리려는 폴더 변경과 폰 변경은 DB를 바꾸지 않고 bytes 그대로 held 줄이 되고(폰에는 skipped), apply하면 이 기계의 새 write로 들어가 내보내지며, discard해도 bytes가 남는다", async () => {
  const schema = "create table item (id text primary key, title text)";
  const here = receiver(schema);
  await here.write(T0 + 1000, "insert into item values ('x', 'mine')");
  await here.write(T0 + 3000, "delete from item where id = 'x'");
  const cleaned = await here.link.syncCleanup(here.app, {
    before: String(hlcAtMs(T0 + 3500)),
  });
  assert.ok(cleaned.ok && cleaned.value.status === "cleaned");
  assert.equal(cleaned.value.dropped, 1);

  const theirs = replica(schema, "other").write(
    T0 + 2000,
    "insert into item values ('x', 'theirs')",
  );
  const fromPhone = replica(schema, "phone").write(
    T0 + 2500,
    "insert into item values ('x', 'phone')",
  );
  const before = here.dump();
  clock.set(T0 + 4000);
  assert.deepEqual(
    await here.calls.folder.applyChanges({
      app: here.app,
      release: REL,
      origin: OTHER,
      changes: [theirs],
    }),
    { ok: true, value: { applied: 0, skipped: 0, duplicate: 0, held: 1 } },
  );
  const device = ids.newId("dev") as Id<"dev">;
  const pushed = await here.calls.phone.apply({
    app: here.app,
    release: REL,
    operation: "edit",
    started_at: fromPhone.started_at!,
    change: {
      device,
      id: "p1",
      hlc: fromPhone.hlc,
      changeset: fromPhone.changeset,
    },
  });
  assert.equal(pushed.ok && pushed.value.status, "skipped");
  assert.equal(here.dump(), before);

  const held = here.calls.syncHeld.list(here.app);
  assert.ok(held.ok);
  assert.deepEqual(
    held.value.map((l) => [l.machine, l.device, l.hlc]),
    [
      [OTHER, null, theirs.hlc],
      [null, device, fromPhone.hlc],
    ],
  );
  assert.deepEqual(here.lines[held.value[0]!.seq - 1]!.bytes, theirs.changeset);
  assert.deepEqual(
    here.lines[held.value[1]!.seq - 1]!.bytes,
    fromPhone.changeset,
  );

  const applied = await here.calls.syncHeld.apply(
    here.app,
    held.value[0]!.seq,
    {
      kind: "person",
      view_session: "v1",
    },
  );
  assert.ok(applied.ok);
  assert.deepEqual(here.rows("select id, title from item"), [
    { id: "x", title: "theirs" },
  ]);
  const written = here.lines.at(-1)!;
  assert.deepEqual(
    [written.kind, written.origin, written.invocation],
    ["change", "computer", applied.value.invocation],
  );
  assert.ok(BigInt(written.hlc!) > BigInt(theirs.hlc));
  assert.equal(
    here.records.get(applied.value.invocation)!.operation.kind,
    "operation",
  );

  assert.ok(here.calls.syncHeld.discard(here.app, held.value[1]!.seq).ok);
  const after = here.calls.syncHeld.list(here.app);
  assert.deepEqual(after.ok && after.value, []);
  const kept = here.lines[held.value[1]!.seq - 1]!;
  assert.ok(kept.resolved_at !== null);
  assert.deepEqual(kept.bytes, fromPhone.changeset);
  here.close();
});
