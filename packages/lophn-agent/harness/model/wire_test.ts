import { assert, assertEquals } from "@std/assert";
import type { CatalogEntry } from "../../../contracts/lophn-agent/mod.ts";
import { translateOptions, type WireProtocol } from "./wire.ts";
import { catalogEntry } from "../../../contracts/lophn-agent/testing/mod.ts";

const sonnet = catalogEntry("anthropic", "claude-sonnet-4-5");
const opus = catalogEntry("anthropic", "claude-opus-4-8");
const gpt5 = catalogEntry("openai", "gpt-5-5");
const grokMini = catalogEntry("xai", "grok-3-mini");
const grok4 = catalogEntry("xai", "grok-4");

const MESSAGES: WireProtocol = "anthropic-messages";
const RESPONSES: WireProtocol = "openai-responses";
const CHAT: WireProtocol = "openai-chat-completions";

function plan(
  protocol: WireProtocol,
  entry: CatalogEntry,
  option_values: Record<string, string>,
) {
  const result = translateOptions({ protocol, entry, option_values });
  if (!result.ok) throw new Error(`expected ok: ${result.error.message}`);
  return result.value;
}

function patchOf(
  protocol: WireProtocol,
  entry: CatalogEntry,
  option_values: Record<string, string>,
) {
  return plan(protocol, entry, option_values).request_patch;
}

// catalog 자료만 바꾼 model이다. effort 값 목록이나 wire를 자료로 바꿔 본다.
function withEffortValues(entry: CatalogEntry, names: string[]): CatalogEntry {
  const labels: Record<string, string> = {
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    very_high: "XHigh",
    maximum: "Max",
  };
  return {
    ...entry,
    options: [{
      id: "effort",
      label: "Effort",
      values: names.map((value) => ({
        value,
        label: labels[value],
        wire: null,
      })),
      default_value: null,
      budget: null,
    }],
  };
}

Deno.test("lophn-agent/harness/model#R22 [agent-I4]: Speed on OpenAI adds a service tier piece to the request body", () => {
  assertEquals(plan(RESPONSES, gpt5, { speed: "fast" }), {
    sent_model_name: "gpt-5-5",
    request_patch: { service_tier: "priority" },
    request_headers: {},
  });
  assertEquals(plan(RESPONSES, gpt5, { speed: "standard" }), {
    sent_model_name: "gpt-5-5",
    request_patch: { service_tier: "default" },
    request_headers: {},
  });
});

Deno.test("lophn-agent/harness/model#R22 [agent-I4]: Speed on Grok swaps the model id and adds nothing to the body", () => {
  assertEquals(plan(CHAT, grok4, { speed: "fast" }), {
    sent_model_name: "grok-4-fast",
    request_patch: {},
    request_headers: {},
  });
  assertEquals(plan(CHAT, grok4, { speed: "standard" }), {
    sent_model_name: "grok-4",
    request_patch: {},
    request_headers: {},
  });
});

Deno.test("lophn-agent/harness/model#R22 [agent-I4]: a declared wire is applied the same under every call format", () => {
  for (const protocol of [MESSAGES, RESPONSES, CHAT]) {
    assertEquals(patchOf(protocol, gpt5, { speed: "fast" }), {
      service_tier: "priority",
    });
    assertEquals(
      plan(protocol, grok4, { speed: "fast" }).sent_model_name,
      "grok-4-fast",
    );
  }
});

Deno.test("lophn-agent/harness/model#R23 [agent-I4]: Anthropic Messages turns a budget effort into a clamped thinking budget", () => {
  assertEquals(patchOf(MESSAGES, sonnet, { effort: "low" }), {
    thinking: { type: "enabled", budget_tokens: 2048 },
  });
  assertEquals(patchOf(MESSAGES, sonnet, { effort: "medium" }), {
    thinking: { type: "enabled", budget_tokens: 8192 },
  });
  assertEquals(patchOf(MESSAGES, sonnet, { effort: "high" }), {
    thinking: { type: "enabled", budget_tokens: 16384 },
  });
  // 최대(32768)는 확인된 최대 24000 안으로 제한한다.
  assertEquals(patchOf(MESSAGES, sonnet, { effort: "maximum" }), {
    thinking: { type: "enabled", budget_tokens: 24000 },
  });
  assertEquals(patchOf(MESSAGES, sonnet, { effort: "off" }), {
    thinking: { type: "disabled" },
  });
  // 낮음(2048)은 확인된 최소 4096 아래로 내려가지 않는다.
  const highFloor = {
    ...sonnet,
    options: [{
      ...sonnet.options![0],
      budget: { minimum: 4096, maximum: 24000 },
    }],
  };
  assertEquals(patchOf(MESSAGES, highFloor, { effort: "low" }), {
    thinking: { type: "enabled", budget_tokens: 4096 },
  });
});

