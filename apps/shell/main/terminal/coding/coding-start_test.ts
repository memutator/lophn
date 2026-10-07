import assert from "node:assert/strict";
import { existsSync, realpathSync, statSync } from "node:fs";
import { connect } from "node:net";
import { test } from "node:test";

import {
  createCodingHost,
  type HostEvent,
} from "../../../terminal-host/launch-plan.ts";
import { createHost, type HostRequest } from "../../../terminal-host/main.ts";
import type { TerminalReply, TerminalRuntime } from "../../../ipc/terminal.ts";
import {
  childPlanRunner,
  createCodingStart,
  createObservationStore,
} from "../coding-start.ts";
import { createSupervisor, type HostProcess } from "../supervisor.ts";
import {
  APP,
  CAC,
  connectionShown,
  fakeAgent,
  fakeLophn,
  hookPayload,
  launchPlan,
  pipePty,
  PRJ,
  tempDir,
  ticketDetail,
  TKT,
  until,
} from "./fixtures.ts";

const click = {
  ticket: TKT,
  ticket_revision: "12",
  connection: CAC,
  harness_id: "claude",
  profile_id: null,
  project: PRJ,
  folder_ref: "src",
};

type Options = {
  hostEnv?: Record<string, string>;
  planEnv?: Record<string, string>;
  timer?: (ms: number, fire: () => void) => () => void;
};

function world(options: Options = {}) {
  const agent = fakeAgent();
  const lophn = fakeLophn();
  const folder = realpathSync(tempDir("folder"));
  const pty = pipePty();
  const reads: string[] = [];
  const state = {
    ticket: ticketDetail() as unknown,
    connection: connectionShown() as unknown,
    folders: [{ folder_ref: "src", path: folder }],
  };
  const store = createObservationStore({ now: () => new Date().toISOString() });
  const host = createHost({
    pty,
    env: {
      PATH: `${agent.bin}:/usr/bin:/bin`,
      FAKE_AGENT_OUT: agent.out,
      API_TOKEN: "tok-secret",
      LOPHN_HOME: "/should/not/pass",
      ...options.hostEnv,
    },
    platform: "linux",
    exists: (file) => existsSync(file),
    checkFolder: (path) => {
      try {
        return statSync(path).isDirectory()
          ? { ok: true, path }
          : { ok: false, reason: "not_directory" };
      } catch {
        return { ok: false, reason: "unreadable" };
      }
    },
    schedule: (done) => setImmediate(done),
    coding: createCodingHost({
      platform: "linux",
      now: () => new Date().toISOString(),
      timer: options.timer ?? ((ms, fire) => {
        const handle = setTimeout(fire, ms);
        return () => clearTimeout(handle);
      }),
      emit: (event: HostEvent) =>
        store.onEvent(JSON.parse(JSON.stringify(event))),
      socketRoot: tempDir("sockets"),
    }),
  });
  const hostCalls: HostRequest[] = [];
  const start = createCodingStart({
    core: {
      internal(_kind, resource, method) {
        reads.push(`${resource}.${method}`);
        return Promise.resolve({
          ok: true as const,
          value: resource === "tickets" ? state.ticket : state.connection,
        });
      },
    },
    folders: { folders: () => Promise.resolve(state.folders) },
    plan: childPlanRunner({
      command: lophn.command,
      env: {
        PATH: process.env.PATH,
        FAKE_PLAN_EXECUTABLE: agent.executable,
        LOPHN_CONNECTION: "cac_01h455vb4pex5v6nkc6gd5fdw9",
        LOPHN_TERMINAL_OBSERVE: "/tmp/other.sock",
        API_TOKEN: "tok-secret",
        ...options.planEnv,
      },
    }),
    host: {
      async request(message) {
        const request = message as HostRequest;
        hostCalls.push(request);
        return await host.handle(request) as TerminalReply;
      },
    },
  });
  return {
    agent,
    lophn,
    folder,
    pty,
    reads,
    state,
    store,
    host,
    hostCalls,
    start,
    async finish(runtime?: TerminalRuntime) {
      if (runtime) {
        await host.handle({
          id: "close",
          type: "close",
          terminal_ref: runtime.terminal_ref,
          generation: runtime.generation,
        });
      }
      pty.stop();
    },
  };
}

