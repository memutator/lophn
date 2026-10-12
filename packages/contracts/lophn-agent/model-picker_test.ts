import { assertEquals } from "@std/assert";
import {
  orderPicker,
  type PickerModel,
  toggleFavorite,
} from "./model-picker.ts";

const ANTHROPIC = "pvd_01arz3ndektsv4rrffq69g5fa1";
const OPENAI = "pvd_01arz3ndektsv4rrffq69g5fa2";
const XAI = "pvd_01arz3ndektsv4rrffq69g5fa3";
const GATEWAY = "pvd_01arz3ndektsv4rrffq69g5fa4";

const sonnet: PickerModel = {
  provider: ANTHROPIC,
  model_name: "claude-sonnet-4-5",
};
const opus: PickerModel = {
  provider: ANTHROPIC,
  model_name: "claude-opus-4-8",
};
const gpt5: PickerModel = { provider: OPENAI, model_name: "gpt-5-5" };
const gpt4: PickerModel = { provider: OPENAI, model_name: "gpt-4-1" };
const grokMini: PickerModel = { provider: XAI, model_name: "grok-3-mini" };
const grok4: PickerModel = { provider: XAI, model_name: "grok-4" };

// provider 순서와 그 안의 model 순서는 호출한 쪽이 정해서 준다.
const models = [sonnet, opus, gpt5, gpt4, grokMini, grok4];

const groups = (...entries: [string, PickerModel[]][]) =>
  entries.map(([provider, list]) => ({ provider, models: list }));

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: with no favorites the picker is the provider groups in the given order", () => {
  const layout = orderPicker({ favorites: [], models, query: "" });
  assertEquals(layout.favorites, []);
  assertEquals(
    layout.providers,
    groups(
      [ANTHROPIC, [sonnet, opus]],
      [OPENAI, [gpt5, gpt4]],
      [XAI, [grokMini, grok4]],
    ),
  );
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: there is no recent-use group", () => {
  const layout = orderPicker({ favorites: [grok4], models, query: "" });
  assertEquals(Object.keys(layout), ["favorites", "providers"]);
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: Favorites keep the starred order and are not regrouped by provider", () => {
  const favorites = [grok4, opus, grokMini, gpt5];
  const layout = orderPicker({ favorites, models, query: "" });
  assertEquals(layout.favorites, [grok4, opus, grokMini, gpt5]);
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: a favorite also stays in its provider group", () => {
  const layout = orderPicker({ favorites: [gpt4], models, query: "" });
  assertEquals(layout.favorites, [gpt4]);
  assertEquals(layout.providers[1], { provider: OPENAI, models: [gpt5, gpt4] });
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: a search keeps matching favorites first, in starred order", () => {
  // 별표는 opus가 sonnet보다 먼저이고 catalog 순서는 반대다.
  const layout = orderPicker({
    favorites: [opus, gpt5, sonnet],
    models,
    query: "claude",
  });
  assertEquals(layout.favorites, [opus, sonnet]);
  assertEquals(layout.providers, groups([ANTHROPIC, [sonnet, opus]]));
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: a search puts a matching favorite ahead of every other match", () => {
  // "4"는 sonnet-4-5, opus-4-8, gpt-4-1, grok-4에 맞고 gpt-5-5, grok-3-mini에는 안 맞는다.
  const layout = orderPicker({ favorites: [grok4, gpt5], models, query: "4" });
  assertEquals(layout.favorites, [grok4]);
  assertEquals(
    layout.providers,
    groups([ANTHROPIC, [sonnet, opus]], [OPENAI, [gpt4]], [XAI, [grok4]]),
  );
  const rows = [
    ...layout.favorites,
    ...layout.providers.flatMap((g) => g.models),
  ];
  assertEquals(rows[0], grok4);
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: the search ignores case and surrounding spaces, and an unmatched search is empty", () => {
  assertEquals(
    orderPicker({ favorites: [], models, query: "  GPT " }).providers,
    groups([OPENAI, [gpt5, gpt4]]),
  );
  assertEquals(
    orderPicker({ favorites: [], models, query: "   " }).providers.length,
    3,
  );
  assertEquals(
    orderPicker({ favorites: [grok4], models, query: "nothing-like-this" }),
    {
      favorites: [],
      providers: [],
    },
  );
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: a favorite missing from the catalog is hidden and keeps its place for when it returns", () => {
  const gone: PickerModel = { provider: OPENAI, model_name: "gpt-retired" };
  const unconnected: PickerModel = { provider: GATEWAY, model_name: "gpt-5-5" };
  const favorites = Object.freeze([gone, grok4, unconnected, opus]);
  const layout = orderPicker({ favorites, models, query: "" });
  assertEquals(layout.favorites, [grok4, opus]);
  // 입력 목록은 그대로이므로 다시 나타나면 원래 순서로 돌아온다.
  assertEquals(favorites.length, 4);
  const back = orderPicker({ favorites, models: [...models, gone], query: "" });
  assertEquals(back.favorites, [gone, grok4, opus]);
});

Deno.test("lophn-agent/harness/model#R1 [agent-I5]: a favorite is a provider and model name pair, not a bare name", () => {
  const direct = gpt5;
  const viaGateway: PickerModel = { provider: GATEWAY, model_name: "gpt-5-5" };
  const layout = orderPicker({
    favorites: [viaGateway],
    models: [direct, viaGateway],
    query: "",
  });
  assertEquals(layout.favorites, [viaGateway]);
});

Deno.test("lophn-agent/harness/model#R26 [agent-I5]: starring appends at the end and unstarring leaves the others in order", () => {
  const stored = Object.freeze([grok4, opus]);
  const starred = toggleFavorite(stored, gpt5);
  assertEquals(starred, [grok4, opus, gpt5]);
  assertEquals(toggleFavorite(starred, opus), [grok4, gpt5]);
  assertEquals(toggleFavorite(toggleFavorite(stored, sonnet), sonnet), [
    grok4,
    opus,
  ]);
  assertEquals(stored, [grok4, opus]);
});
