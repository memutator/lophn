import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFrame } from "../../../protocol/base/mod.ts";
import {
  createAppProcessLink,
  createSupervisorChannel,
} from "./supervisor-link.ts";
import {
  attachControlLink,
  OpError,
  StreamedPayload,
} from "./supervisor/control-link.ts";
import type { Supervisor } from "./supervisor/supervisor.ts";

// 지우면 rewind가 changeset이 많을 때 control frame 한도(256 KiB)에서 통째로 실패한다.
test("frame 한도를 넘는 rewind 적용도 한 번에 되돌린다", async () => {
  // core → supervisor pipe. 실제 frame으로 만들어 한도를 넘는 control frame이면 여기서 던진다.
  const pipe: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const push = (frame: Parameters<typeof encodeFrame>[0]) => {
    pipe.push(encodeFrame(frame));
    wake?.();
  };
  const reader = {
    async read(buffer: Uint8Array) {
      while (pipe.length === 0) {
        if (closed) return null;
        await new Promise<void>((resolve) => (wake = resolve));
      }
      const head = pipe[0];
      const count = Math.min(buffer.length, head.length);
      buffer.set(head.subarray(0, count));
      if (count === head.length) pipe.shift();
      else pipe[0] = head.subarray(count);
      return count;
    },
  };

  const channel = createSupervisorChannel();
  let received: string[] | undefined;
  const link = attachControlLink(
    {
      stop: () => Promise.resolve(),
      coreClosed: () => Promise.resolve(),
    } as unknown as Supervisor,
    reader,
    {
      // supervisor → core. 응답을 channel이 요청 id로 맞춘다.
      send: (message) => {
        channel.onMessage(message as { type: string });
      },
      sendBytes: (n, payload) =>
        channel.onFrame({ kind: "bytes", channel: n, payload }),
      sendEnd: (n) => channel.onFrame({ kind: "end", channel: n }),
      ops: {
        // 응답이 frame 한도를 넘는 호출이다. 본문은 응답 stream으로 돌아온다.
        "apps.call": () => {
          const response = {
            status: "ok",
            result: "x".repeat(600 * 1024),
            changeset: null,
          };
          return Promise.resolve(
            new StreamedPayload(
              new TextEncoder().encode(
                JSON.stringify({ sent: true, response }),
              ),
            ),
          );
        },
        "apps.apply": (payload, body) => {
          assert.deepStrictEqual(payload, { app: "app_1" });
          if (!body) throw new OpError("invalid_input", "no body");
          received = JSON.parse(new TextDecoder().decode(body)).changesets;
          return Promise.resolve({
            status: "applied",
            count: received!.length,
          });
        },
      },
    },
  );
  channel.bind({
    send: (payload) => {
      push({ kind: "json", channel: 0, payload });
      return Promise.resolve(true);
    },
    sendBytes: (n, payload) => {
      push({ kind: "bytes", channel: n, payload });
      return Promise.resolve(true);
    },
    sendEnd: (n) => {
      push({ kind: "end", channel: n });
      return Promise.resolve(true);
    },
    sendAbort: (n) => {
      push({ kind: "abort", channel: n });
      return Promise.resolve(true);
    },
  });
  push({
    kind: "json",
    channel: 0,
    payload: {
      type: "hello",
      core_epoch: "e",
      process_identity: "e",
      kind: "apps/supervisor",
      task: "apps",
      scope: { operations: [], targets: { task: "apps" } },
      credential: "secret",
      api_port: 1,
    },
  });

  const changesets = Array.from({ length: 40 }, (_, i) =>
    `${i}`.padStart(8, "0").repeat(1024),
  );
  const applied = await createAppProcessLink(channel).apply("app_1" as never, {
    changesets,
  });
  // 응답이 frame 한도를 넘는 호출은 stream으로 돌아와 그대로 닿는다.
  const called = await createAppProcessLink(channel).call(
    {} as never,
    {} as never,
  );
  closed = true;
  wake?.();
  await link.closed;

  assert.ok(called.sent && called.response?.status === "ok");
  assert.deepStrictEqual(
    (called.response as { result: string }).result.length,
    600 * 1024,
  );

  assert.ok(applied.ok);
  assert.deepStrictEqual(applied.value, { status: "applied", count: 40 });
  assert.deepStrictEqual(received, changesets);
});

// 보낸 뒤 응답을 잃은 호출은 실패가 아니라 결과 모름이다. 쓰기가 일어났는지 모르는 채 닫으면 안 된다.
test("큰 응답을 받다 끊긴 호출은 결과 모름이다", async () => {
  const channel = createSupervisorChannel();
  channel.bind({
    send: () => Promise.resolve(true),
    sendBytes: () => Promise.resolve(true),
    sendEnd: () => Promise.resolve(true),
    sendAbort: () => Promise.resolve(true),
  });
  const called = createAppProcessLink(channel).call({} as never, {} as never);
  channel.onMessage({
    type: "worker_response",
    request_id: "apps-request-1",
    ok: true,
    payload: { stream: 1 },
  } as never);
  channel.onFrame({
    kind: "bytes",
    channel: 1,
    payload: new TextEncoder().encode('{"sent":true,'),
  });
  channel.onFrame({ kind: "abort", channel: 1 });
  assert.deepStrictEqual(await called, { sent: true, response: null });
});
