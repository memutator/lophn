// 세 질문
// - contract: boundary `models`. 호출 하나의 무응답은 temporary 실패이고 loop(`run-loop`)는 그 결과만 보고 retry한다.
// - 현실적 회귀: 첫 글 전이나 stream 중간에 provider가 멎었는데 turn이 stall_ms 300초를 다 기다리는 것. 반대로 ping은 오는데 끊는 것.
// - 지금 못 잡는 이유: 제품에 호출당 timeout이 없었고(timeoutMs가 늘 null) invoke에 test가 없었다.

import { assertEquals, assertObjectMatch } from "@std/assert";
import {
  type IdleTimer,
  MODEL_IDLE_MS,
} from "../../../packages/core/lophn-agent/providers/invoke.ts";
import {
  callWire,
  loadFixture,
  replayFetch,
  wireBinding,
} from "../../support/wire/mod.ts";

const encoder = new TextEncoder();
const aborted = () => new DOMException("aborted", "AbortError");

// 기한마다 부른 (ms, signal)을 기록한다. test가 fire()로 그 기한을 푼다.
function fakeTimer() {
  type Deadline = { ms: number; signal: AbortSignal; fire(): void };
  const deadlines: Deadline[] = [];
  const waiters: { count: number; resolve(): void }[] = [];
  const timer: IdleTimer = (ms, signal) =>
    new Promise((resolve) => {
      deadlines.push({ ms, signal, fire: () => resolve("elapsed") });
      signal.addEventListener("abort", () => resolve("aborted"), {
        once: true,
      });
      for (const waiter of waiters) {
        if (deadlines.length >= waiter.count) waiter.resolve();
      }
    });
  // 기한이 n개가 될 때까지 기다린다. sleep이 아니라 timer 호출이 신호다.
  const armed = (count: number) =>
    deadlines.length >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => waiters.push({ count, resolve }));
  return { timer, deadlines, armed };
}

// test가 chunk를 한 덩이씩 밀어 넣는 fetch다. header를 안 주면 fetch 자체가 풀리지 않는다.
function liveFetch(options: { header: boolean }) {
  const sent = Promise.withResolvers<AbortSignal>();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetch = ((_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    sent.resolve(signal);
    return new Promise<Response>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(aborted()), { once: true });
      if (!options.header) return;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          signal.addEventListener("abort", () => {
            try {
              c.error(aborted());
            } catch {
              // 이미 끝난 stream이다.
            }
          }, { once: true });
        },
      });
      resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    sent: sent.promise,
    push: (text: string) => controller?.enqueue(encoder.encode(text)),
    end: () => controller?.close(),
  };
}

const MESSAGE_START = loadFixture("anthropic/text-end_turn").body;
// message_start, content_block_start, 첫 delta까지다.
const FRONT = MESSAGE_START.split("\n\n").slice(0, 3).join("\n\n") + "\n\n";

Deno.test("header도 오기 전에 멎으면 기한이 차 temporary로 끊는다", async () => {
  const { timer, deadlines } = fakeTimer();
  const live = liveFetch({ header: false });
  const binding = await wireBinding(
    "anthropic-messages",
    live.fetch,
    undefined,
    { timer },
  );
  const call = callWire(binding);
  const signal = await live.sent;
  assertEquals(deadlines.map((d) => d.ms), [MODEL_IDLE_MS]);
  deadlines[0].fire();
  const output = await call;
  assertObjectMatch(output.outcome, {
    kind: "failed",
    code: "temporary",
    retry_at: null,
  });
  assertEquals(signal.aborted, true);
});

Deno.test("stream 중간에 멎으면 받은 글이 있어도 partial이 아니라 temporary다", async () => {
  const { timer, deadlines, armed } = fakeTimer();
  const live = liveFetch({ header: true });
  const binding = await wireBinding(
    "anthropic-messages",
    live.fetch,
    undefined,
    { timer },
  );
  const call = callWire(binding);
  await live.sent;
  live.push(FRONT);
  await armed(2);
  deadlines[1].fire();
  const output = await call;
  assertObjectMatch(output.outcome, {
    kind: "failed",
    code: "temporary",
    retry_at: null,
  });
  assertEquals(output.text, "Hello");
});

Deno.test("ping이 오는 동안은 기한을 새로 걸어 끊지 않는다", async () => {
  const { timer, deadlines, armed } = fakeTimer();
  const live = liveFetch({ header: true });
  const binding = await wireBinding(
    "anthropic-messages",
    live.fetch,
    undefined,
    { timer },
  );
  const call = callWire(binding);
  await live.sent;
  for (let n = 2; n <= 4; n++) {
    live.push(": ping\n\n");
    await armed(n);
  }
  // 접힌 옛 기한은 풀어도 영향이 없다.
  deadlines[0].fire();
  live.push(MESSAGE_START);
  await armed(5);
  live.end();
  const output = await call;
  assertEquals(output.outcome.kind, "complete");
  assertEquals(deadlines.length, 5);
  assertEquals(deadlines.every((d) => d.signal.aborted), true);
});

Deno.test("사람이 멈추면 기한 전이라도 cancelled다", async () => {
  const { timer, armed } = fakeTimer();
  const live = liveFetch({ header: true });
  const binding = await wireBinding(
    "anthropic-messages",
    live.fetch,
    undefined,
    { timer },
  );
  const human = new AbortController();
  const call = callWire({
    ...binding,
    invoke: (input) => binding.invoke(input, human.signal),
  });
  await live.sent;
  live.push(FRONT);
  await armed(2);
  human.abort();
  const output = await call;
  assertEquals(output.outcome.kind, "cancelled");
});

Deno.test("idle을 안 주면 기한은 MODEL_IDLE_MS이고 기본 timer는 호출이 끝나며 정리된다", async () => {
  const { timer, deadlines } = fakeTimer();
  const replayed = replayFetch(loadFixture("anthropic/text-end_turn"));
  const named = await wireBinding(
    "anthropic-messages",
    replayed.fetch,
    undefined,
    { timer },
  );
  assertEquals((await callWire(named)).outcome.kind, "complete");
  assertEquals(deadlines[0].ms, MODEL_IDLE_MS);
  // 기본 timer는 setTimeout을 쓴다. 안 지우면 Deno sanitizer가 이 test를 실패시킨다.
  const plain = await wireBinding(
    "anthropic-messages",
    replayFetch(loadFixture("anthropic/text-end_turn")).fetch,
  );
  assertEquals((await callWire(plain)).outcome.kind, "complete");
});
