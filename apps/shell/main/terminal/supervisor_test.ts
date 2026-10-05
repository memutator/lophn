import assert from "node:assert/strict";
import { test } from "node:test";

import type { TerminalReply, TerminalRuntime } from "../../ipc/terminal.ts";
import {
  createSupervisor,
  type HostProcess,
  type Supervisor,
} from "./supervisor.ts";

type FakeHost = HostProcess & {
  lines: string[];
  exit: (code: number | null) => void;
  push(line: string): void;
};

function runtime(state: TerminalRuntime["state"]): TerminalRuntime {
  return {
    terminal_ref: "term_1",
    project: "prj_1",
    folder_ref: "fld_a",
    cwd_at_start: "/work/a",
    program_path: "/bin/bash",
    launch_kind: "shell",
    state,
    generation: 1,
    columns: 80,
    rows: 24,
    exit_code: null,
    failure_reason: null,
    output_seq: 0,
    dropped_output: false,
  };
}

function fakeHost(): FakeHost {
  const listeners: Array<(code: number | null) => void> = [];
  const queued: string[] = [];
  let reader: ((line: string) => void) | null = null;
  const host: FakeHost = {
    lines: [] as string[],
    killed: false,
    stdin: {
      write(data: string) {
        host.lines.push(data);
      },
    },
    // 기다리는 독자가 있으면 줄을 즉시 넘기고, 없으면 보관한다. 빈 iterable은
    // supervisor의 줄 읽기를 끝내지 않는다.
    stdout: {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise<{ value: string; done: boolean }>((resolve) => {
              const line = queued.shift();
              if (line !== undefined) {
                resolve({ value: line, done: false });
                return;
              }
              reader = (value) => resolve({ value, done: false });
            }),
        };
      },
    },
    kill() {
      host.killed = true;
      return true;
    },
    on(event: "exit", listener: (code: number | null) => void) {
      if (event === "exit") listeners.push(listener);
    },
    exit(code: number | null) {
      for (const listener of listeners) listener(code);
    },
    push(line: string) {
      const text = line.endsWith("\n") ? line : `${line}\n`;
      if (reader) {
        const waiting = reader;
        reader = null;
        waiting(text);
      } else {
        queued.push(text);
      }
    },
  };
  return host;
}

/** 사람이 누른 결과 불명 뒤 [Start again] 시나리오. host 대역 둘을 준다. */
function lostThenManual(): {
  supervisor: Supervisor;
  lost: FakeHost;
  next: FakeHost;
  spawned: HostProcess[];
} {
  const lost = fakeHost();
  const next = fakeHost();
  const spawned: HostProcess[] = [lost];
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => spawned[spawned.length - 1]!,
  });
  return { supervisor, lost, next, spawned };
}

test("shell/terminal#R9: host exit는 살아 있던 터미널을 unknown으로 두고 다시 띄우지 않는다", () => {
  const child = fakeHost();
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => child,
  });
  void supervisor.request({ type: "open" });
  supervisor.note(runtime("running"));
  child.exit(null);
  const [gone] = supervisor.runtimes();
  assert.equal(gone?.state, "unknown");
  assert.equal(gone?.failure_reason, "host_lost");
  assert.equal(gone?.exit_code, null);
  assert.equal(child.killed, false);
});

test("shell/terminal#R10: Electron 종료는 host에 종료를 보내고 확인 전 running을 성공으로 두지 않는다", () => {
  const child = fakeHost();
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => child,
  });
  void supervisor.request({ type: "open" });
  supervisor.note(runtime("running"));
  const gone = supervisor.stop();
  assert.equal(child.killed, true);
  assert.equal(gone[0]?.state, "unknown");
  assert.equal(gone[0]?.failure_reason, "host_lost");
});

test("shell/terminal#R9: host가 이미 없으면 요청은 host_lost이고 입력을 보관하지 않는다", async () => {
  const child = fakeHost();
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => child,
  });
  void supervisor.request({ type: "open" });
  child.exit(1);
  const reply: TerminalReply = await supervisor.request({
    type: "input",
    text: "echo secret",
  });
  assert.equal(reply.ok, false);
  if (reply.ok) return;
  assert.equal(reply.reason, "host_lost");
  assert.equal(JSON.stringify(child.lines).includes("secret"), false);
});

