// provider-state의 read와 판정(shell/desktop#R7). core 통로는 launcher 테스트의 가짜를 쓴다.
import { assert, assertEquals } from "@std/assert";

import type { CoreSource } from "./connection.ts";
import { readProviderFacts } from "./provider-state.ts";

function sourceOf(
  reply:
    | { ok: true; value: unknown }
    | { ok: false; error: { code: string; message: string } },
  failCall = false,
): { source: CoreSource; calls: unknown[] } {
  const calls: unknown[] = [];
  const call = (input: Parameters<CoreSource["call"]>[0]) => {
    calls.push(input);
    if (failCall) return Promise.reject(new Error("bridge is gone"));
    return Promise.resolve(reply);
  };
  return {
    calls,
    source: {
      subscribe: () => () => {},
      call,
    },
  };
}

Deno.test("shell/desktop#R7: provider 끊김은 available 계정이 없는 연결로 판정한다", async () => {
  const { source, calls } = sourceOf({
    ok: true,
    value: {
      providers: [
        {
          name: "Claude",
          enabled: true,
          credentials: [{ key: "main", state: "rejected" }],
        },
        {
          name: "Local model",
          enabled: true,
          credentials: [{ key: "none", state: "available" }],
        },
      ],
      next_cursor: null,
    },
  });
  const facts = await readProviderFacts(source);
  assertEquals(calls, [{
    kind: "read",
    resource: "providers",
    method: "list",
    body: {},
  }]);
  assert(facts.usable, "an available account makes the provider usable");
  assertEquals(facts.providers?.length, 2);
});

Deno.test("shell/desktop#R7: 계정이 전부 rejected·usage_wait이면 provider는 쓸 수 없다", async () => {
  const { source } = sourceOf({
    ok: true,
    value: {
      providers: [
        {
          name: "ChatGPT",
          enabled: true,
          credentials: [
            { key: "a", state: "rejected" },
            { key: "b", state: "usage_wait" },
          ],
        },
      ],
      next_cursor: null,
    },
  });
  const facts = await readProviderFacts(source);
  assertEquals(facts.usable, false);
  assertEquals(facts.providers?.[0]?.accounts.length, 2);
});

Deno.test("shell/desktop#R7: 등록한 연결이 없으면 provider는 쓸 수 없다고 본다", async () => {
  const { source } = sourceOf({
    ok: true,
    value: { providers: [], next_cursor: null },
  });
  const facts = await readProviderFacts(source);
  assertEquals(facts.usable, false);
  assertEquals(facts.providers, []);
});

Deno.test("shell/desktop#R7: read가 거절되거나 통로가 끊기면 아직 모른다는 사실만 둔다", async () => {
  const refused = sourceOf({
    ok: false,
    error: { code: "unavailable", message: "core is gone" },
  });
  const refusedFacts = await readProviderFacts(refused.source);
  assertEquals(refusedFacts.providers, null);
  assertEquals(refusedFacts.usable, false);

  const thrown = sourceOf(
    { ok: true, value: { providers: [], next_cursor: null } },
    true,
  );
  const thrownFacts = await readProviderFacts(thrown.source);
  assertEquals(thrownFacts.providers, null);
});
