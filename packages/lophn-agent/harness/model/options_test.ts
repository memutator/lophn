import { assert, assertEquals } from "@std/assert";
import type { CatalogEntry } from "../../../contracts/lophn-agent/mod.ts";
import {
  fitOptionValues,
  optionAxesOf,
  resolveOptionValues,
  validateOptionValues,
} from "./options.ts";
import { catalogEntry } from "./testdata/catalog-options.ts";

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

function axisOf(entry: CatalogEntry, id: string) {
  const axis = entry.options?.find((candidate) => candidate.id === id);
  if (axis === undefined) throw new Error(`fixture has no ${id} axis`);
  return axis;
}

function onlyValues(entry: CatalogEntry, id: string, values: string[]) {
  const axis = axisOf(entry, id);
  return {
    ...axis,
    values: axis.values.filter((value) => values.includes(value.value)),
    default_value: null,
  };
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) throw new Error("expected ok");
  return result.value;
}

Deno.test("lophn-agent/harness/model#R21 [agent-I3]: the picker sees only the axes the chosen model has", () => {
  const ids = (entry: CatalogEntry) =>
    optionAxesOf(entry).map((axis) => axis.id);
  assertEquals(ids(sonnet), ["effort"]);
  assertEquals(ids(opus), ["effort", "speed"]);
  assertEquals(ids(gpt5), ["effort", "speed"]);
  assertEquals(ids(grokMini), ["effort"]);
  // effort가 없는 model에는 effort 줄이 없다.
  assertEquals(ids(grok4), ["speed"]);
  assertEquals(ids(gpt4), []);
  // option을 모르는 model(null)도 보일 축이 없다.
  assertEquals(ids(withOptions(gpt5, null)), []);
});

Deno.test("lophn-agent/harness/model#R21 [agent-I3]: changing only the catalog data adds and removes axes", () => {
  const speed = axisOf(gpt5, "speed");
  const added = withOptions(gpt4, [speed]);
  assertEquals(optionAxesOf(added).map((axis) => axis.id), ["speed"]);
  const removed = withOptions(gpt5, [axisOf(gpt5, "effort")]);
  assertEquals(optionAxesOf(removed).map((axis) => axis.id), ["effort"]);
});

Deno.test("lophn-agent/harness/model#R21 [agent-I3]: the picker view keeps the declared order, labels and default, and hides the wire", () => {
  const view = optionAxesOf(gpt5);
  assertEquals(view, [
    {
      id: "effort",
      label: "Effort",
      values: [
        { value: "minimal", label: "Minimal" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "very_high", label: "XHigh" },
      ],
      default_value: "medium",
    },
    {
      id: "speed",
      label: "Speed",
      values: [
        { value: "standard", label: "Standard" },
        { value: "fast", label: "Fast" },
      ],
      default_value: null,
    },
  ]);
  assert(!JSON.stringify(view).includes("service_tier"));
});

Deno.test("lophn-agent/harness/model#R15 [agent-I3]: only the supported effort values show, as Off to Max with XHigh and Max", () => {
  const labels = (entry: CatalogEntry) =>
    optionAxesOf(entry).find((axis) => axis.id === "effort")?.values.map((
      value,
    ) => value.label);
  assertEquals(labels(sonnet), ["Off", "Low", "Medium", "High", "Max"]);
  assertEquals(labels(opus), ["Low", "Medium", "High", "XHigh", "Max"]);
  assertEquals(labels(grokMini), ["Low", "High"]);
});

Deno.test("lophn-agent/harness/model#R21 [agent-I3]: Speed Fast shows under the same axis name whether it is a service tier or a model id", () => {
  const fastLabel = (entry: CatalogEntry) =>
    optionAxesOf(entry).find((axis) => axis.id === "speed")?.values.at(-1);
  assertEquals(fastLabel(gpt5), { value: "fast", label: "Fast" });
  assertEquals(fastLabel(grok4), { value: "fast", label: "Fast" });
  assertEquals(
    optionAxesOf(gpt5).find((axis) => axis.id === "speed")?.label,
    optionAxesOf(grok4).find((axis) => axis.id === "speed")?.label,
  );
});

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

