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

Deno.test("shell/desktop#R7: provider 끊김은 credential이 available이 아닌 연결로 판정한다", async () => {
  const { source, calls } = sourceOf({
    ok: true,
    value: {
      providers: [
        {
          name: "Claude",
          credential: { state: "rejected" },
        },
        {
          name: "Local model",
          credential: { state: "available" },
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
  assert(facts.usable, "an available credential makes the provider usable");
  assertEquals(facts.providers, [
    { name: "Claude", state: "rejected" },
    { name: "Local model", state: "available" },
  ]);
  assertEquals(facts.providers?.length, 2);
});

Deno.test("shell/desktop#R7: credential이 rejected·usage_wait·revoked뿐이면 provider는 쓸 수 없다", async () => {
  const { source } = sourceOf({
    ok: true,
    value: {
      providers: [
        { name: "ChatGPT", credential: { state: "rejected" } },
        { name: "xAI", credential: { state: "usage_wait" } },
        { name: "Groq", credential: { state: "revoked" } },
      ],
      next_cursor: null,
    },
  });
  const facts = await readProviderFacts(source);
  assertEquals(facts.usable, false);
  assertEquals(facts.providers?.map((provider) => provider.state), [
    "rejected",
    "usage_wait",
    "revoked",
  ]);
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
