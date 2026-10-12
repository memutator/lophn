import { assert, assertEquals } from "@std/assert";
import { routePath } from "../server/mod.ts";
import {
  CATALOG_REFRESH_INTERVAL_MS,
  catalogEntrySchema,
  catalogStateSchema,
  changeModelDefaults,
  changeModelDefaultsInputSchema,
  changeModelFavorites,
  EFFORT_BUDGET_TOKENS,
  INSTRUCTION_CALL_MAX_BYTES,
  INSTRUCTION_FILE_MAX_BYTES,
  MODEL_DEFAULT_SLOTS,
  MODEL_EVENTS,
  MODEL_ROUTES,
  modelDefaultsSchema,
  modelFavoritesSchema,
  optionAxisSchema,
  optionWireSchema,
  runBasisModelSchema,
} from "./models.ts";
import { EFFORT_LABELS, resolvedModelSchema } from "./resolved-model.ts";
import { EFFORT_VALUES } from "./option-axes.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const provider = `pvd_${suffix}`;
const at = "2026-10-05T00:00:00.000Z";
const hash = "ab".repeat(32);

const effortAxis = {
  id: "effort",
  label: "Effort",
  values: [
    { value: "low", label: "Low", wire: null },
    { value: "high", label: "High", wire: null },
  ],
  default_value: "low",
  budget: null,
};
const swap = { kind: "model_id", model_name: "grok-4-fast" };
const speedAxis = {
  id: "speed",
  label: "Speed",
  values: [
    {
      value: "standard",
      label: "Standard",
      wire: { ...swap, model_name: "grok-4" },
    },
    { value: "fast", label: "Fast", wire: swap },
  ],
  default_value: null,
  budget: null,
};

const entry = {
  provider_definition: "openai",
  model_name: "gpt",
  context_limit: 128000,
  input_limit: 120000,
  output_limit: 8000,
  supports_tools: true,
  input_media: ["text" as const],
  output_media: ["text" as const],
  options: [effortAxis],
  preview: false,
  deprecated: null,
  source: "models_dev" as const,
  source_revision: "2026-10",
  checked_at: at,
  received_at: at,
  price_basis: null,
};

function effortValues(
  names: string[],
  labels: Record<string, string> = EFFORT_LABELS,
) {
  return names.map((value) => ({
    value,
    label: labels[value] ?? value,
    wire: null,
  }));
}

Deno.test("lophn-agent/harness/model#R8: model routes and events", () => {
  assertEquals(MODEL_ROUTES.map(routePath), [
    "/v1/agent-model-defaults/change",
    "/v1/agent-model-defaults/read",
    "/v1/model-favorites/change",
    "/v1/model-favorites/read",
    "/v1/agent-model-catalog/read",
    "/v1/agent-model-catalog/refresh",
  ]);
  assertEquals(MODEL_EVENTS.map((event) => event.type), [
    "ModelDefaultsChanged",
    "ModelFavoritesChanged",
  ]);
  assertEquals(changeModelDefaults.actors, ["user"]);
  assertEquals(changeModelFavorites.actors, ["user"]);
});

Deno.test("lophn-agent/harness/model#R1: a catalog entry is a provider definition and model name", () => {
  assert(catalogEntrySchema.safeParse(entry).success);
  assert(!catalogEntrySchema.safeParse({ ...entry, extra: true }).success);
  assert(
    !catalogEntrySchema.safeParse({ ...entry, context_limit: 0 }).success,
  );
  // 옛 reasoning 칸은 없다.
  assert(!catalogEntrySchema.safeParse({ ...entry, reasoning: {} }).success);
});

Deno.test("lophn-agent/harness/model#R21: a catalog entry tells unknown options from none", () => {
  // null은 option을 아직 모른다는 뜻, []는 없다고 확인된 것이다.
  assert(catalogEntrySchema.safeParse({ ...entry, options: null }).success);
  assert(catalogEntrySchema.safeParse({ ...entry, options: [] }).success);
  assert(
    !catalogEntrySchema.safeParse({
      ...entry,
      options: [effortAxis, effortAxis],
    }).success,
  );
});