Deno.test("lophn-agent/harness/model#R25 [agent-I3]: an unsupported effort moves to the nearest weaker supported value and says so", () => {
  // XHigh를 지원하지 않는 model로 바꾸면 High로 맞추고 알린다.
  assertEquals(fitOptionValues(sonnet, { effort: "very_high" }), {
    option_values: { effort: "high" },
    notices: [{ axis: "effort", from: "very_high", to: "high" }],
  });
  // 가장 가까운 약한 값: Max → XHigh, Medium → Low.
  assertEquals(fitOptionValues(gpt5, { effort: "maximum" }), {
    option_values: { effort: "very_high" },
    notices: [{ axis: "effort", from: "maximum", to: "very_high" }],
  });
  assertEquals(fitOptionValues(grokMini, { effort: "medium" }), {
    option_values: { effort: "low" },
    notices: [{ axis: "effort", from: "medium", to: "low" }],
  });
  // 비용을 올리는 쪽으로 가지 않는다: High가 없으면 더 가까운 XHigh가 아니라 Low로 간다.
  const lowAndXHigh = withOptions(gpt5, [
    onlyValues(gpt5, "effort", ["low", "very_high"]),
  ]);
  assertEquals(fitOptionValues(lowAndXHigh, { effort: "high" }), {
    option_values: { effort: "low" },
    notices: [{ axis: "effort", from: "high", to: "low" }],
  });
});

Deno.test("lophn-agent/harness/model#R25 [agent-I3]: with no weaker value it takes the weakest supported one, and Off is never a fitting target", () => {
  // 더 약한 지원 값이 없으면 가장 약한 지원 값이다.
  assertEquals(fitOptionValues(grokMini, { effort: "minimal" }), {
    option_values: { effort: "low" },
    notices: [{ axis: "effort", from: "minimal", to: "low" }],
  });
  // Off는 맞춤 대상이 아니다: 약한 쪽에 Off뿐이어도 Off로 가지 않고 가장 약한 Off 밖의 값으로 간다.
  const withOff = withOptions(gpt5, [
    {
      ...onlyValues(sonnet, "effort", ["off", "medium", "high"]),
      budget: null,
    },
  ]);
  assertEquals(fitOptionValues(withOff, { effort: "low" }), {
    option_values: { effort: "medium" },
    notices: [{ axis: "effort", from: "low", to: "medium" }],
  });
  assertEquals(fitOptionValues(withOff, { effort: "minimal" }).option_values, {
    effort: "medium",
  });
});

Deno.test("lophn-agent/harness/model#R25 [agent-I3]: a supported value, including Off, stays without a notice", () => {
  assertEquals(fitOptionValues(sonnet, { effort: "high" }), {
    option_values: { effort: "high" },
    notices: [],
  });
  assertEquals(fitOptionValues(sonnet, { effort: "off" }), {
    option_values: { effort: "off" },
    notices: [],
  });
  assertEquals(fitOptionValues(gpt5, { effort: "high", speed: "fast" }), {
    option_values: { effort: "high", speed: "fast" },
    notices: [],
  });
  assertEquals(fitOptionValues(gpt5, {}), { option_values: {}, notices: [] });
});

Deno.test("lophn-agent/harness/model#R25 [agent-I3]: an axis the new model lacks is dropped and a shared axis is kept", () => {
  assertEquals(fitOptionValues(grokMini, { effort: "high", speed: "fast" }), {
    option_values: { effort: "high" },
    notices: [],
  });
  assertEquals(fitOptionValues(opus, { effort: "high", speed: "fast" }), {
    option_values: { effort: "high", speed: "fast" },
    notices: [],
  });
  assertEquals(fitOptionValues(grok4, { effort: "high", speed: "fast" }), {
    option_values: { speed: "fast" },
    notices: [],
  });
  assertEquals(fitOptionValues(gpt4, { effort: "high", speed: "fast" }), {
    option_values: {},
    notices: [],
  });
  assertEquals(
    fitOptionValues(withOptions(gpt5, null), { effort: "high" }),
    { option_values: {}, notices: [] },
  );
});

Deno.test("lophn-agent/harness/model#R25 [agent-I3]: a speed value the new model lacks falls to its weakest, with one notice per fitted axis in the given order", () => {
  const standardOnly = withOptions(grok4, [
    onlyValues(grok4, "speed", ["standard"]),
  ]);
  assertEquals(fitOptionValues(standardOnly, { speed: "fast" }), {
    option_values: { speed: "standard" },
    notices: [{ axis: "speed", from: "fast", to: "standard" }],
  });
  const both = withOptions(gpt5, [
    onlyValues(gpt5, "effort", ["low", "high"]),
    onlyValues(gpt5, "speed", ["standard"]),
  ]);
  assertEquals(fitOptionValues(both, { speed: "fast", effort: "maximum" }), {
    option_values: { speed: "standard", effort: "high" },
    notices: [
      { axis: "speed", from: "fast", to: "standard" },
      { axis: "effort", from: "maximum", to: "high" },
    ],
  });
});

Deno.test("lophn-agent/harness/model#R25 [agent-I3]: fitting does not change the stored values it was given", () => {
  const stored = Object.freeze({ effort: "very_high", speed: "fast" });
  const fitted = fitOptionValues(grokMini, stored);
  assertEquals(stored, { effort: "very_high", speed: "fast" });
  assertEquals(fitted.option_values, { effort: "high" });
});