Deno.test("lophn-agent/harness/model#R23 [agent-I4]: Anthropic Messages sends an effort name when the axis has no budget", () => {
  const adaptive = (effort: string) => ({
    thinking: { type: "adaptive" },
    output_config: { effort },
  });
  assertEquals(patchOf(MESSAGES, opus, { effort: "low" }), adaptive("low"));
  assertEquals(
    patchOf(MESSAGES, opus, { effort: "medium" }),
    adaptive("medium"),
  );
  assertEquals(patchOf(MESSAGES, opus, { effort: "high" }), adaptive("high"));
  assertEquals(
    patchOf(MESSAGES, opus, { effort: "very_high" }),
    adaptive("xhigh"),
  );
  assertEquals(patchOf(MESSAGES, opus, { effort: "maximum" }), adaptive("max"));
  const withOff = withEffortValues(opus, ["off", "low", "high"]);
  assertEquals(patchOf(MESSAGES, withOff, { effort: "off" }), {
    thinking: { type: "disabled" },
  });
});

Deno.test("lophn-agent/harness/model#R23 [agent-I4]: OpenAI Responses sends reasoning effort", () => {
  const effort = (value: string) => ({ reasoning: { effort: value } });
  assertEquals(
    patchOf(RESPONSES, gpt5, { effort: "minimal" }),
    effort("minimal"),
  );
  assertEquals(patchOf(RESPONSES, gpt5, { effort: "low" }), effort("low"));
  assertEquals(
    patchOf(RESPONSES, gpt5, { effort: "medium" }),
    effort("medium"),
  );
  assertEquals(patchOf(RESPONSES, gpt5, { effort: "high" }), effort("high"));
  assertEquals(
    patchOf(RESPONSES, gpt5, { effort: "very_high" }),
    effort("xhigh"),
  );
  const withOff = withEffortValues(gpt5, ["off", "low"]);
  assertEquals(patchOf(RESPONSES, withOff, { effort: "off" }), effort("none"));
});

Deno.test("lophn-agent/harness/model#R23 [agent-I4]: OpenAI Chat Completions sends reasoning_effort", () => {
  assertEquals(patchOf(CHAT, grokMini, { effort: "low" }), {
    reasoning_effort: "low",
  });
  assertEquals(patchOf(CHAT, grokMini, { effort: "high" }), {
    reasoning_effort: "high",
  });
  assertEquals(patchOf(CHAT, gpt5, { effort: "very_high" }), {
    reasoning_effort: "xhigh",
  });
});

Deno.test("lophn-agent/harness/model#R22 [agent-I4]: effort and a body-patch Speed value merge into one request body", () => {
  assertEquals(plan(RESPONSES, gpt5, { effort: "high", speed: "fast" }), {
    sent_model_name: "gpt-5-5",
    request_patch: {
      reasoning: { effort: "high" },
      service_tier: "priority",
    },
    request_headers: {},
  });
  // 조각이 같은 키 아래에서 만나면 깊게 합치고 어느 쪽도 잃지 않는다.
  const speed = gpt5.options![1];
  const overlapping: CatalogEntry = {
    ...gpt5,
    options: [gpt5.options![0], {
      ...speed,
      values: speed.values.map((value) =>
        value.value === "fast"
          ? {
            ...value,
            wire: {
              kind: "body_patch" as const,
              patch: { reasoning: { summary: "auto" } },
            },
          }
          : value
      ),
    }],
  };
  assertEquals(
    patchOf(RESPONSES, overlapping, { effort: "high", speed: "fast" }),
    {
      reasoning: { effort: "high", summary: "auto" },
    },
  );
});

Deno.test("lophn-agent/harness/model#R22 [agent-I4]: Anthropic Speed Fast sends a body piece and a beta header together", () => {
  assertEquals(plan(MESSAGES, opus, { speed: "fast" }), {
    sent_model_name: "claude-opus-4-8",
    request_patch: { speed: "fast" },
    request_headers: { "anthropic-beta": "fast-mode-2026-02-01" },
  });
  // Standard는 더할 것이 없다.
  assertEquals(plan(MESSAGES, opus, { speed: "standard" }), {
    sent_model_name: "claude-opus-4-8",
    request_patch: {},
    request_headers: {},
  });
  // effort 표의 조각과 Speed의 조각·header가 한 요청에 모인다.
  assertEquals(plan(MESSAGES, opus, { effort: "high", speed: "fast" }), {
    sent_model_name: "claude-opus-4-8",
    request_patch: {
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      speed: "fast",
    },
    request_headers: { "anthropic-beta": "fast-mode-2026-02-01" },
  });
});