Deno.test("lophn-agent/harness/model#R5: catalog state keeps the last good snapshot hash", () => {
  assert(
    catalogStateSchema.safeParse({
      auto_update: true,
      etag: "etag-1",
      last_checked_at: at,
      last_received_at: at,
      last_failure: null,
      snapshot_hash: hash,
    }).success,
  );
  assert(
    !catalogStateSchema.safeParse({
      auto_update: true,
      etag: null,
      last_checked_at: null,
      last_received_at: null,
      last_failure: "invalid_input",
      snapshot_hash: "ABC",
    }).success,
  );
  assertEquals(CATALOG_REFRESH_INTERVAL_MS, 86_400_000);
});

Deno.test("lophn-agent/harness/model#R8: defaults hold four role slots and the summaries slot, all empty at first", () => {
  assertEquals([...MODEL_DEFAULT_SLOTS], [
    "lophn",
    "context_engineer",
    "app_engineer",
    "operator",
    "summaries",
  ]);
  const empty = {
    lophn: null,
    context_engineer: null,
    app_engineer: null,
    operator: null,
    summaries: null,
    settings_seq: "0",
  };
  assert(modelDefaultsSchema.safeParse(empty).success);
  const choice = {
    provider,
    model_name: "gpt",
    option_values: { effort: "high", speed: "fast" },
  };
  assert(
    modelDefaultsSchema.safeParse({
      ...empty,
      operator: choice,
      summaries: { ...choice, option_values: {} },
      settings_seq: "3",
    }).success,
  );
  for (
    const value of [
      { ...empty, judgment: null },
      { ...empty, organizing: null },
      { ...empty, summaries: undefined },
      { ...empty, lophn: { ...choice, credentials: ["personal"] } },
      { ...empty, lophn: { ...choice, option_values: { effort: "" } } },
      { ...empty, propagate: true },
    ]
  ) assert(!modelDefaultsSchema.safeParse(value).success);
});

Deno.test("lophn-agent/harness/model#R8: a defaults change names only the slots it changes", () => {
  const choice = { provider, model_name: "gpt", option_values: {} };
  assert(changeModelDefaultsInputSchema.safeParse({ lophn: choice }).success);
  // null은 그 slot을 비우는 변경이다.
  assert(
    changeModelDefaultsInputSchema.safeParse({
      operator: null,
      summaries: choice,
    }).success,
  );
  for (
    const value of [
      {},
      { lophn: undefined },
      { judgment: choice },
      { lophn: choice, settings_seq: "1" },
    ]
  ) assert(!changeModelDefaultsInputSchema.safeParse(value).success);
});

Deno.test("lophn-agent/harness/model#R26: favorites keep the order they were starred in", () => {
  const first = { provider, model_name: "gpt-b" };
  const second = { provider: `pvd_${"0".repeat(26)}`, model_name: "gpt-a" };
  const favorites = modelFavoritesSchema.parse({
    items: [second, first],
    settings_seq: "2",
  });
  assertEquals(favorites.items, [second, first]);
  assert(
    modelFavoritesSchema.safeParse({ items: [], settings_seq: "0" }).success,
  );
  for (
    const value of [
      { items: [first, first], settings_seq: "1" },
      { items: [{ ...first, last_used_at: at }], settings_seq: "1" },
      { items: [first] },
    ]
  ) assert(!modelFavoritesSchema.safeParse(value).success);
});

Deno.test("lophn-agent/harness/model#R15: effort values keep their order and fixed display names", () => {
  assertEquals([...EFFORT_VALUES], [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "very_high",
    "maximum",
  ]);
  assertEquals(EFFORT_VALUES.map((value) => EFFORT_LABELS[value]), [
    "Off",
    "Minimal",
    "Low",
    "Medium",
    "High",
    "XHigh",
    "Max",
  ]);
  const axis = (values: ReturnType<typeof effortValues>) => ({
    ...effortAxis,
    values,
    default_value: null,
  });
  assert(
    optionAxisSchema.safeParse(axis(effortValues(["low", "very_high"])))
      .success,
  );
  for (
    const value of [
      axis(effortValues(["high", "low"])),
      axis(effortValues(["low", "low"])),
      axis(effortValues(["low", "ultra"])),
      axis(effortValues(["low", "high"], { low: "Low", high: "Higher" })),
      { ...axis(effortValues(["low", "high"])), default_value: "medium" },
    ]
  ) assert(!optionAxisSchema.safeParse(value).success);
});

