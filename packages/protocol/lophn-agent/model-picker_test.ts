import assert from "node:assert/strict";
import { test } from "node:test";

import type { CatalogEntry } from "./models.ts";
import { selectableModels } from "./model-picker.ts";

// 필요한 칸만 채운 catalog 항목이다. selectableModels는 정의와 이름만 본다.
const entry = (provider_definition: string, model_name: string) =>
  ({ provider_definition, model_name }) as CatalogEntry;

const a1 = entry("a", "m1");
const a2 = entry("a", "m2");
const b1 = entry("b", "m1");
const catalog = [a1, b1, a2];

test("selectableModels: 알려 준 목록이 있으면 그 목록, 없거나 비면 그 정의의 catalog이고 다른 정의는 섞이지 않는다", () => {
  const cases: [string, readonly string[] | null, unknown][] = [
    ["null이면 그 정의의 catalog 전부", null, [
      { model_name: "m1", entry: a1 },
      { model_name: "m2", entry: a2 },
    ]],
    ["빈 목록도 거르지 않는다", [], [
      { model_name: "m1", entry: a1 },
      { model_name: "m2", entry: a2 },
    ]],
    [
      "일부만 catalog와 겹치면 안 겹친 것은 entry null, catalog에만 있는 m2는 빠진다",
      ["x", "m1"],
      [
        { model_name: "x", entry: null },
        { model_name: "m1", entry: a1 },
      ],
    ],
    ["중복 이름은 한 번만, 목록 순서대로", ["m1", "m1", "x", "m1"], [
      { model_name: "m1", entry: a1 },
      { model_name: "x", entry: null },
    ]],
  ];
  for (const [label, reported, want] of cases) {
    assert.deepStrictEqual(
      selectableModels({ definition: "a", catalog, reported }),
      want,
      label,
    );
  }
  // 같은 이름이 다른 정의에 있어도 그 정의의 항목이 붙는다.
  assert.deepStrictEqual(
    selectableModels({ definition: "b", catalog, reported: ["m1"] }),
    [{ model_name: "m1", entry: b1 }],
  );
});

test("selectableModels: 사람이 정보를 적은 항목은 알려 준 목록에 없어도 더해지고 목록에 있으면 한 번만 나온다", () => {
  const typed = { ...entry("a", "typed"), source: "user" } as CatalogEntry;
  const m1 = { ...entry("a", "m1"), source: "user" } as CatalogEntry;
  const withUser = [m1, a2, typed];
  assert.deepStrictEqual(
    selectableModels({
      definition: "a",
      catalog: withUser,
      reported: ["m1", "x"],
    }),
    [
      { model_name: "m1", entry: m1 },
      { model_name: "x", entry: null },
      { model_name: "typed", entry: typed },
    ],
  );
  assert.deepStrictEqual(
    selectableModels({ definition: "a", catalog: withUser, reported: null })
      .map((model) => model.model_name),
    ["m1", "m2", "typed"],
  );
});
