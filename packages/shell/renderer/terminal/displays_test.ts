import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  TerminalApi,
  TerminalCall,
  TerminalOutput,
  TerminalRuntime,
  TerminalSnapshot,
  TerminalSnapshotReply,
} from "../../ipc/terminal.ts";
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

function setup() {
  const store = new TerminalStore(null, null);
  const requests: {
    input: TerminalSnapshot;
    finish(value: TerminalCall<TerminalSnapshotReply>): void;
  }[] = [];
  const writes: string[] = [];
  const replays: string[] = [];
  const replies: unknown[] = [];
  let onOutput: (chunks: readonly TerminalOutput[]) => void = () => {};
  let onRuntime: (runtime: TerminalRuntime) => void = () => {};
  let onData: (text: string) => void = () => {};
  let disposed = 0;
  let resets = 0;
  const bridge = {
    snapshot: (input: TerminalSnapshot) =>
      new Promise<TerminalCall<TerminalSnapshotReply>>((finish) =>
        requests.push({ input, finish }),
      ),
    onOutput: (listener: typeof onOutput) => {
      onOutput = listener;
      return () => {};
    },
    onRuntime: (listener: typeof onRuntime) => {
      onRuntime = listener;
      return () => {};
    },
    respond: async (input) => {
      replies.push(input);
      return { ok: true, value: { ok: true, runtime: runtime() } };
    },
    input: async () => ({ ok: true, value: { ok: true, runtime: runtime() } }),
  } satisfies Pick<
    TerminalApi,
    "snapshot" | "onOutput" | "onRuntime" | "respond" | "input"
  >;
  const view: TerminalView = {
    write: (text) => {
      writes.push(text);
    },
    replay: (text) => {
      replays.push(text);
    },
    reset: () => {
      resets++;
    },
    focus() {},
    fit: () => null,
    onData(listener) {
      onData = listener;
      return () => {
        onData = () => {};
      };
    },
    onLink: () => () => {},
    onTitle: () => () => {},
    dispose: () => {
      disposed++;
    },
  };
  const host = { isConnected: false, remove() {} } as unknown as HTMLElement;
  const edge = { remove() {} } as unknown as HTMLCanvasElement;
  const displays = new TerminalDisplays(store, bridge);
  const create = () => ({ host, edge, view });
  const finish = async (
    index: number,
    chunks: TerminalOutput[],
    r = runtime(),
  ) => {
    requests[index]!.finish({
      ok: true,
      value: { ok: true, output: chunks, runtime: r },
    });
    await Promise.resolve();
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
    emit: (chunks: TerminalOutput[]) => onOutput(chunks),
    runtime: (r: TerminalRuntime) => onRuntime(r),
    data: (text: string) => onData(text),
    disposed: () => disposed,
    resets: () => resets,
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
  h.data("\x1b[?1;2c");
  await Promise.resolve();
  assert.deepStrictEqual(h.replies, [
    { terminal_ref: "term_1", generation: 1, text: "\x1b[?1;2c" },
  ]);
  h.store.delete("tab");
  assert.equal(h.disposed(), 1);
  assert.equal(h.requests.at(-1)?.input.watch, false);
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
