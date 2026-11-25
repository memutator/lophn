import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  TerminalOutput,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../../protocol/events/mod.ts";
import type { TerminalApi } from "../../ipc/terminal.ts";
import type { EventMessage } from "../desktop/connection/events/client.ts";
import type { TerminalCore, TerminalReply } from "./core.ts";
import { TerminalDisplays } from "./displays.ts";
import { TerminalStore } from "./store.ts";
import type { TerminalView } from "./xterm-view.ts";

const runtime = (generation = 1): TerminalRuntime => ({
  terminal_ref: "term_1",
  generation,
  project: "project",
  folder_ref: "folder",
  cwd_at_start: "/work",
  program_path: "/bin/bash",
  state: "running",
  columns: 80,
  rows: 24,
  exit_code: null,
  failure_reason: null,
  output_seq: 0,
  dropped_output: false,
});
const output = (
  seq: number,
  chunk: string,
  generation = 1,
): TerminalOutput => ({
  terminal_ref: "term_1",
  generation,
  seq,
  chunk,
  dropped_output: false,
});

type Snapshot = TerminalReply<{
  runtime: TerminalRuntime;
  output: TerminalOutput[];
}>;

function setup() {
  const store = new TerminalStore(null, null);
  const requests: {
    input: { terminal: string; after_seq: number };
    finish(value: Snapshot): void;
  }[] = [];
  const watches: { terminal: string; on: boolean }[] = [];
  const writes: string[] = [];
  const replays: string[] = [];
  const replies: unknown[] = [];
  // 사람이 친 입력. reply는 테스트가 넘긴다.
  const inputs: {
    text: string;
    finish(
      reply:
        | { ok: true; value: null }
        | { ok: false; error: { code: string; message: string } },
    ): void;
  }[] = [];
  // view 크기 바꿈과 다시 쓰기의 순서.
  const order: string[] = [];
  let onMessage: (message: EventMessage) => void = () => {};
  let onData: (text: string) => void = () => {};
  let onScroll: (atBottom: boolean) => void = () => {};
  let bottom = true;
  let disposed = 0;
  let resets = 0;
  const event = (type: string, subject: string, payload: unknown) =>
    ({ type, subject, at: "2026-11-18T00:00:00.000Z", payload }) as BusEvent;
  const core = {
    // lease를 잡은 뒤에 snapshot을 읽는다. 답은 테스트가 넘긴다.
    watch: async (terminal: string, on: boolean) => {
      watches.push({ terminal, on });
      return { ok: true, value: {} } as const;
    },
    snapshot: (terminal: string, after_seq: number) =>
      new Promise<Snapshot>((finish) =>
        requests.push({ input: { terminal, after_seq }, finish }),
      ),
    subscribe: (listener: typeof onMessage) => {
      onMessage = listener;
      return () => {};
    },
  } satisfies Pick<TerminalCore, "snapshot" | "watch" | "subscribe">;
  const bridge = {
    respond: async (input) => {
      replies.push(input);
      return { ok: true, value: null };
    },
    input: (sent) =>
      new Promise((finish) => inputs.push({ text: sent.text, finish })),
    trace: async () => ({ ok: true, value: false }),
    shown: async () => ({ ok: true, value: null }),
  } satisfies Pick<TerminalApi, "respond" | "input" | "trace" | "shown">;
  const view: TerminalView = {
    write: (text) => {
      writes.push(text);
    },
    replay: (text) => {
      replays.push(text);
      order.push(`replay ${text}`);
    },
    resize: (columns, rows) => {
      order.push(`view ${columns}x${rows}`);
    },
    reset: () => {
      resets++;
    },
    focus() {},
    fit: () => null,
    atBottom: () => bottom,
    onScroll(listener) {
      onScroll = listener;
      return () => {
        onScroll = () => {};
      };
    },
    onData(listener) {
      onData = listener;
      return () => {
        onData = () => {};
      };
    },
    onLink: () => () => {},
    onPathLink: () => () => {},
    onTrace: () => () => {},
    copySelection: () => {},
    paste: () => {},
    dispose: () => {
      disposed++;
    },
  };
  const host = { isConnected: false, remove() {} } as unknown as HTMLElement;
  const edge = { remove() {} } as unknown as HTMLCanvasElement;
  const displays = new TerminalDisplays(store, core, bridge, {
    every: () => {},
  });
  const create = () => ({ host, edge, view });
  // watch 답 뒤에 snapshot을 부르므로 그 차례가 오기를 기다린다.
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const finish = async (
    index: number,
    chunks: TerminalOutput[],
    r = runtime(),
  ) => {
    await settle();
    requests[index]!.finish({
      ok: true,
      value: { output: chunks, runtime: r },
    });
    await settle();
  };
  return {
    store,
    displays,
    requests,
    writes,
    replays,
    replies,
    create,
    finish,
    emit: (chunks: TerminalOutput[]) => {
      for (const chunk of chunks) {
        onMessage({
          kind: "event",
          event: event("TerminalOutputAppended", "terminal:term_1", chunk),
        });
      }
    },
    runtime: (r: TerminalRuntime) =>
      onMessage({
        kind: "event",
        event: event("TerminalRuntimeChanged", "terminal:term_1", {
          runtime: r,
        }),
      }),
    ready: () => onMessage({ kind: "ready" }),
    screenChanged: (seq: number, diff?: unknown) =>
      onMessage({
        kind: "event",
        event: event("TerminalScreenChanged", "terminal:term_1", {
          terminal: "term_1",
          seq,
          ...(diff === undefined ? {} : { diff }),
        }),
      }),
    inputs,
    scroll: (atBottom: boolean) => {
      bottom = atBottom;
      onScroll(atBottom);
    },
    settle,
    watches,
    data: (text: string) => onData(text),
    disposed: () => disposed,
    resets: () => resets,
    order,
  };
}