test("shell/terminal#R9: 결과 불명 뒤 사람 누른 다시 시작은 새 host에서 등록 폴더를 새로 열고 옛 입력을 재생하지 않는다", async () => {
  const { supervisor, lost, next, spawned } = lostThenManual();
  void supervisor.request({ type: "open" });
  const observed = runtime("running");
  observed.terminal_ref = "term_1";
  supervisor.note(observed);
  // host를 죽여 결과 불명으로 둔다.
  lost.exit(null);

  // 자동 input은 죽은 host 뒤에 닿지 않는다. host도 새로 띄우지 않는다.
  const auto: TerminalReply = await supervisor.request({
    type: "input",
    text: "echo secret",
  });
  assert.equal(auto.ok, false);
  if (!auto.ok) assert.equal(auto.reason, "host_lost");
  assert.equal(spawned.length, 1, "자동 경로가 host를 새로 띬었다");

  // 사람이 [Start again]을 누른다. 새 host에서 등록 폴더로 다시 연다.
  spawned.push(next);
  const pending = supervisor.request({
    type: "restart",
    terminal_ref: "term_1",
    generation: 1,
  });
  // 새 host는 open의 reply 줄을 준다. 요청 id는 감독이 붙인다.
  const line = next.lines.find((frame) => frame.includes("open"));
  assert(line, "새 host에 open 요청이 서지 않았다");
  const request = JSON.parse(line.trim()) as { id: string };
  next.push(
    JSON.stringify({
      id: request.id,
      reply: { ok: true, runtime: { ...runtime("running"), generation: 2 } },
    }),
  );
  const reply: TerminalReply = await pending;
  assert.equal(reply.ok, true);
  assert.equal(spawned.length, 2, "사람 시작이 새 host를 띄지 않았다");
  assert.notEqual(spawned[1], lost);
  const request2 = JSON.parse(line.trim()) as {
    type?: string;
    text?: string;
  };
  assert.equal(request2.type, "open");
  assert.equal(JSON.stringify(next.lines).includes("secret"), false);
  assert.equal(JSON.stringify(next.lines).includes("restart"), false);
});

test("shell/terminal#R13: host exit 하나로 새 host를 띄우지 않고 살아 있던 터미널은 unknown이다", () => {
  const child = fakeHost();
  let launches = 0;
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => {
      launches += 1;
      return child;
    },
  });
  void supervisor.request({ type: "open" });
  supervisor.note(runtime("running"));
  child.exit(null);
  assert.equal(launches, 1, "exit만으로 host를 다시 띬었다");
  // 살아 있던 터미널의 관측은 unknown으로 남는다(자동 spawn·resume 없음).
  const [gone] = supervisor.runtimes();
  assert.equal(gone?.state, "unknown");
  assert.equal(gone?.failure_reason, "host_lost");
});

test("shell/terminal#R13: 사람 요청 둘은 host가 하나일 때 하나만 띄운다", async () => {
  const first = fakeHost();
  const spawned: HostProcess[] = [];
  const supervisor = createSupervisor({
    entry: "host.js",
    spawnHost: () => {
      spawned.push(first);
      return first;
    },
  });
  const a = supervisor.request({ type: "open" });
  const b = supervisor.request({ type: "open" });
  // 두 요청 다 살아 있는 첫 host를 만난다. 각 요청 id에 reply 줄을 준다.
  assert.equal(spawned.length, 1, "요청 두 개에 host를 둘 띬었다");
  for (const frame of first.lines) {
    const request = JSON.parse(frame.trim()) as { id: string };
    first.push(
      JSON.stringify({
        id: request.id,
        reply: { ok: true, runtime: runtime("starting") },
      }),
    );
  }
  assert.equal((await a).ok, true);
  assert.equal((await b).ok, true);
});
