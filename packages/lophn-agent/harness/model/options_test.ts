import { assert, assertEquals } from "@std/assert";
import type { CatalogEntry } from "../../../protocol/lophn-agent/mod.ts";
import { catalogEntry } from "../../../protocol/lophn-agent/testing/mod.ts";
import { resolveOptionValues, validateOptionValues } from "./options.ts";

const sonnet = catalogEntry("anthropic", "claude-sonnet-4-5");
const opus = catalogEntry("anthropic", "claude-opus-4-8");
const gpt5 = catalogEntry("openai", "gpt-5-5");
const gpt4 = catalogEntry("openai", "gpt-4-1");
const grokMini = catalogEntry("xai", "grok-3-mini");
const grok4 = catalogEntry("xai", "grok-4");

// catalog 자료만 바꾼 model이다. 코드는 그대로이고 자료가 축과 값을 정한다(R21).
function withOptions(
  base: CatalogEntry,
  options: CatalogEntry["options"],
): CatalogEntry {
  return { ...base, options };
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) throw new Error("expected ok");
  return result.value;
}

Deno.test("lophn-agent/harness/model#R16 [agent-I3]: leaving an axis to the model sends its confirmed default, or nothing", () => {
  // default가 확인된 축은 그 값이 요청에 간다.
  assertEquals(unwrap(resolveOptionValues(opus, {})), { effort: "high" });
  assertEquals(unwrap(resolveOptionValues(gpt5, {})), { effort: "medium" });
  // default가 없는 축은 비워 둔다. 기본값 이름이나 빈 값으로 채우지 않는다.
  assertEquals(unwrap(resolveOptionValues(sonnet, {})), {});
  assertEquals(unwrap(resolveOptionValues(grok4, {})), {});
  assertEquals(unwrap(resolveOptionValues(gpt4, {})), {});
  assertEquals(unwrap(resolveOptionValues(withOptions(gpt5, null), {})), {});
  // 고른 축은 고른 값이고, 안 고른 축만 default를 받는다.
  assertEquals(unwrap(resolveOptionValues(gpt5, { speed: "fast" })), {
    effort: "medium",
    speed: "fast",
  });
  assertEquals(unwrap(resolveOptionValues(gpt5, { effort: "minimal" })), {
    effort: "minimal",
  });
});

Deno.test("lophn-agent/harness/model#R24 [agent-I3]: a value the model does not have fails with invalid_input and is never replaced", () => {
  const rejected: [CatalogEntry, Record<string, string>][] = [
    [gpt5, { effort: "maximum" }], // 없는 값
    [opus, { effort: "off" }],
    [grokMini, { effort: "medium" }],
    [gpt5, { speed: "priority" }], // service tier 이름이지 선언된 Speed 값이 아니다
    [gpt4, { effort: "low" }], // 없는 축
    [grok4, { effort: "low" }],
    [gpt5, { temperature: "0" }],
    [withOptions(gpt5, null), { effort: "low" }], // option을 모르는 model
    [gpt5, { effort: "" }], // 빈 값은 값이 아니다
    [gpt5, { effort: "provider_default" }], // 기본값 이름은 값이 아니다
  ];
  for (const [entry, values] of rejected) {
    for (const check of [validateOptionValues, resolveOptionValues]) {
      const result = check(entry, values);
      assert(!result.ok, JSON.stringify(values));
      if (!result.ok) {
        assertEquals(result.error.code, "invalid_input");
        assert(result.error.message.length > 0);
      }
    }
  }
});

Deno.test("lophn-agent/harness/model#R24 [agent-I3]: declared values pass validation unchanged, and none is a valid choice", () => {
  assertEquals(unwrap(validateOptionValues(gpt5, {})), {});
  assertEquals(
    unwrap(validateOptionValues(gpt5, { effort: "very_high", speed: "fast" })),
    { effort: "very_high", speed: "fast" },
  );
  assertEquals(unwrap(validateOptionValues(sonnet, { effort: "off" })), {
    effort: "off",
  });
  assertEquals(unwrap(validateOptionValues(withOptions(gpt5, null), {})), {});
});
