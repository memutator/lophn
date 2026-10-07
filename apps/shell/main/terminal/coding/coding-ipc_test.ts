import assert from "node:assert/strict";
import { test } from "node:test";

import type { TerminalReply, TerminalRuntime } from "../../../ipc/terminal.ts";
import { createChildRegistrar } from "../coding-children.ts";
import {
  createCodingStart,
  createObservationStore,
  type PlanRunner,
} from "./coding-start.ts";
import {
  APP,
  CAC,
  connectionShown,
  launchPlan,
  PRJ,
  ticketDetail,
  TKT,
} from "./fixtures.ts";
import {
  type CodingConnection,
  detectionSchema,
} from "../../desktop/coding-connection.ts";
import { harnessDetectionSchema } from "../../../../../packages/contracts/coding-agent/mod.ts";
import {
  codingSessions,
  createCodingIpc,
  hostEventSinks,
  registeredFolders,
} from "../../desktop/coding-ipc.ts";
import {
  type CallerContents,
  ContentsRegistry,
  type IpcEvent,
} from "../../desktop/ipc-guard.ts";

function sender(id: number, url: string): CallerContents {
  return { id, isDestroyed: () => false, mainFrame: { url, parent: null } };
}
function eventOf(contents: CallerContents): IpcEvent {
  return { sender: contents, senderFrame: contents.mainFrame };
}
const desktop = sender(1, "lophn-shell://desktop/index.html");
const overlay = sender(2, "lophn-shell://overlay/index.html");
function registry(): ContentsRegistry {
  const table = new ContentsRegistry();
  table.register({
    contents: desktop,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  table.register({
    contents: overlay,
    origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
  });
  return table;
}

const click = {
  ticket: TKT,
  ticket_revision: "12",
  connection: CAC,
  harness_id: "claude",
  profile_id: null,
  project: PRJ,
  folder_ref: "src",
};

function runtimeOf(
  ref: string,
  coding?: TerminalRuntime["coding"],
): TerminalRuntime {
  return {
    terminal_ref: ref,
    project: PRJ,
    folder_ref: "src",
    cwd_at_start: "/work/src",
    program_path: "/usr/bin/claude",
    launch_kind: coding === undefined ? "shell" : "coding_tui",
    state: "running",
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: 0,
    dropped_output: false,
    ...(coding === undefined ? {} : { coding }),
  };
}

function world(over: { plan?: PlanRunner; hostReply?: TerminalReply } = {}) {
  const requests: unknown[] = [];
  const connection = { calls: [] as string[] };
  const fakeConnection: CodingConnection = {
    detect: (mode) => {
      connection.calls.push(mode);
      return Promise.resolve({
        ok: true,
        value: { source: "cached", harnesses: [] },
      });
    },
    connect: (raw) => {
      connection.calls.push(`connect ${JSON.stringify(raw)}`);
      return Promise.resolve({
        ok: false,
        error: { code: "invalid_input", message: "x" },
      });
    },
  };
  const start = createCodingStart({
    core: {
      internal: (_kind, resource, method) =>
        Promise.resolve({
          ok: true as const,
          value: resource === "tickets" && method === "screen_detail"
            ? ticketDetail()
            : connectionShown(),
        }),
    },
    folders: {
      folders: () => Promise.resolve([{ folder_ref: "src", path: "/work/src" }]),
    },
    plan: over.plan ?? ((input) =>
      Promise.resolve({
        ok: true as const,
        data: {
          plan: launchPlan({ executable: "/usr/bin/claude" }, input.cwd, {
            human_start_handle: input.human_start_handle,
            operation_id: input.operation_id,
          }),
        },
      })),
    host: {
      request: (message) => {
        requests.push(message);
        return Promise.resolve(
          over.hostReply ?? {
            ok: true,
            runtime: runtimeOf("term_1", {
              operation_id: "op_1",
              ticket: TKT,
              connection: CAC,
              prompt_delivery: "none",
            }),
          },
        );
      },
    },
    credential_helper: "/opt/lophn/lophn-credential",
  });
  const ipc = createCodingIpc({
    registry: registry(),
    connection: fakeConnection,
    start,
    folders: () => Promise.resolve([]),
    sessions: () => [],
  });
  return { ipc, requests, connection };
}

test("shell/desktop#R19: coding 통로는 desktop 창 본문만 부르고 이름·모양이 다른 호출은 안으로 보내지 않는다", async () => {
  const { ipc, requests, connection } = world();
  const forbidden = await ipc(eventOf(overlay), { op: "detect" });
  assert.deepEqual(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.error.code, "forbidden");
  for (
    const bad of [
      null,
      {},
      { op: "create_connection" },
      { op: "detect", extra: 1 },
      { op: "revoke", connection: CAC },
      { op: "connect" },
    ]
  ) {
    const reply = await ipc(eventOf(desktop), bad);
    assert.equal(reply.ok, false, JSON.stringify(bad));
    if (!reply.ok) assert.equal(reply.error.code, "invalid_input");
  }
  assert.deepEqual(connection.calls, []);
  assert.deepEqual(requests, []);
});

test("coding-agent/harnesses#R2: 감지 호출과 사람이 누른 refresh는 서로 다른 호출이다", async () => {
  const { ipc, connection } = world();
  await ipc(eventOf(desktop), { op: "detect" });
  await ipc(eventOf(desktop), { op: "refresh" });
  const raw = { intent: "connect_with_harness", harness_id: "claude" };
  await ipc(eventOf(desktop), { op: "connect", request: raw });
  assert.deepEqual(connection.calls, [
    "detect",
    "refresh",
    `connect ${JSON.stringify(raw)}`,
  ]);
});

test("coding-agent/sessions#R2: [Start] 클릭 하나가 일회 handle을 만들어 그 자리에서 시작하고 확인 창 없이 host에 plan과 helper 경로를 넘긴다", async () => {
  const { ipc, requests } = world();
  const reply = await ipc(eventOf(desktop), { op: "start", click });
  assert.deepEqual(reply, {
    ok: true,
    value: { ok: true, runtime_ref: "term_1" },
  });
  assert.equal(requests.length, 1);
  const sent = requests[0] as {
    type: string;
    plan: { ticket: string; connection: string; cwd: string };
    credential_helper: string;
  };
  assert.equal(sent.type, "open-coding");
  assert.equal(sent.plan.ticket, TKT);
  assert.equal(sent.plan.connection, CAC);
  assert.equal(sent.plan.cwd, "/work/src");
  assert.equal(sent.credential_helper, "/opt/lophn/lophn-credential");
  // 같은 클릭을 다시 눌러도 새 handle이다. 이전 handle을 다시 쓰는 호출은 통로에 없다.
  const second = await ipc(eventOf(desktop), {
    op: "start",
    click: { ...click, folder_ref: "elsewhere" },
  });
  assert.equal(second.ok && (second.value as { ok: boolean }).ok, false);
  assert.equal(requests.length, 1);
});

test("coding-agent/sessions#R4: 클릭 모양이 다르면 거절하고 plan 거절·host 거절은 다른 것으로 바꾸지 않고 이유를 옮긴다", async () => {
  const { ipc, requests } = world();
  for (
    const bad of [
      {},
      { ...click, ticket: "tkt_bad" },
      { ...click, connection: APP },
      { ...click, cwd: "/etc" },
      { ...click, harness_id: "not-a-product" },
    ]
  ) {
    const reply = await ipc(eventOf(desktop), { op: "start", click: bad });
    assert.equal(reply.ok, false, JSON.stringify(bad));
    if (!reply.ok) assert.equal(reply.error.code, "invalid_input");
  }
  assert.deepEqual(requests, []);

  const refused = world({
    plan: () =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: "conflict",
          message: "revoked",
          details: { next: ["reconnect"] },
        },
      }),
  });
  const planRefused = await refused.ipc(eventOf(desktop), {
    op: "start",
    click,
  });
  assert.deepEqual(planRefused, {
    ok: true,
    value: {
      ok: false,
      reason: "plan_refused",
      next: ["reconnect"],
      own_terminal: false,
    },
  });
  assert.deepEqual(refused.requests, []);

  const hostRefused = world({
    hostReply: { ok: false, reason: "no_folder", message: "gone" },
  });
  const hostFailed = await hostRefused.ipc(eventOf(desktop), {
    op: "start",
    click,
  });
  assert.equal(
    hostFailed.ok && (hostFailed.value as { reason: string }).reason,
    "host_refused",
  );
});