async function begin(w: ReturnType<typeof world>) {
  const issued = w.start.issue(click);
  assert.equal(issued.ok, true);
  if (!issued.ok) throw new Error("not issued");
  const result = await w.start.start(issued.human_start_handle);
  return { issued, result };
}

test("shell/terminal#R4, #R12: 클릭이 일회 handle과 operation_id를 만들고 core를 다시 읽어 plan child로 받은 plan 그대로 host가 연다", async () => {
  const w = world();
  try {
    const { issued, result } = await begin(w);
    assert.match(issued.human_start_handle, /^hsh_[0-9a-f]+$/);
    assert.match(issued.operation_id, /^op_[0-9a-f]+$/);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // folder·ticket 현재 판·connection을 다시 읽었다.
    assert.deepEqual(w.reads, [
      "tickets.screen_detail",
      "coding_agent_connections.show",
    ]);
    // plan child는 사람이 고른 harness·등록 폴더 cwd와 다시 읽은 사실만 받았다.
    const input = w.lophn.read() as Record<string, unknown>;
    assert.equal(input.harness_id, "claude");
    assert.equal(input.cwd, w.folder);
    assert.equal(input.folder_ref, "src");
    assert.equal(input.human_start_handle, issued.human_start_handle);
    assert.equal(input.operation_id, issued.operation_id);
    assert.equal(input.method, "terminal_tui");
    const facts = input.facts as Record<string, unknown>;
    assert.equal(facts.ticket_app, APP);
    assert.equal(facts.screen_state, "ready");
    assert.equal(facts.connection_state, "active");
    // host가 plan의 executable·cwd로 shell 없이 열었다.
    assert.equal(result.runtime.launch_kind, "coding_tui");
    assert.equal(result.runtime.state, "running");
    assert.equal(result.runtime.cwd_at_start, w.folder);
    assert.equal(result.runtime.program_path, w.agent.executable);
    assert.equal(result.runtime.coding?.operation_id, issued.operation_id);
    await until(() => w.agent.read("env") !== undefined);
    assert.equal(
      w.agent.read("argv"),
      "--flag\nfirst prompt\nwith a second line\n",
    );
    assert.equal(w.agent.read("cwd"), `${w.folder}\n`);
    assert.equal(w.pty.children.length, 1);
    await w.finish(result.runtime);
  } finally {
    w.pty.stop();
  }
});

test("shell/terminal#R5: token 원문은 argv·환경·PTY 입력·runtime에 없고 TUI에는 connection 참조와 observe 경로만 간다", async () => {
  const w = world();
  try {
    const { result } = await begin(w);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await until(() => w.agent.read("env") !== undefined);
    const env = w.agent.read("env") ?? "";
    const lines = env.split("\n");
    assert.ok(lines.includes(`LOPHN_CONNECTION=${CAC}`));
    assert.ok(lines.some((line) => line.startsWith("LOPHN_TERMINAL_OBSERVE=")));
    // 공통 환경의 platform 값·secret은 빠지고 overlay의 안전 값은 있다.
    assert.equal(env.includes("tok-secret"), false);
    assert.equal(env.includes("LOPHN_HOME"), false);
    assert.ok(lines.includes("TERM=xterm-256color"));
    assert.equal((w.agent.read("argv") ?? "").includes("tok-secret"), false);
    assert.equal(JSON.stringify(result.runtime).includes("tok-secret"), false);
    assert.equal(w.pty.writes.length, 0);
    await w.finish(result.runtime);
  } finally {
    w.pty.stop();
  }
});