Deno.test("lophn-agent/harness/model#R17: only a budget axis carries a range and takes the four budget values", () => {
  assertEquals(EFFORT_BUDGET_TOKENS, {
    low: 2048,
    medium: 8192,
    high: 16384,
    maximum: 32768,
  });
  const budgeted = {
    ...effortAxis,
    values: effortValues(["off", "low", "medium", "high", "maximum"]),
    default_value: null,
    budget: { minimum: 1024, maximum: 24000 },
  };
  assert(optionAxisSchema.safeParse(budgeted).success);
  for (
    const value of [
      { ...budgeted, budget: { minimum: 30000, maximum: 24000 } },
      { ...budgeted, budget: { minimum: 0, maximum: 24000 } },
      // 예산이 없는 값(minimal, very_high)은 예산 축에 못 든다.
      { ...budgeted, values: effortValues(["low", "very_high"]) },
      { ...budgeted, values: effortValues(["minimal", "low"]) },
      { ...speedAxis, budget: { minimum: 1, maximum: 2 } },
    ]
  ) assert(!optionAxisSchema.safeParse(value).success);
});

Deno.test("lophn-agent/harness/model#R22: an option value reaches the request by a body patch or a model id swap", () => {
  const patch = { kind: "body_patch", patch: { service_tier: "priority" } };
  assert(optionWireSchema.safeParse(patch).success);
  assert(optionWireSchema.safeParse(swap).success);
  // 빈 조각은 더할 것이 없다는 명시 값이고, header는 조각과 함께 싣는다.
  assert(optionWireSchema.safeParse({ kind: "body_patch", patch: {} }).success);
  assert(
    optionWireSchema.safeParse({
      kind: "body_patch",
      patch: { speed: "fast" },
      headers: { "anthropic-beta": "fast-mode-2026-02-01" },
    }).success,
  );
  for (
    const value of [
      { kind: "body_patch", patch: [] },
      { ...patch, headers: {} },
      { ...patch, headers: { "x-tier": "" } },
      { ...patch, headers: { "x-tier": 1 } },
      { ...swap, headers: { "x-tier": "1" } },
      { kind: "model_id", model_name: " " },
      { kind: "header", name: "x-tier" },
      { ...swap, patch: {} },
    ]
  ) assert(!optionWireSchema.safeParse(value).success);
  assert(optionAxisSchema.safeParse(speedAxis).success);
  // 번역 표가 있는 것은 effort뿐이라 다른 축은 값마다 wire가 있어야 한다.
  assert(
    !optionAxisSchema.safeParse({
      ...speedAxis,
      values: speedAxis.values.map((value) => ({ ...value, wire: null })),
    }).success,
  );
});

Deno.test("lophn-agent/harness/model#R13: a run basis reuses the resolved model schema", () => {
  assertEquals(runBasisModelSchema, resolvedModelSchema);
  const resolved = {
    purpose: "judgment",
    credential_revision: null,
    provider,
    model_name: "grok-4",
    sent_model_name: "grok-4-fast",
    verification: "unverified",
    option_values: { speed: "fast" },
    request_patch: {},
    request_headers: {},
    context_limit: 1,
    input_limit: 1,
    output_limit: 1,
    supports_tools: false,
    input_media: ["text"],
    output_media: ["text"],
    price_basis: null,
    basis: {},
  };
  assert(runBasisModelSchema.safeParse(resolved).success);
  for (
    const value of [
      { ...resolved, provider: `ses_${suffix}` },
      { ...resolved, sent_model_name: undefined },
      { ...resolved, option_values: { speed: "" } },
      { ...resolved, request_headers: undefined },
      { ...resolved, request_headers: { "anthropic-beta": 1 } },
      { ...resolved, options: {}, reasoning_level: "provider_default" },
    ]
  ) assert(!runBasisModelSchema.safeParse(value).success);
});

Deno.test("lophn-agent/instructions#R7: instruction bytes stay within the fixed caps", () => {
  assertEquals(INSTRUCTION_FILE_MAX_BYTES, 32_768);
  assertEquals(INSTRUCTION_CALL_MAX_BYTES, 131_072);
});