test("coding-agent/sessions#R6: TUI 상태는 관측 표의 현재 값이고 일반 터미널은 싣지 않으며 prompt 전달 결과는 runtime 값 그대로다", () => {
  const store = createObservationStore({ now: () => "2026-10-07T00:10:00.000Z" });
  const runtimes = [
    runtimeOf("term_shell"),
    runtimeOf("term_1", {
      operation_id: "op_1",
      ticket: TKT,
      connection: CAC,
      prompt_delivery: "delivered",
    }),
    runtimeOf("term_2", {
      operation_id: "op_2",
      ticket: TKT,
      connection: CAC,
      prompt_delivery: "unknown",
    }),
  ];
  store.onEvent({
    event: "observation",
    envelope: {
      runtime_ref: "term_1",
      generation: 1,
      observation: observation("term_1", "waiting_input", "2026-10-07T00:09:00.000Z"),
    },
  });
  assert.deepEqual(codingSessions(runtimes, store), [
    {
      runtime_ref: "term_1",
      ticket: TKT,
      connection: CAC,
      tui: "waiting_input",
      prompt_delivery: "delivered",
    },
    {
      runtime_ref: "term_2",
      ticket: TKT,
      connection: CAC,
      tui: "unknown",
      prompt_delivery: "unknown",
    },
  ]);
});

