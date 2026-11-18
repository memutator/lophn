import assert from "node:assert/strict";
import { test } from "node:test";

import type { EventSocket } from "./events.ts";
import { createHostLink } from "./host-link.ts";

const WORKSPACE = {
  kind: "project",
  id: "prj_01h0000000000000000000000a",
} as const;
const REQUEST = "hrq_01h0000000000000000000000c";

function fakeSockets() {
  const opened: {
    url: string;
    sent: unknown[];
    open(): void;
    message(frame: unknown): void;
    close(): void;
  }[] = [];
  return {
    opened,
    open(url: string) {
      const listeners = {
        open: [] as (() => void)[],
        message: [] as ((text: string) => void)[],
        close: [] as (() => void)[],
      };
      const record = {
        url,
        sent: [] as unknown[],
        open: () => listeners.open.forEach((run) => run()),
        message: (frame: unknown) =>
          listeners.message.forEach((run) => run(JSON.stringify(frame))),
        close: () => listeners.close.forEach((run) => run()),
      };
      opened.push(record);
      const socket: EventSocket = {
        send: (text) => void record.sent.push(JSON.parse(text)),
        close: () => {},
        onOpen: (run) => void listeners.open.push(run),
        onMessage: (run) => void listeners.message.push(run),
        onClose: (run) => void listeners.close.push(run),
      };
      return socket;
    },
  };
}

function setup() {
  const sockets = fakeSockets();
  const waits: { ms: number; run: () => void }[] = [];
  const link = createHostLink({
    target: () => ({ apiPort: 4100, headers: { Authorization: "Bearer t" } }),
    sockets,
    schedule: (run, ms) => {
      waits.push({ ms, run });
      return () => {};
    },
  });
  return { link, sockets, waits };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("열리면 지금 보이는 것을 실은 hello부터 보내고, 끊기면 1초·2초로 늘려 다시 붙어 hello를 다시 보낸다", () => {
  const { link, sockets, waits } = setup();
  const opens: number[] = [];
  link.onOpen(() => opens.push(sockets.opened.at(-1)!.sent.length));
  link.visible({ workspaces: [WORKSPACE] });
  link.refresh();
  const first = sockets.opened[0]!;
  assert.equal(first.url, "ws://127.0.0.1:4100/host-link");
  first.open();
  const hello = {
    type: "hello",
    version: 1,
    workspaces: [WORKSPACE],
  };
  assert.deepEqual(first.sent, [hello]);
  // onOpen은 hello 뒤에 불린다.
  assert.deepEqual(opens, [1]);
  assert.equal(link.connected(), true);

  first.close();
  assert.equal(link.connected(), false);
  assert.equal(
    link.send({
      type: "report",
      tab: "tab_01h0000000000000000000000d",
      state: "closed",
    }),
    false,
  );
  waits.shift()!.run();
  // 두 번째 socket이 열리지 못하고 닫히면 대기가 두 배가 된다.
  sockets.opened[1]!.close();
  assert.deepEqual(
    waits.map((wait) => wait.ms),
    [2_000],
  );
  waits.shift()!.run();
  const third = sockets.opened[2]!;
  third.open();
  assert.deepEqual(third.sent, [hello]);
  assert.deepEqual(opens, [1, 1]);
});

test("request는 그 종류의 처리기를 거쳐 response로 가고, 처리기가 없는 종류와 끊긴 뒤의 답은 그렇게 다뤄진다", async () => {
  const { link, sockets, waits } = setup();
  let finish: (() => void) | undefined;
  link.onRequest("browser_call", (payload) =>
    Promise.resolve({ content: [{ type: "text", text: payload.view }] }),
  );
  link.onRequest(
    "tab_show",
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ content: [{ type: "text", text: "late" }] });
      }),
  );
  link.refresh();
  const socket = sockets.opened[0]!;
  socket.open();
  socket.message({
    type: "request",
    id: REQUEST,
    kind: "browser_call",
    payload: { view: "browser" },
  });
  socket.message({
    type: "request",
    id: "hrq_01h0000000000000000000000e",
    kind: "tab_close",
    payload: {},
  });
  await settle();
  assert.deepEqual(socket.sent.slice(1), [
    {
      type: "response",
      id: "hrq_01h0000000000000000000000e",
      result: "done",
      output: {
        error: {
          code: "unavailable",
          message: "This lophn app cannot handle tab_close requests yet.",
        },
      },
    },
    {
      type: "response",
      id: REQUEST,
      result: "done",
      output: { content: [{ type: "text", text: "browser" }] },
    },
  ]);

  // 끊긴 연결로 받은 요청은 다시 붙은 뒤에 끝나도 답하지 않는다(core가 이미 unavailable로 끝냈다).
  socket.message({
    type: "request",
    id: "hrq_01h0000000000000000000000f",
    kind: "tab_show",
    payload: { tab: "tab_01h0000000000000000000000d" },
  });
  await settle();
  socket.close();
  waits.shift()!.run();
  const next = sockets.opened[1]!;
  next.open();
  finish!();
  await settle();
  assert.deepEqual(
    next.sent.map((frame) => (frame as { type: string }).type),
    ["hello"],
  );
});
