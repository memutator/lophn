// lophn-agent/harness/run-loop: runtime의 안전화는 core가 한다. 감독 pipe의 안전화 요청이 끝나지 않으면
// 그 글은 null이고 어떤 경로로도 안전화하지 않은 글이 나가지 않는다(fail-closed).
import { assert, assertEquals } from "@std/assert";
import type {
  ChildMessage,
  RedactResponse,
} from "../../packages/contracts/platform/mod.ts";
import { createRedactLink, REDACT_OVERLAP } from "./redact-link.ts";
import { redactValue, storeValue } from "./run-blobs.ts";

const KNOWN = "violet-harbor-lantern-4821";

// core 쪽을 흉내 낸다: 요청 조각 안에서 알려진 값의 자리를 돌려준다.
function core(options: { ok?: boolean } = {}) {
  const requests: ChildMessage[] = [];
  const link: ReturnType<typeof createRedactLink> = createRedactLink({
    timeoutMs: 200,
    async send(message) {
      requests.push(message);
      if (message.type !== "redact_request") return;
      const response: RedactResponse = options.ok === false
        ? { type: "redact_response", request_id: message.request_id, ok: false }
        : {
          type: "redact_response",
          request_id: message.request_id,
          ok: true,
          spans: message.windows.map((window) => {
            const spans: { index: number; length: number }[] = [];
            for (
              let at = window.indexOf(KNOWN);
              at >= 0;
              at = window.indexOf(KNOWN, at + KNOWN.length)
            ) spans.push({ index: at, length: KNOWN.length });
            return spans;
          }),
        };
      await Promise.resolve();
      link.onParent(response);
    },
  });
  return { link, requests };
}

Deno.test("lophn-agent/harness/run-loop#R8: core가 돌려준 자리만 지우고 같은 tick의 글은 한 요청으로 묶는다", async () => {
  const { link, requests } = core();
  const [first, second] = await Promise.all([
    link.redact(`a ${KNOWN} b ${KNOWN}`),
    link.redact("nothing here"),
  ]);
  assertEquals(first, "a * b *");
  assertEquals(second, "nothing here");
  assertEquals(requests.length, 1);
});

Deno.test("lophn-agent/harness/run-loop#R8: 조각 경계에 걸친 값도 겹친 조각에서 지운다", async () => {
  const { link } = core();
  const filler = "x".repeat(32_768 - REDACT_OVERLAP - 10);
  const text = `${filler}${KNOWN}${"y".repeat(70_000)}`;
  const safe = await link.redact(text);
  assert(safe !== null);
  assert(!safe.includes(KNOWN));
  assert(!safe.includes("violet"));
  assertEquals(safe.length, text.length - KNOWN.length + 1);
});

Deno.test("lophn-agent/harness/run-loop#R8: core가 안전화를 끝내지 못했다고 답하면 글은 null이고 저장도 전송도 없다", async () => {
  const { link } = core({ ok: false });
  assertEquals(await link.redact("anything"), null);
  const redacted = await redactValue(link.redact, { a: ["x", { b: KNOWN }] });
  assert(!redacted.ok);
  let prepared = 0;
  const stored = await storeValue(
    {
      prepare() {
        prepared += 1;
        return Promise.resolve({
          ok: true as const,
          value: { hash: "0".repeat(64), size_bytes: 0 },
        });
      },
    },
    link.redact,
    "model_call_input",
    { text: KNOWN },
  );
  assert(!stored.ok);
  assertEquals(prepared, 0);
});

Deno.test("lophn-agent/harness/run-loop#R8: 답이 오지 않거나 pipe가 닫혀 있으면 글은 null이다", async () => {
  const silent = createRedactLink({
    timeoutMs: 50,
    send: () => Promise.resolve(),
  });
  assertEquals(await silent.redact(KNOWN), null);
  const closed = createRedactLink({
    send: () => Promise.reject(new Error("closed")),
  });
  assertEquals(await closed.redact(KNOWN), null);
});
