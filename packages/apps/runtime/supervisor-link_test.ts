// core 쪽 supervisor 제어 통로: 요청·응답 맞춤, 기한, 끊김, 관측 값 변환.
import { assert, assertEquals } from "@std/assert";
import type { ObservationWire } from "./control-protocol.ts";
import {
  createSupervisorChannel,
  createSupervisorClient,
  processSourceOf,
  runtimeObservationOf,
} from "./supervisor-link.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);

function wire(over: Partial<ObservationWire> = {}): ObservationWire {
  return {
    app: APP,
    release: REL,
    mode: "live",
    bundle_hash: HASH,
    process_nonce: "nonce-1",
    endpoint: "/run/lophn/a0.sock",
    commands: ["usage.read"],
    screens: { usage: ["full"] },
    ready: true,
    accepting: true,
    ...over,
  };
}

Deno.test("apps/runtime#R9: 통로는 supervisor가 묶이기 전에는 unavailable이고 요청 id로 답을 맞춘다", async () => {
  const channel = createSupervisorChannel();
  const before = await channel.request("apps.observe", { app: APP });
  assert(!before.ok);
  assertEquals(before.error.code, "unavailable");
  const sent: { request_id: string; op: string; payload: unknown }[] = [];
  channel.bind((payload) => {
    sent.push(payload as never);
    return Promise.resolve(true);
  });
  const first = channel.request("apps.observe", { app: "a" });
  const second = channel.request("apps.logs", { app: "b" });
  assertEquals(sent.map((request) => request.op), [
    "apps.observe",
    "apps.logs",
  ]);
  // 답은 순서와 상관없이 요청 id로 맞춘다.
  assert(
    channel.onMessage({
      type: "worker_response",
      request_id: sent[1].request_id,
      ok: true,
      payload: { which: "second" },
    } as never),
  );
  assert(
    channel.onMessage({
      type: "worker_response",
      request_id: sent[0].request_id,
      ok: false,
      error: { code: "forbidden", message: "no" },
    } as never),
  );
  const answeredSecond = await second;
  assert(answeredSecond.ok);
  assertEquals(answeredSecond.value, { which: "second" });
  const answeredFirst = await first;
  assert(!answeredFirst.ok);
  assertEquals(answeredFirst.error.code, "forbidden");
  // 모르는 id와 다른 종류의 message는 소비하지 않는다.
  assert(
    !channel.onMessage({
      type: "worker_response",
      request_id: "unknown",
      ok: true,
      payload: 1,
    } as never),
  );
  assert(!channel.onMessage({ type: "diagnostic" }));
});

Deno.test("apps/runtime#R17: 답이 없으면 기한 뒤 unavailable이고 통로가 끊기면 기다리던 요청이 끝난다", async () => {
  const channel = createSupervisorChannel();
  channel.bind(() => Promise.resolve(true));
  const slow = await channel.request("apps.observe", {}, 20);
  assert(!slow.ok);
  assertEquals(slow.error.code, "unavailable");
  const waiting = channel.request("apps.observe", {}, 10_000);
  channel.unbind();
  const ended = await waiting;
  assert(!ended.ok);
  assertEquals(ended.error.code, "unavailable");
  assert(!channel.bound);
  // 보내지 못하면(pipe가 닫힘) 기다리지 않고 unavailable이다.
  const closed = createSupervisorChannel();
  closed.bind(() => Promise.resolve(false));
  const refused = await closed.request("apps.observe", {}, 10_000);
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
});

Deno.test("apps/runtime#R9: client는 답의 모양을 검사하고 모양이 틀린 답은 unavailable이다", async () => {
  const channel = createSupervisorChannel();
  const seen: string[] = [];
  channel.bind((payload) => {
    const request = payload as { request_id: string; op: string };
    seen.push(request.op);
    queueMicrotask(() =>
      channel.onMessage({
        type: "worker_response",
        request_id: request.request_id,
        ok: true,
        payload: request.op === "apps.observe"
          ? { observation: wire() }
          : { garbage: true },
      } as never)
    );
    return Promise.resolve(true);
  });
  const client = createSupervisorClient(channel);
  const observed = await client.observe(APP);
  assert(observed.ok);
  assertEquals(observed.value?.process_nonce, "nonce-1");
  const logs = await client.logs(APP, { limit: 5 });
  assert(!logs.ok);
  assertEquals(logs.error.code, "unavailable");
  assertEquals(seen, ["apps.observe", "apps.logs"]);
});

