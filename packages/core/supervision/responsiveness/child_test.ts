import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFrame } from "../../../protocol/base/mod.ts";
import { startChild } from "./child.ts";

const HELLO = encodeFrame({
  kind: "json",
  channel: 0,
  payload: {
    type: "hello",
    core_epoch: "e",
    process_identity: "e",
    kind: "lophn-agent/runtime",
    task: "lophn-agent",
    scope: { operations: [], targets: { task: "lophn-agent" } },
    credential: "secret",
    api_port: 1,
  },
});

// 끝나지 않으면 process가 살아 있는 채 turn이 running으로 남는다. 그 회귀는 timeout으로 드러난다.
test("쓰기 backlog가 넘쳐 writer가 fault면 child session이 끝난다", {
  timeout: 5_000,
}, async () => {
  let helloSent = false;
  let helloDone: () => void = () => {};
  const helloSeen = new Promise<void>((resolve) => {
    helloDone = resolve;
  });
  let stopped = 0;
  const child = startChild(
    {
      stdin: {
        read(buffer) {
          if (helloSent) return new Promise(() => {});
          helloSent = true;
          buffer.set(HELLO);
          return Promise.resolve(HELLO.length);
        },
      },
      // core가 읽지 않는 pipe: 쓰기가 끝나지 않아 backlog가 쌓인다.
      stdout: { write: () => new Promise(() => {}) },
    },
    {
      onHello: () => helloDone(),
      onStop: () => {
        stopped += 1;
      },
    },
  );
  const running = child.run();
  await helloSeen;

  const sends: Promise<void>[] = [];
  for (let i = 0; i < 300; i += 1) {
    sends.push(child.send({ type: "ready" }).catch(() => {}));
  }
  await assert.rejects(running, /backlog exceeded/);
  assert.equal(stopped, 1);
  assert.equal(child.stopped, true);
  await assert.rejects(child.send({ type: "ready" }));
});