function observation(ref: string, state: string, at: string) {
  return {
    harness_id: "claude",
    environment: { kind: "host", identity: "work" },
    profile_id: null,
    catalog_revision: "rev-1",
    adapter_revision: "rev-1",
    origin: "lophn_terminal",
    runtime_ref: ref,
    connection: CAC,
    ticket: TKT,
    cwd: "/work/src",
    provider_session: null,
    state,
    observed_at: at,
    evidence_source: "hook",
    evidence_ref: `hook-${ref}`,
    freshness: "fresh",
    reason: null,
  };
}

test("shell/terminal#R13: host가 보낸 줄은 child 등록과 관측 표가 같이 받고 host가 끝나면 둘 다 정리한다", async () => {
  const calls: { method: string; body: unknown }[] = [];
  const registrar = createChildRegistrar({
    core: () => ({
      internal: (_kind, _resource, method, body) => {
        calls.push({ method, body });
        return Promise.resolve({ ok: true });
      },
    }),
  });
  const store = createObservationStore({ now: () => "2026-10-07T00:10:00.000Z" });
  const sinks = hostEventSinks(registrar, store);
  sinks.onEvent({
    event: "child_started",
    runtime_ref: "term_1",
    connection: CAC,
    process_generation: "10.1",
    loader_identity: "/opt/lophn/lophn-credential",
  });
  sinks.onEvent({
    event: "observation",
    envelope: {
      runtime_ref: "term_1",
      generation: 1,
      observation: observation("term_1", "working", "2026-10-07T00:09:00.000Z"),
    },
  });
  await registrar.idle();
  assert.deepEqual(calls, [{
    method: "register_child",
    body: {
      connection: CAC,
      process_generation: "10.1",
      loader_identity: "/opt/lophn/lophn-credential",
    },
  }]);
  assert.equal(store.current("term_1").state, "working");
  sinks.onHostLost();
  await registrar.idle();
  assert.equal(store.current("term_1").state, "unknown");
  assert.deepEqual(calls.map((call) => call.method), [
    "register_child",
    "end_connection",
  ]);
});

test("documents/projects#R1: 등록된 project 폴더는 terminal이 다시 해석하는 folder_ref 규칙으로 나오고 읽지 못하면 비어 있다", async () => {
  const session = {
    call: (_kind: string, _resource: string, _method: string, body: unknown) => {
      assert.deepEqual(body, { status: "active" });
      return Promise.resolve({
        ok: true,
        value: {
          projects: [
            {
              id: PRJ,
              title: "Notes",
              folders: [{ path: "/work/a" }, { path: "/work/b" }],
            },
            { id: "prj_other", title: "Empty", folders: [] },
          ],
        },
      });
    },
  };
  assert.deepEqual(await registeredFolders(session), [
    { project: PRJ, project_name: "Notes", folder_ref: `${PRJ}_0`, path: "/work/a" },
    { project: PRJ, project_name: "Notes", folder_ref: `${PRJ}_1`, path: "/work/b" },
  ]);
  assert.deepEqual(await registeredFolders(null), []);
  assert.deepEqual(
    await registeredFolders({
      call: () => Promise.resolve({ ok: false }),
    }),
    [],
  );
});

test("coding-agent/harnesses#R2: main의 감지 모양은 contracts의 실제 감지 값을 그대로 통과한다", () => {
  const real = harnessDetectionSchema.parse({
    harness_id: "claude",
    catalog_revision: "1",
    environment: { kind: "host", identity: "desk" },
    profile_id: null,
    observed_at: "2026-10-07T00:00:00.000Z",
    discovery: "detected",
    candidates: [{
      path: "/usr/bin/claude",
      source: "path",
      executable_result: "ok",
    }],
    selected_executable: "/usr/bin/claude",
    version: { result: "verified", value: "1.2.3", reason: null },
    auth: { result: "verified", evidence: "login", reason: null },
    probe_results: [{ probe: "version", outcome: "ok", detail: null }],
    freshness: "fresh",
  });
  const local = detectionSchema.safeParse(real);
  assert.equal(local.success, true);
  assert.equal(local.success && local.data.selected_executable, "/usr/bin/claude");
});