test("shell/terminal#R12: ticket 판·등록 폴더·connection이 바뀌면 plan도 spawn도 하지 않는다", async () => {
  const changedTicket = world();
  changedTicket.state.ticket = ticketDetail({ revision: "13" });
  const ticket = await begin(changedTicket);
  assert.equal(ticket.result.ok, false);
  assert.equal(!ticket.result.ok && ticket.result.reason, "ticket_changed");
  assert.equal(changedTicket.lophn.read(), undefined);
  assert.equal(changedTicket.pty.children.length, 0);

  const movedFolder = world();
  movedFolder.state.folders = [{
    folder_ref: "other",
    path: movedFolder.folder,
  }];
  const folder = await begin(movedFolder);
  assert.equal(!folder.result.ok && folder.result.reason, "folder_changed");
  assert.equal(movedFolder.reads.length, 0);
  assert.equal(movedFolder.pty.children.length, 0);

  const revoked = world();
  revoked.state.connection = connectionShown({ state: "revoked" });
  const connection = await begin(revoked);
  assert.equal(
    !connection.result.ok && connection.result.reason,
    "plan_refused",
  );
  assert.deepEqual(!connection.result.ok && connection.result.next, [
    "reconnect",
  ]);
  assert.equal(revoked.pty.children.length, 0);
  assert.equal(revoked.hostCalls.length, 0);
});

test("shell/terminal#R12: plan이 다른 harness·cwd를 내면 거절하고 대체하지 않는다", async () => {
  const otherHarness = world({ planEnv: { FAKE_PLAN_HARNESS: "codex" } });
  const harness = await begin(otherHarness);
  assert.equal(!harness.result.ok && harness.result.reason, "plan_mismatch");
  assert.equal(otherHarness.pty.children.length, 0);
  assert.equal(otherHarness.hostCalls.length, 0);

  const otherCwd = world({ planEnv: { FAKE_PLAN_CWD: "/somewhere/else" } });
  const cwd = await begin(otherCwd);
  assert.equal(!cwd.result.ok && cwd.result.reason, "plan_mismatch");
  assert.equal(otherCwd.pty.children.length, 0);
});

test("shell/terminal#R12: 모르는 handle·고르지 않은 입력은 거절하고 handle은 클릭마다 다르다", async () => {
  const w = world();
  const unknown = await w.start.start("hsh_not_issued");
  assert.equal(!unknown.ok && unknown.reason, "forbidden");
  assert.equal(
    w.start.issue({ ...click, harness_id: "not-a-harness" }).ok,
    false,
  );
  assert.equal(w.start.issue({ ...click, extra: 1 }).ok, false);
  const one = w.start.issue(click);
  const two = w.start.issue(click);
  assert.equal(one.ok && two.ok, true);
  if (!one.ok || !two.ok) return;
  assert.notEqual(one.human_start_handle, two.human_start_handle);
  assert.notEqual(one.operation_id, two.operation_id);
  assert.equal(w.pty.children.length, 0);
});

test("shell/terminal#R12: 같은 시작 요청의 재전달은 같은 runtime만 돌려주고 다시 spawn하지 않는다", async () => {
  const w = world();
  try {
    const { issued, result } = await begin(w);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const again = await w.start.start(issued.human_start_handle);
    assert.equal(
      again.ok && again.runtime.terminal_ref,
      result.runtime.terminal_ref,
    );
    assert.equal(w.pty.children.length, 1);
    assert.equal(w.reads.length, 2);
    // host도 같은 operation_id를 다시 받으면 같은 runtime_ref다.
    const plan = w.hostCalls[0];
    assert.equal(plan?.type, "open-coding");
    const direct = await w.host.handle({
      ...(plan as Extract<HostRequest, { type: "open-coding" }>),
      id: "again",
    });
    assert.equal(
      direct.ok && "runtime" in direct && direct.runtime.terminal_ref,
      result.runtime.terminal_ref,
    );
    assert.equal(w.pty.children.length, 1);
    await w.finish(result.runtime);
  } finally {
    w.pty.stop();
  }
});

