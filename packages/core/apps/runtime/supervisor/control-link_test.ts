import { assert, assertEquals } from "@std/assert";
import {
  encodeFrame,
  FrameDecoder,
} from "../../../../protocol/platform/mod.ts";
import {
  attachControlLink,
  type ControlReader,
  OpError,
} from "./control-link.ts";
import type { Supervisor } from "./supervisor.ts";

function frame(payload: unknown): Uint8Array {
  return encodeFrame({ kind: "json", channel: 0, payload });
}

function hello(credential = "cred-1"): Uint8Array {
  return frame({
    type: "hello",
    core_epoch: "epoch-1",
    process_identity: "epoch-1",
    kind: "apps/supervisor",
    task: "apps",
    scope: { operations: [], targets: {} },
    credential,
    api_port: 7431,
  });
}

function request(id: string, op: string, payload: unknown = {}): Uint8Array {
  return frame({ type: "worker_request", request_id: id, op, payload });
}

function scripted(frames: Uint8Array[]): ControlReader {
  const pending = frames.flatMap((bytes) => [...bytes]);
  return {
    read(buffer) {
      if (pending.length === 0) return Promise.resolve(null);
      const count = Math.min(buffer.length, pending.length);
      buffer.set(pending.splice(0, count));
      return Promise.resolve(count);
    },
  };
}

function supervisor(): Supervisor & { closed: number; stopped: number } {
  return {
    closed: 0,
    stopped: 0,
    reconcile: () => Promise.resolve(),
    restart: () => Promise.resolve(false),
    pause: () => Promise.resolve(true),
    prepare: () => Promise.resolve({ ok: false, reason: "unused" }),
    open: () => Promise.resolve(false),
    resume: () => Promise.resolve(),
    coreClosed() {
      this.closed += 1;
      return Promise.resolve();
    },
    observation: () => undefined,
    stop() {
      this.stopped += 1;
      return Promise.resolve();
    },
  } as Supervisor & { closed: number; stopped: number };
}

function wire() {
  const sent: unknown[] = [];
  return { sent, send: (message: unknown) => void sent.push(message) };
}

Deno.test("apps/runtime#R7: platform hello는 한 번이고 credential을 받은 뒤 ready로 답한다", async () => {
  const target = supervisor();
  const out = wire();
  const link = attachControlLink(target, scripted([hello()]), {
    send: out.send,
    ops: {},
  });
  await link.closed;
  assertEquals(link.credential(), "cred-1");
  assertEquals(link.apiPort(), 7431);
  assertEquals(out.sent[0], { type: "ready" });
});

Deno.test("apps/runtime#R7: 두 번째 hello는 protocol 위반이라 자식을 끝낸다", async () => {
  const target = supervisor();
  const out = wire();
  const link = attachControlLink(
    target,
    scripted([hello("cred-1"), hello("cred-2")]),
    { send: out.send, ops: {} },
  );
  await link.closed;
  assertEquals(link.credential(), "cred-1");
  assertEquals(target.closed, 1);
});

Deno.test("apps/runtime#R17: 제어 frame이 깨져도 core 단절로 자식을 끝낸다", async () => {
  const target = supervisor();
  const link = attachControlLink(
    target,
    scripted([new Uint8Array([1, 2, 3, 4])]),
    { send: () => undefined, ops: {} },
  );
  await link.closed;
  assertEquals(target.closed, 1);
});

Deno.test("apps/runtime#R17: 제어 EOF면 자식을 끝낸다", async () => {
  const target = supervisor();
  const link = attachControlLink(target, scripted([]), {
    send: () => undefined,
    ops: {},
  });
  await link.closed;
  assertEquals(target.closed, 1);
  assert(link.credential() === undefined);
});

Deno.test("apps/runtime#R17: hello 전의 요청과 모르는 op는 거절하고 처리 중인 요청이 읽기를 막지 않는다", async () => {
  const target = supervisor();
  const out = wire();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const link = attachControlLink(
    target,
    scripted([
      request("before", "apps.observe"),
      hello(),
      // 첫 요청은 풀리기 전까지 끝나지 않지만 뒤 요청이 먼저 답한다.
      request("slow", "apps.slow"),
      request("fast", "apps.fast"),
      request("unknown", "apps.nothing"),
      request("denied", "apps.denied"),
    ]),
    {
      send: out.send,
      ops: {
        "apps.slow": async () => {
          await gate;
          return { slow: true };
        },
        "apps.fast": () => {
          release();
          return Promise.resolve({ fast: true });
        },
        "apps.denied": () =>
          Promise.reject(new OpError("forbidden", "not allowed")),
      },
    },
  );
  await link.closed;
  const byId = new Map(
    out.sent.map((message) => [
      (message as { request_id?: string }).request_id ??
        (message as { type: string }).type,
      message as Record<string, unknown>,
    ]),
  );
  assertEquals(
    (byId.get("before")?.error as { code: string }).code,
    "unavailable",
  );
  assertEquals(byId.get("fast")?.payload, { fast: true });
  assertEquals(byId.get("slow")?.payload, { slow: true });
  assertEquals(
    (byId.get("unknown")?.error as { code: string }).code,
    "not_found",
  );
  assertEquals(
    (byId.get("denied")?.error as { code: string }).code,
    "forbidden",
  );
  // 빠른 요청이 먼저 보내졌다.
  const order = out.sent.map((m) => (m as { request_id?: string }).request_id);
  assert(order.indexOf("fast") < order.indexOf("slow"));
});

Deno.test("apps/runtime#R18: platform stop은 자식을 정리하고 stopped로 답한다", async () => {
  const target = supervisor();
  const out = wire();
  const link = attachControlLink(
    target,
    scripted([hello(), frame({ type: "stop", grace_ms: 5000 })]),
    { send: out.send, ops: {} },
  );
  await link.closed;
  assertEquals(target.stopped, 1);
  // 의도된 정지라 core 단절 처리를 하지 않는다.
  assertEquals(target.closed, 0);
  assertEquals(out.sent.at(-1), { type: "stopped" });
});

Deno.test("apps/runtime#R2: 응답 frame은 platform worker_response schema의 모양이다", async () => {
  const target = supervisor();
  const raw: Uint8Array[] = [];
  const link = attachControlLink(
    target,
    scripted([hello(), request("r1", "apps.echo", { a: 1 })]),
    {
      send: (message) =>
        void raw.push(encodeFrame({
          kind: "json",
          channel: 0,
          payload: message,
        })),
      ops: { "apps.echo": (payload) => Promise.resolve(payload) },
    },
  );
  await link.closed;
  const decoder = new FrameDecoder();
  const decoded = raw.flatMap((bytes) => decoder.push(bytes));
  assertEquals(
    decoded.map((item) => (item as { payload: unknown }).payload),
    [
      { type: "ready" },
      {
        type: "worker_response",
        request_id: "r1",
        ok: true,
        payload: { a: 1 },
      },
    ],
  );
});
