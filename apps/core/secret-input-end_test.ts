// 보호 입력 중계: I/O worker가 끝났을 때 응답을 기다리던 준비의 처리. 실제 worker 없이 보낸
// 요청과 응답을 시험이 직접 흉내 낸다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../packages/base/mod.ts";
import { createSecretInputRelay } from "./secret-input.ts";

const bytes = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("value"));
      controller.close();
    },
  });

Deno.test("platform/responsiveness#R3: I/O worker가 끝나면 응답을 기다리던 보호 입력 준비는 기한(30초)까지 두지 않고 unavailable이다", async () => {
  const requests: unknown[] = [];
  const relay = createSecretInputRelay({
    send: (payload) => {
      requests.push(payload);
      return Promise.resolve();
    },
    sendBytes: () => Promise.resolve(),
    sendAbort: () => Promise.resolve(),
    record: () => Promise.resolve(ok(undefined)),
    responseMs: 60_000,
  });
  const begun = performance.now();
  const preparing = relay.prepare(
    { purpose: "provider_credential", owner: "owner" },
    bytes(),
  );
  while (requests.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  relay.failPending("I/O worker ended");
  const result = await preparing;
  assert(performance.now() - begun < 5_000);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
});
