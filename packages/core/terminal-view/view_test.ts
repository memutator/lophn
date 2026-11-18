import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok } from "../../base/mod.ts";
import type { TerminalRuntime } from "../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import type { TerminalScreen } from "../terminals/ports.ts";
import { createTerminalView, LEASE_MS } from "./view.ts";

const TERMINAL = "trm_01hzx3k4m5n6p7q8r9s0t1v2w3";
// 기기가 `terminals/open`으로 연 터미널이다.
const OPENED = "trm_01hzx3k4m5n6p7q8r9s0t1v2w4";

const screen = (seq: number): TerminalScreen => ({
  generation: 1,
  seq,
  columns: 80,
  rows: 24,
  cursor: { x: 0, y: 0, hidden: false },
  scrollback: [],
  lines: [],
});

const runtime = (ref: string, remote = false) =>
  ({
    terminal_ref: ref,
    project: "prj_x",
    state: "running",
    generation: 1,
    columns: 80,
    rows: 24,
    ...(remote ? { remote_size: true } : {}),
  }) as TerminalRuntime;

function setup() {
  const clock = manualClock(0);
  const calls: unknown[] = [];
  const published: BusEvent[] = [];
  const timers: (() => void)[] = [];
  let known = new Set([TERMINAL]);
  let seq = 1;
  let remote = false;
  const view = createTerminalView({
    clock,
    publish: (event) => published.push(event),
    terminals: {
      resize: (terminal, _generation, size, options) => {
        calls.push({ resize: terminal, ...size, remote: options.remote });
        remote = options.remote;
        return Promise.resolve(ok(runtime(terminal, remote)));
      },
      screen: (terminal, tail) => {
        calls.push({ screen: terminal, tail });
        return Promise.resolve(ok(screen(seq)));
      },
      runtime: (terminal) => runtime(terminal, remote),
    },
    after: (_ms, run) => {
      timers.push(run);
      return () => {};
    },
    known: (terminal) => known.has(terminal),
    mayType: () => false,
  });
  return {
    view,
    clock,
    calls,
    published,
    tick: () => {
      seq += 1;
      for (const run of timers.splice(0)) run();
    },
    forget: () => {
      known = new Set();
    },
  };
}

// 폰은 coding session의 터미널과 자기가 연 터미널만 본다. 목록에 없는 desktop 터미널의 화면이 폰에 가면 안 된다.
test("목록에 없는 터미널은 snapshot도 watch도 not_found다", async () => {
  const { view, forget } = setup();
  forget();
  const seen = view.snapshot("device:yes", TERMINAL);
  assert.ok(!seen.ok && seen.error.code === "not_found");
  const watched = await view.watch("device:yes", {
    terminal: TERMINAL,
    on: true,
  });
  assert.ok(!watched.ok && watched.error.code === "not_found");
});

// lease가 없는 터미널의 화면을 계속 읽으면 core가 쉬지 않고, 폰이 떠난 뒤에도 PTY가 폰 크기로 남으면 desktop 탭이 깨진다.
test("lease가 있는 동안만 화면을 읽고, lease가 다 끝나면 읽기를 멈추고 폰이 잡은 크기를 놓는다", async () => {
  const { view, clock, calls, published, tick } = setup();
  await view.watch("p1", { terminal: TERMINAL, on: true, tail: 50 });
  await view.watch("p2", { terminal: TERMINAL, on: true, tail: 200 });
  assert.equal(published.length, 1);
  assert.equal(
    (published[0] as { subject: string }).subject,
    `terminal:${TERMINAL}`,
  );
  const shown = view.snapshot("p1", TERMINAL);
  assert.ok(shown.ok && shown.value.seq === 1 && shown.value.input === false);

  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), { screen: TERMINAL, tail: 200 });
  assert.equal(published.length, 2);

  assert.ok(
    (await view.resize("p1", { terminal: TERMINAL, columns: 40, rows: 20 })).ok,
  );
  // p1은 갱신하고 p2는 멈춘다: 기한이 지나면 p2만 거두고 tail이 줄어든다.
  clock.advance(LEASE_MS - 1);
  await view.watch("p1", { terminal: TERMINAL, on: true, tail: 50 });
  clock.advance(2);
  view.expire();
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), { screen: TERMINAL, tail: 50 });

  await view.watch("p1", { terminal: TERMINAL, on: false });
  assert.deepEqual(calls.at(-1), {
    resize: TERMINAL,
    columns: 80,
    rows: 24,
    remote: false,
  });
  const reads = calls.length;
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, reads);
  const gone = view.snapshot("p1", TERMINAL);
  assert.ok(!gone.ok && gone.error.code === "unavailable");
});

// 폰은 coding session의 터미널과 자기가 연 터미널만 본다. 남이 보는 desktop 터미널의 크기는 보지 않는 principal이 바꾸지 못한다.
test("폰이 연 터미널은 목록에 없어도 보이고, 크기는 그 터미널을 보는 principal만 잡는다", async () => {
  const { view, calls } = setup();
  const before = await view.watch("p1", { terminal: OPENED, on: true });
  assert.ok(!before.ok && before.error.code === "not_found");

  view.adopt(OPENED);
  assert.ok((await view.watch("p1", { terminal: OPENED, on: true })).ok);

  const resized = await view.resize("p1", {
    terminal: TERMINAL,
    columns: 40,
    rows: 20,
  });
  assert.ok(!resized.ok && resized.error.code === "conflict");
  await view.watch("p1", { terminal: TERMINAL, on: true });
  assert.ok(
    (await view.resize("p1", { terminal: TERMINAL, columns: 40, rows: 20 })).ok,
  );
  assert.deepEqual(calls.at(-1), {
    resize: TERMINAL,
    columns: 40,
    rows: 20,
    remote: true,
  });
});