Deno.test("apps/runtime#R9: 프로세스 출처는 자식이 없거나 다른 mode·nonce인 질의를 값 없음으로 답한다", async () => {
  const channel = createSupervisorChannel();
  let current: ObservationWire | null = wire();
  channel.bind((payload) => {
    const request = payload as { request_id: string };
    queueMicrotask(() =>
      channel.onMessage({
        type: "worker_response",
        request_id: request.request_id,
        ok: true,
        payload: { observation: current },
      } as never)
    );
    return Promise.resolve(true);
  });
  const source = processSourceOf(createSupervisorClient(channel));
  const live = await source.current({ app: APP, mode: "live" });
  assert(live.ok && live.value !== undefined);
  assertEquals(live.value.processNonce, "nonce-1");
  assertEquals(live.value.bundleHash, HASH);
  assertEquals(live.value.endpoint, "/run/lophn/a0.sock");
  // supervisor는 live만 띄운다. preview 질의는 다른 mode라 값 없음이다.
  const preview = await source.current({
    app: APP,
    mode: "preview",
    nonce: "nonce-1",
  });
  assert(preview.ok);
  assertEquals(preview.value, undefined);
  // 자식이 없는 관측(멈춤·crash loop)은 연결할 프로세스가 아니다.
  current = wire({ process_nonce: "", endpoint: "", ready: false });
  const none = await source.current({ app: APP, mode: "live" });
  assert(none.ok);
  assertEquals(none.value, undefined);
  current = null;
  const absent = await source.current({ app: APP, mode: "live" });
  assert(absent.ok);
  assertEquals(absent.value, undefined);
});

Deno.test("apps/runtime#R13: 관측을 RuntimeObservation으로 바꿀 때 연결 주소를 내보내지 않고 없는 근거를 만들지 않는다", () => {
  const running = runtimeObservationOf(wire());
  assertEquals(running, {
    app: APP,
    release: REL,
    mode: "live",
    process_nonce: "nonce-1",
    endpoint: null,
    ready: true,
    accepting: true,
  });
  // 준비 전에는 reason이 필수라 고정 근거를 붙인다.
  const starting = runtimeObservationOf(
    wire({ ready: false, accepting: false }),
  );
  assertEquals(starting?.reason?.code, "starting");
  // supervisor가 준 근거(종료 중, crash loop)를 그대로 쓴다.
  const terminating = runtimeObservationOf(
    wire({
      ready: false,
      accepting: false,
      reason: { code: "terminating", summary: "stop requested" },
    }),
  );
  assertEquals(terminating?.reason?.code, "terminating");
  // release가 없으면(live의 필수 값) 관측이 아니다. 자식도 근거도 없으면 관측이 아니다.
  assertEquals(runtimeObservationOf(wire({ release: null })), null);
  assertEquals(
    runtimeObservationOf(
      wire({ process_nonce: "", endpoint: "", ready: false }),
    ),
    null,
  );
  // crash loop처럼 자식은 없지만 멈춘 근거가 있으면 관측으로 남는다.
  const held = runtimeObservationOf(
    wire({
      process_nonce: "",
      endpoint: "",
      ready: false,
      accepting: false,
      reason: { code: "crash_loop", summary: "stopped restarting" },
    }),
  );
  assertEquals(held?.reason?.code, "crash_loop");
  assertEquals(held?.process_nonce, "none");
});

Deno.test("platform/responsiveness#R3: supervisor child가 끝나면 기다리던 요청은 기한(재시작 30초)까지 두지 않고 끝나되 통로는 묶인 채다", async () => {
  const channel = createSupervisorChannel();
  channel.bind(() => Promise.resolve(true));
  const client = createSupervisorClient(channel);
  const begun = performance.now();
  const restarting = client.restart(APP, "nonce-1");
  const observing = client.observe(APP);
  channel.failPending("supervisor ended");
  for (const answer of [await restarting, await observing]) {
    assert(!answer.ok);
    assertEquals(answer.error.code, "unavailable");
  }
  assert(performance.now() - begun < 2_000);
  // 감독이 새 child를 띄우면 같은 통로로 계속 쓴다.
  assert(channel.bound);
});