test("shell/terminal#R12: stdin_after_ready는 readiness를 본 뒤 정확히 한 번 쓰고 delivered로 남는다", async () => {
  const w = world({
    hostEnv: { FAKE_AGENT_READY: "READY>", FAKE_AGENT_READ: "1" },
    planEnv: { FAKE_PLAN_DELIVERY: "stdin", FAKE_AGENT_READY: "READY>" },
  });
  try {
    const { result } = await begin(w);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.runtime.coding?.prompt_delivery, "pending");
    await until(() => w.agent.read("stdin") !== undefined);
    assert.equal(
      w.agent.read("stdin"),
      "\u001b[200~read the ticket, claim it with MCP, work, report\u001b[201~",
    );
    assert.equal(w.pty.writes.length, 1);
    const snapshot = await w.host.handle({
      id: "snap",
      type: "snapshot",
      terminal_ref: result.runtime.terminal_ref,
    });
    assert.equal(
      snapshot.ok && "runtime" in snapshot &&
        snapshot.runtime.coding?.prompt_delivery,
      "delivered",
    );
    await w.finish(result.runtime);
  } finally {
    w.pty.stop();
  }
});

test("shell/terminal#R12: 기한 안에 readiness가 없으면 not_delivered이고 재전송·재spawn이 없다", async () => {
  const fires: (() => void)[] = [];
  const delays: number[] = [];
  const w = world({
    planEnv: { FAKE_PLAN_DELIVERY: "stdin", FAKE_AGENT_READY: "NEVER>" },
    timer: (ms, fire) => {
      delays.push(ms);
      fires.push(fire);
      return () => {};
    },
  });
  try {
    const { result } = await begin(w);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(delays, [10_000]);
    fires[0]?.();
    const snapshot = await w.host.handle({
      id: "snap",
      type: "snapshot",
      terminal_ref: result.runtime.terminal_ref,
    });
    assert.equal(
      snapshot.ok && "runtime" in snapshot &&
        snapshot.runtime.coding?.prompt_delivery,
      "not_delivered",
    );
    assert.equal(w.pty.writes.length, 0);
    assert.equal(w.pty.children.length, 1);
    await w.finish(result.runtime);
  } finally {
    w.pty.stop();
  }
});

test("shell/terminal#R13: coding TUI는 다시 시작·resume되지 않고 새 [Start]만 있다", async () => {
  const w = world();
  try {
    const { result } = await begin(w);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const restart = await w.host.handle({
      id: "restart",
      type: "restart",
      terminal_ref: result.runtime.terminal_ref,
      generation: result.runtime.generation,
    });
    assert.equal(restart.ok, false);
    assert.equal(w.pty.children.length, 1);
    await w.finish(result.runtime);
  } finally {
    w.pty.stop();
  }
});

