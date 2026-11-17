import assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalOutput, TerminalRuntime } from "../../ipc/terminal.ts";
import { createTerminalView, SCREEN_INTERVAL_MS } from "./terminal-view.ts";

// 화면 하나가 viewport와 scrollback tail 전체라, 출력마다 보내면 TUI(초당 30여 chunk)가 연결을 메운다.
test("보는 터미널의 화면은 켤 때 한 번, 출력이 이어지면 간격마다 한 번 보내고 마지막 출력 뒤 한 번은 꼭 보낸다", async () => {
  let seq = 0;
  let connected = true;
  const sent: unknown[] = [];
  const timers: (() => void)[] = [];
  const view = createTerminalView({
    screen: async () => ({
      seq: ++seq,
      generation: 1,
      columns: 80,
      rows: 24,
      cursor: { x: 0, y: 0, hidden: false },
      scrollback: [],
      lines: [],
    }),
    send(frame) {
      sent.push(frame);
      return true;
    },
    connected: () => connected,
    runtime: (ref) =>
      ref === "trm_a" ? ({ state: "running" } as TerminalRuntime) : undefined,
    type: async () => {},
    humanInput() {},
    resize: async () => {},
    release: async () => {},
    schedule(run, ms) {
      assert.equal(ms, SCREEN_INTERVAL_MS);
      timers.push(run);
      return () => timers.splice(timers.indexOf(run), 1);
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const output = (ref: string) =>
    view.output([{ terminal_ref: ref } as TerminalOutput]);
  const tick = async () => {
    timers.shift()?.();
    await settle();
  };

  // 켜지 않은 터미널의 출력은 보내지 않는다.
  output("trm_a");
  await settle();
  assert.equal(sent.length, 0);

  view.stream({ terminal_ref: "trm_a", on: true, tail: 10 });
  await settle();
  assert.equal(sent.length, 1);

  // 첫 출력은 바로, 간격 안의 출력 여럿은 간격 끝에 하나로 간다.
  output("trm_a");
  output("trm_a");
  output("trm_a");
  await settle();
  assert.equal(sent.length, 2);
  await tick();
  assert.equal(sent.length, 3);
  // 더 온 출력이 없으면 간격이 끝나도 보내지 않고 timer가 멈춘다.
  await tick();
  assert.equal(sent.length, 3);
  assert.equal(timers.length, 0);

  // 연결이 없을 때 온 출력은 쌓지 않는다.
  connected = false;
  output("trm_a");
  await tick();
  connected = true;
  await tick();
  assert.equal(sent.length, 3);

  // 연결이 다시 열리면 core가 다시 켜 줄 때까지 보내지 않는다.
  view.reset();
  output("trm_a");
  await settle();
  assert.equal(sent.length, 3);

  assert.deepEqual(view.stream({ terminal_ref: "trm_x", on: true, tail: 0 }), {
    error: { code: "not_found", message: "no such terminal" },
  });
});