test("snapshot 중 도착한 출력은 한 번만 쓰고 숨었다 돌아와도 view와 seq를 유지한다", async () => {
  const h = setup();
  h.store.adopt("tab", {
    terminalRef: "term_1",
    generation: 1,
    folderRef: "folder",
  });
  const display = h.displays.acquire("tab", "project", h.create);
  h.emit([output(1, "old"), output(2, "new")]);
  await h.finish(0, [output(1, "old")]);
  assert.deepStrictEqual(h.replays, ["old"]);
  // snapshot은 PTY 치수(80x24)로 쓰고, 칸에 다시 맞추는 일은 탭에 알린다.
  assert.deepStrictEqual(h.order, ["view 80x24", "replay old"]);
  assert.equal(h.store.get("tab")?.restored, 1);
  assert.deepStrictEqual(h.writes, ["new"]);
  h.emit([output(2, "new"), output(3, "background")]);
  assert.equal(
    h.displays.acquire("tab", "project", () => {
      throw new Error("duplicate view");
    }),
    display,
  );
  assert.equal(h.requests.length, 1);
  assert.deepStrictEqual(h.writes, ["new", "background"]);
  // 놓친 출력(seq 4)이 있으면 마지막 seq로 지금 화면을 다시 읽어 갈아 쓴다.
  h.emit([output(5, "after gap")]);
  assert.deepStrictEqual(h.requests[1]?.input, {
    terminal: "term_1",
    after_seq: 3,
  });
  await h.finish(1, [output(5, "screen")]);
  assert.equal(h.resets(), 1);
  assert.deepStrictEqual(h.replays, ["old", "screen"]);
  assert.deepStrictEqual(h.writes, ["new", "background"]);
  h.data("\x1b[?1;2c");
  await Promise.resolve();
  assert.deepStrictEqual(h.replies, [
    { terminal: "term_1", generation: 1, text: "\x1b[?1;2c" },
  ]);
  h.store.delete("tab");
  assert.equal(h.disposed(), 1);
  assert.deepStrictEqual(h.watches.at(-1), { terminal: "term_1", on: false });
  h.emit([output(4, "closed")]);
  assert.deepStrictEqual(h.writes, ["new", "background"]);
});