test("shell/terminal#R13: 관측은 hook 전 unknown·hook으로 갱신·host 종료 뒤 unknown·process exit는 ended이고 재시작은 빈 표라 unknown이다", async () => {
  const w = world();
  try {
    const { result } = await begin(w);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ref = result.runtime.terminal_ref;
    const first = w.store.current(ref);
    assert.equal(first.state, "unknown");
    assert.equal(w.store.latest(ref)?.origin, "lophn_terminal");
    await until(() => w.agent.read("env") !== undefined);
    const path = (w.agent.read("env") ?? "").split("\n").find((line) =>
      line.startsWith("LOPHN_TERMINAL_OBSERVE=")
    )?.slice("LOPHN_TERMINAL_OBSERVE=".length) ?? "";
    assert.ok(statSync(path).isSocket());
    await new Promise<void>((resolve) => {
      const client = connect(path);
      client.on("error", () =>
        resolve());
      client.on("close", () => resolve());
      client.on(
        "connect",
        () =>
          client.end(
            JSON.stringify(
              hookPayload({
                state: "working",
                observed_at: new Date().toISOString(),
              }),
            ) + "\n",
          ),
      );
    });
    await until(() => w.store.current(ref).state === "working");
    // 낡은 관측은 unknown이다.
    const later = new Date(Date.now() + 16 * 60_000).toISOString();
    const stale = createObservationStore({ now: () => later });
    stale.onEvent({
      event: "observation",
      envelope: {
        runtime_ref: ref,
        generation: 1,
        observation: w.store.latest(ref),
      },
    });
    assert.equal(stale.current(ref).state, "unknown");
    // host가 끝나면 ended 아닌 것은 unknown이다. ended는 그대로다.
    w.store.hostLost();
    assert.equal(w.store.current(ref).state, "unknown");
    // 새 Electron 실행의 표는 비어 있어 연 적 있는 runtime도 unknown이다.
    const restarted = createObservationStore({
      now: () => new Date().toISOString(),
    });
    assert.equal(restarted.current(ref).state, "unknown");
    assert.equal(restarted.latest(ref), null);
    await w.finish(result.runtime);
    await until(() => w.store.latest(ref)?.state === "ended");
    assert.equal(w.store.latest(ref)?.evidence_source, "process");
    w.store.hostLost();
    assert.equal(w.store.current(ref).state, "ended");
    // 소켓은 지워졌다.
    assert.equal(existsSync(path), false);
  } finally {
    w.pty.stop();
  }
});

test("shell/terminal#R13: supervisor는 host의 관측 줄을 넘기고 host가 끝나도 자동으로 다시 띄우지 않으며 coding runtime의 다시 시작을 거절한다", async () => {
  const written: string[] = [];
  const exits: ((code: number | null) => void)[] = [];
  let pushLine: (line: string) => void = () => {};
  let spawned = 0;
  const events: unknown[] = [];
  let lost = 0;
  const supervisor = createSupervisor({
    entry: "host.js",
    onEvent: (event) => events.push(event),
    onHostLost: () => lost++,
    spawnHost: () => {
      spawned++;
      const queue: string[] = [];
      let wake: (() => void) | undefined;
      pushLine = (line) => {
        queue.push(line + "\n");
        wake?.();
      };
      const host: HostProcess = {
        stdin: { write: (data) => void written.push(data) },
        stdout: {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              if (queue.length === 0) {
                await new Promise<void>((resolve) => (wake = resolve));
              }
              yield queue.shift() ?? "";
            }
          },
        },
        killed: false,
        kill() {
          return true;
        },
        on(_event, listener) {
          exits.push(listener);
        },
      };
      return host;
    },
  });
  const runtime = {
    terminal_ref: "term_1",
    project: PRJ,
    folder_ref: "src",
    cwd_at_start: "/work",
    program_path: "/bin/agent",
    launch_kind: "coding_tui",
    state: "running",
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: 0,
    dropped_output: false,
  };
  void supervisor.request({
    type: "open-coding",
    plan: launchPlan({ executable: "/bin/agent" }, "/work"),
    columns: 80,
    rows: 24,
  });
  await until(() => written.length === 1);
  const id = (JSON.parse(written[0] ?? "{}") as { id: string }).id;
  pushLine(JSON.stringify({ id, reply: { ok: true, runtime }, runtime }));
  pushLine(
    JSON.stringify({
      event: "observation",
      envelope: { runtime_ref: "term_1" },
    }),
  );
  await until(() => events.length === 1);
  assert.equal(spawned, 1);
  // coding runtime의 restart는 host에 닿지 않고 거절된다.
  const restart = await supervisor.request({
    type: "restart",
    terminal_ref: "term_1",
    generation: 1,
  });
  assert.equal(restart.ok, false);
  assert.equal(written.length, 1);
  // host가 끝나면 알리고, 자동 경로(snapshot·input)는 새 host를 띄우지 않는다.
  exits[0]?.(1);
  assert.equal(lost, 1);
  const snapshot = await supervisor.request({
    type: "snapshot",
    terminal_ref: "term_1",
  });
  assert.equal(snapshot.ok, false);
  assert.equal(spawned, 1);
});