Deno.test("lophn-agent/harness/model#R22 [agent-I4]: the same header from two values joins its values, other headers stay apart", () => {
  const fast = opus.options![1];
  const beta = (value: string, extra: Record<string, string> = {}) => ({
    kind: "body_patch" as const,
    patch: {},
    headers: { "anthropic-beta": value, ...extra },
  });
  const twoAxes: CatalogEntry = {
    ...opus,
    options: [
      {
        ...fast,
        values: [{ value: "fast", label: "Fast", wire: beta("beta-a") }],
        default_value: null,
      },
      {
        id: "context",
        label: "Context",
        values: [{
          value: "long",
          label: "Long",
          wire: beta("beta-b", { "x-extra": "1" }),
        }],
        default_value: null,
        budget: null,
      },
    ],
  };
  // 같은 이름의 header는 축 순서대로 쉼표로 잇고, 이름이 다르면 따로 둔다.
  assertEquals(
    plan(MESSAGES, twoAxes, { speed: "fast", context: "long" })
      .request_headers,
    { "anthropic-beta": "beta-a,beta-b", "x-extra": "1" },
  );
  // 같은 값이 두 번 오면 한 번만 싣는다.
  const sameBeta: CatalogEntry = {
    ...twoAxes,
    options: [
      twoAxes.options![0],
      {
        ...twoAxes.options![1],
        values: [{ value: "long", label: "Long", wire: beta("beta-a") }],
      },
    ],
  };
  assertEquals(
    plan(MESSAGES, sameBeta, { speed: "fast", context: "long" })
      .request_headers,
    { "anthropic-beta": "beta-a" },
  );
});

Deno.test("lophn-agent/harness/model#R23 [agent-I4]: the same axis and value give the same patch whatever the model is called", () => {
  const renamed: CatalogEntry = {
    ...opus,
    provider_definition: "some-gateway",
    model_name: "a-model-that-did-not-exist-yesterday",
  };
  for (const protocol of [MESSAGES, RESPONSES, CHAT]) {
    const before = plan(protocol, opus, { effort: "high" });
    const after = plan(protocol, renamed, { effort: "high" });
    assertEquals(after.request_patch, before.request_patch);
    assertEquals(after.sent_model_name, "a-model-that-did-not-exist-yesterday");
  }
  // 새 model은 catalog 자료만 더해서 호출이 된다: Grok mini와 effort 값이 같은 새 이름.
  const added: CatalogEntry = { ...grokMini, model_name: "grok-9-mini" };
  assertEquals(plan(CHAT, added, { effort: "high" }), {
    sent_model_name: "grok-9-mini",
    request_patch: { reasoning_effort: "high" },
    request_headers: {},
  });
});

Deno.test("lophn-agent/harness/model#R23 [agent-I4]: wire.ts has no branch on a model name", async () => {
  const source = await Deno.readTextFile(new URL("./wire.ts", import.meta.url));
  assert(
    !/claude|opus|sonnet|haiku|gpt|grok|gemini|llama|qwen|deepseek/i
      .test(source),
    "wire.ts must not name a model or a model family",
  );
});

Deno.test("lophn-agent/harness/model#R16 [agent-I4]: with no option chosen nothing is added and the model name is unchanged", () => {
  for (
    const [protocol, entry] of [
      [MESSAGES, sonnet],
      [MESSAGES, opus],
      [RESPONSES, gpt5],
      [CHAT, grokMini],
      [CHAT, grok4],
    ] as const
  ) {
    assertEquals(plan(protocol, entry, {}), {
      sent_model_name: entry.model_name,
      request_patch: {},
      request_headers: {},
    });
  }
});

Deno.test("lophn-agent/harness/model#R24 [agent-I4]: an axis or value the model does not declare fails with invalid_input", () => {
  const cases: [WireProtocol, CatalogEntry, Record<string, string>][] = [
    [RESPONSES, gpt5, { effort: "maximum" }],
    [MESSAGES, opus, { effort: "off" }],
    [CHAT, grok4, { effort: "low" }],
    [RESPONSES, gpt5, { speed: "priority" }],
    [RESPONSES, gpt5, { temperature: "0" }],
    [RESPONSES, { ...gpt5, options: null }, { effort: "low" }],
    [RESPONSES, { ...gpt5, options: [] }, { speed: "fast" }],
  ];
  for (const [protocol, entry, option_values] of cases) {
    const result = translateOptions({ protocol, entry, option_values });
    assert(!result.ok, JSON.stringify(option_values));
    if (!result.ok) assertEquals(result.error.code, "invalid_input");
  }
});

Deno.test("lophn-agent/harness/model#R24 [agent-I4]: an effort value the call format cannot express fails instead of becoming a nearby one", () => {
  // Anthropic에는 Minimal이 없다. Low로 조용히 올리지 않는다.
  const minimal = withEffortValues(opus, ["minimal", "low", "high"]);
  const result = translateOptions({
    protocol: MESSAGES,
    entry: minimal,
    option_values: { effort: "minimal" },
  });
  assert(!result.ok);
  if (!result.ok) assertEquals(result.error.code, "invalid_input");
  assertEquals(patchOf(MESSAGES, minimal, { effort: "low" }), {
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
  });
});