test("restart 전의 늦은 snapshot과 출력은 새 generation에 쓰지 않는다", async () => {
  const h = setup();
  h.store.request("tab");
  h.displays.acquire("tab", "project", h.create);
  h.store.update("tab", {
    terminalRef: "term_1",
    generation: 1,
    phase: { kind: "live", runtime: runtime() },
  });
  h.store.update("tab", {
    generation: 2,
    phase: { kind: "live", runtime: runtime(2) },
  });
  await h.finish(0, [output(1, "stale")]);
  h.emit([output(2, "stale push"), output(1, "fresh", 2)]);
  await h.finish(1, [output(1, "fresh", 2)], runtime(2));
  assert.deepStrictEqual(h.writes, ["fresh"]);
  assert.deepStrictEqual(h.replays, []);
  assert.equal(h.resets(), 1);
  h.runtime({ ...runtime(2), state: "exited", exit_code: 0 });
  h.runtime(runtime(2));
  assert.equal(h.store.get("tab")?.phase.kind, "ended");
  h.displays.retain("project", new Set());
  assert.equal(h.disposed(), 1);

  const cold = setup();
  cold.store.adopt("tab", {
    terminalRef: "term_1",
    generation: 1,
    folderRef: "folder",
  });
  cold.displays.acquire("tab", "project", cold.create);
  cold.emit([output(2, "during restore", 2)]);
  await cold.finish(0, [output(1, "new generation", 2)], runtime(2));
  assert.equal(cold.requests.length, 1);
  assert.deepStrictEqual(cold.writes, ["new generation", "during restore"]);
  assert.deepStrictEqual(cold.replays, []);
});

test("연결이 다시 붙었을 때 그 core에 터미널이 없으면 마지막 화면을 둔 채 끝난 터미널이 된다", async () => {
  const h = setup();
  h.store.adopt("tab", {
    terminalRef: "term_1",
    generation: 1,
    folderRef: "folder",
  });
  h.displays.acquire("tab", "project", h.create);
  await h.finish(0, [output(1, "screen")]);
  assert.equal(h.store.get("tab")?.phase.kind, "live");
  h.ready();
  await h.settle();
  h.requests[1]!.finish({ ok: false, code: "not_found", reason: null });
  await h.settle();
  const phase = h.store.get("tab")?.phase;
  assert.equal(phase?.kind, "ended");
  // runtime을 남겨 탭이 화면을 그대로 보이고 다시 시작을 준다.
  assert.equal(phase?.kind === "ended" && phase.runtime !== null, true);
});

test("다른 기계 화면 사본은 위로 scroll한 동안 reset을 미루고 맨 아래로 돌아오면 한 번 맞춘다", async () => {
  const h = setup();
  h.store.adopt("tab", {
    terminalRef: "term_1",
    generation: 1,
    folderRef: "folder",
  });
  h.displays.acquire("tab", "project", h.create);
  await h.finish(0, [output(1, "screen-1")]);
  assert.equal(h.resets(), 0);
  assert.equal(h.requests.length, 1);

  // 위로 scroll한 동안 TerminalScreenChanged가 여러 번 와도 snapshot·reset을 하지 않는다.
  h.scroll(false);
  h.screenChanged(2);
  h.screenChanged(3);
  await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.resets(), 0);

  // 맨 아래로 돌아오면 미뤄 둔 최신 사본을 한 번 읽어 맞춘다.
  h.scroll(true);
  assert.equal(h.requests.length, 2);
  assert.deepStrictEqual(h.requests[1]?.input, {
    terminal: "term_1",
    after_seq: 1,
  });
  await h.finish(1, [output(3, "screen-3")]);
  assert.equal(h.resets(), 1);
  assert.deepStrictEqual(h.replays, ["screen-1", "screen-3"]);
});

