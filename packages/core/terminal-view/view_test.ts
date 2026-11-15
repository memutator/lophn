import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok, type Result } from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import type { HostFrameOf } from "../../protocol/host-link/frames.ts";
import { createTerminalView, LEASE_MS, type TerminalRequest } from "./view.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const TERMINAL = "trm_01hzx3k4m5n6p7q8r9s0t1v2w3";

const frame = (terminal: string, seq: number) =>
  ({
    type: "terminal_screen",
    terminal_ref: terminal,
    generation: 0,
    seq,
    columns: 80,
    rows: 24,
    cursor: { x: 0, y: 0, hidden: false },
    scrollback: [],
    lines: [],
  }) satisfies HostFrameOf<"terminal_screen">;

function setup(typing: (principal: string) => boolean = () => false) {
  const clock = manualClock(0);
  const calls: TerminalRequest[] = [];
  const published: BusEvent[] = [];
  let known = new Set([TERMINAL]);
  const view = createTerminalView({
    clock,
    publish: (event) => published.push(event),
    call: (request) => {
      calls.push(request);
      return Promise.resolve(
        ok([{ type: "text", text: "ok" }]) as Result<unknown>,
      );
    },
    known: (terminal) => known.has(terminal),
    mayType: typing,
  });
  return {
    view,
    clock,
    calls,
    published,
    forget: () => {
      known = new Set();
    },
  };
}

// 폰이 터미널에 글을 치면 컴퓨터에서 명령이 돈다. 허락받지 않은 기기의 입력은 host에 가면 안 된다.
test("terminal_view/input은 허락받은 principal만 host로 보내고 나머지는 forbidden이며, 목록에 없는 터미널은 not_found다", async () => {
  const { view, calls, forget } = setup(
    (principal) => principal === "device:yes",
  );
  const input = { terminal: TERMINAL, text: "ls\n", key: "k1" };

  const refused = await view.input("device:no", input);
  assert.ok(!refused.ok && refused.error.code === "forbidden");
  assert.deepEqual(calls, []);

  const sent = await view.input("device:yes", input);
  assert.ok(sent.ok);
  // 같은 key를 다시 보내면 host에 가지 않고 성공이다.
  assert.ok((await view.input("device:yes", input)).ok);
  assert.deepEqual(calls, [
    {
      kind: "terminal_input",
      payload: { terminal_ref: TERMINAL, text: "ls\n" },
    },
  ]);

  forget();
  const input2 = await view.input("device:yes", { ...input, key: "k2" });
  assert.ok(!input2.ok && input2.error.code === "not_found");
  const seen = view.snapshot("device:yes", TERMINAL);
  assert.ok(!seen.ok && seen.error.code === "not_found");
  const watched = await view.watch("device:yes", {
    terminal: TERMINAL,
    on: true,
  });
  assert.ok(!watched.ok && watched.error.code === "not_found");
});

test("lease가 있는 동안만 host가 화면을 밀고 core는 lease 없는 터미널의 화면을 버린다", async () => {
  const { view, clock, calls, published } = setup();
  view.screen(frame(TERMINAL, 1));
  assert.deepEqual(published, []);

  await view.watch("p1", { terminal: TERMINAL, on: true, tail: 50 });
  await view.watch("p2", { terminal: TERMINAL, on: true, tail: 200 });
  // 같은 호출을 다시 해도 host에는 다시 가지 않는다.
  await view.watch("p2", { terminal: TERMINAL, on: true, tail: 200 });
  assert.deepEqual(
    calls.map((call) => call.payload),
    [
      { terminal_ref: TERMINAL, on: true, tail: 50 },
      { terminal_ref: TERMINAL, on: true, tail: 200 },
    ],
  );

  view.screen(frame(TERMINAL, 2));
  assert.equal(published.length, 1);
  assert.equal(
    (published[0] as { subject: string }).subject,
    `terminal:${TERMINAL}`,
  );
  const shown = view.snapshot("p1", TERMINAL);
  assert.ok(shown.ok && shown.value.seq === 2 && shown.value.input === false);

  // p1은 갱신하고 p2는 멈춘다: 기한이 지나면 p2만 거두고 tail이 줄어든다.
  clock.advance(LEASE_MS - 1);
  await view.watch("p1", { terminal: TERMINAL, on: true, tail: 50 });
  clock.advance(2);
  view.expire();
  await flush();
  assert.deepEqual(calls.at(-1)!.payload, {
    terminal_ref: TERMINAL,
    on: true,
    tail: 50,
  });

  await view.watch("p1", { terminal: TERMINAL, on: false });
  await flush();
  assert.deepEqual(calls.at(-1)!.payload, {
    terminal_ref: TERMINAL,
    on: false,
    tail: 0,
  });
  const gone = view.snapshot("p1", TERMINAL);
  assert.ok(!gone.ok && gone.error.code === "unavailable");
});