// 다른 기계의 터미널은 입력마다 기계 사이 왕복이다. 답을 기다리는 동안 친 글을 모아 한 번에 보내야 빨리 쳐도 밀리지 않고, 순서와 거절 규칙은 그대로여야 한다.
test("입력은 답을 기다리는 동안 모아 한 번에 보내고 순서를 지키며 거절되면 그 붙여넣기의 나머지를 버린다", async () => {
  const h = setup();
  h.store.adopt("tab", {
    terminalRef: "term_1",
    generation: 1,
    folderRef: "folder",
  });
  h.displays.acquire("tab", "project", h.create);
  await h.finish(0, [output(1, "screen")]);
  h.displays.setActive("tab", true);
  const ok = { ok: true, value: null } as const;

  h.data("a");
  h.data("b");
  h.data("c");
  assert.deepStrictEqual(
    h.inputs.map((one) => one.text),
    ["a"],
  );
  h.inputs[0]!.finish(ok);
  await h.settle();
  assert.deepStrictEqual(
    h.inputs.map((one) => one.text),
    ["a", "bc"],
  );
  h.inputs[1]!.finish(ok);
  await h.settle();

  // 큰 붙여넣기는 상한(8192자) 조각으로 나뉘어 하나씩 가고, 첫 조각이 거절되면 나머지는 가지 않지만 그 뒤에 친 글은 간다.
  h.data("x".repeat(8192 * 2 + 5));
  h.data("e");
  assert.equal(h.inputs.length, 3);
  assert.equal(h.inputs[2]!.text.length, 8192);
  h.inputs[2]!.finish({
    ok: false,
    error: { code: "forbidden", message: "no" },
  });
  await h.settle();
  assert.deepStrictEqual(
    h.inputs.slice(3).map((one) => one.text),
    ["e"],
  );
});

// diff가 맞는 화면 위에 오면 snapshot 없이 바뀐 줄만 쓰고, 바로 앞 화면이 아니면 snapshot으로 맞춰야 화면이 어긋나지 않는다.
test("TerminalScreenChanged의 diff는 base_seq가 맞을 때만 덮어쓰고 아니면 snapshot을 읽는다", async () => {
  const h = setup();
  h.store.adopt("tab", {
    terminalRef: "term_1",
    generation: 1,
    folderRef: "folder",
  });
  h.displays.acquire("tab", "project", h.create);
  await h.finish(0, [output(1, "screen-1")]);
  const diff = (base_seq: number) => ({
    generation: 1,
    base_seq,
    cursor: { x: 2, y: 1, hidden: false },
    lines: [{ row: 1, runs: [{ text: "ls", bold: true }], wrapped: false }],
  });

  h.screenChanged(2, diff(1));
  assert.equal(h.requests.length, 1);
  assert.deepStrictEqual(h.replays.slice(1), [
    "\x1b[?2026h\x1b[2;1H\x1b[2K\x1b[0;1mls\x1b[0m\x1b[2;3H\x1b[?25h\x1b[?2026l",
  ]);

  // seq 3을 놓쳤다. base가 2가 아니니 snapshot을 읽는다.
  h.screenChanged(4, diff(3));
  assert.equal(h.requests.length, 2);
  assert.deepStrictEqual(h.requests[1]?.input, {
    terminal: "term_1",
    after_seq: 2,
  });
});

// 초기 snapshot을 읽는 사이 화면 사본이 앞서가면 직후 바로 맞춰 다음 diff의 base_seq가 어긋나지 않아야 한다.
test("초기 snapshot 중 온 TerminalScreenChanged는 로드 직후 catch-up으로 맞춘다", async () => {
  const h = setup();
  h.store.adopt("tab", {
    terminalRef: "term_1",
    generation: 1,
    folderRef: "folder",
  });
  h.displays.acquire("tab", "project", h.create);
  await h.settle();
  // snapshot 응답 전에 더 큰 seq의 TerminalScreenChanged가 도착한다.
  h.screenChanged(2);
  await h.finish(0, [output(1, "screen-1")]);
  assert.equal(h.requests.length, 2);
  assert.deepStrictEqual(h.requests[1]?.input, {
    terminal: "term_1",
    after_seq: 1,
  });
});
