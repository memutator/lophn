import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  press,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import { createFakeContextsSource, EVAL } from "./fake-source.ts";
import { SearchInputForm } from "./search-input-form.tsx";
import type { DeclaredSearch, PickOption } from "./source.ts";
import {
  all,
  buttonNamed,
  fieldLabeled,
  norm,
  pick,
  typeInto,
} from "./testing.tsx";

async function declared(name: string): Promise<DeclaredSearch> {
  const contract = await createFakeContextsSource().contract(EVAL);
  if (!contract.ok || contract.value.content === null) {
    throw new Error("no contract");
  }
  return contract.value.content.searches.find((search) =>
    search.name === name
  )!;
}

async function optionsOf(search: DeclaredSearch) {
  const source = createFakeContextsSource();
  const options: Record<string, readonly PickOption[]> = {};
  for (const input of search.inputs) {
    const result = await source.inputOptions({
      context: EVAL,
      search: search.name,
      input: input.name,
    });
    if (result.ok) options[input.name] = result.value.options;
  }
  return options;
}

interface Calls {
  changes: [string, unknown][];
  searched: number;
  saved: number;
  asked: number;
}

function form(
  search: DeclaredSearch,
  options: Readonly<Record<string, readonly PickOption[]>>,
  values: Record<string, unknown> = {},
) {
  const calls: Calls = { changes: [], searched: 0, saved: 0, asked: 0 };
  const view = render(
    <SearchInputForm
      search={search}
      values={values}
      options={options}
      onChange={(name, value) => calls.changes.push([name, value])}
      onSearch={() => calls.searched += 1}
      onSaveView={() => calls.saved += 1}
      onAsk={() => calls.asked += 1}
    />,
  );
  return { view, calls };
}

const rangeSearch: DeclaredSearch = {
  name: "findings_by_effect",
  title: "Findings by effect",
  inputs: [
    {
      name: "effect",
      label: "Effect size",
      type: "range",
      of: "Finding.effects",
      many: false,
      required: false,
    },
    { name: "note", label: "Note", type: "text", many: false, required: false },
  ],
  query: { from: "Finding", where: null, follow: [], sort: [], group: null },
  result: {
    kind: "table",
    columns: [{ label: "Finding", path: "key" }],
    page_size: 30,
  },
};

Deno.test("shell/workspace#R24 [ctx-I47]: form은 선언의 입력을 선언된 순서와 이름으로 그리고 아래에 [Search]와 [Save as view]를 둔다", async () => {
  const search = await declared("findings_about_change");
  const { view, calls } = form(search, await optionsOf(search), {
    kind: ["improvement", "regression"],
  });
  using _ = view;
  await settle();
  const inputs = all(view.container, "[data-input]");
  assertEquals(inputs.map((input) => input.dataset.input), [
    "change",
    "kind",
    "metric",
  ]);
  assertEquals(
    inputs.map((input) => norm(input.querySelector("[data-input-label]"))),
    ["Change", "Kind", "Metric"],
  );
  assertEquals(
    fieldLabeled(view.container, "Change").getAttribute("role"),
    "combobox",
  );
  assertEquals(
    fieldLabeled(view.container, "Metric").getAttribute("role"),
    "combobox",
  );
  const search_ = buttonNamed(view.container, "Search")!;
  const save = buttonNamed(view.container, "Save as view")!;
  assertEquals(search_.dataset.variant, "primary");
  click(search_);
  click(save);
  assertEquals([calls.searched, calls.saved], [1, 1]);
});

Deno.test("shell/workspace#R24 [ctx-I47]: combobox에 일부를 치면 이름에 든 후보만 남고 후보를 고르면 그 value를 알린다", async () => {
  const search = await declared("findings_about_change");
  const { view, calls } = form(search, await optionsOf(search));
  using _ = view;
  await settle();
  const change = fieldLabeled(view.container, "Change") as HTMLInputElement;
  typeInto(change, "C-04");
  assertEquals(change.getAttribute("aria-expanded"), "true");
  const listed = all(one(view.container, "[role=listbox]"), "[role=option]");
  assertEquals(
    listed.map((option) => norm(option).split(" · ")[0]),
    ["C-049", "C-041", "C-040"],
  );
  pick(listed[1]!);
  assertEquals(calls.changes, [["change", "c-041"]]);
});

Deno.test("shell/workspace#R24 [ctx-I47]: 후보에 없는 글은 고를 수 없다: 'No matches'가 보이고 Enter를 눌러도 값이 바뀌지 않는다", async () => {
  const search = await declared("findings_about_change");
  const { view, calls } = form(search, await optionsOf(search));
  using _ = view;
  await settle();
  const metric = fieldLabeled(view.container, "Metric") as HTMLInputElement;
  typeInto(metric, "zzz");
  const list = one(view.container, "[role=listbox]");
  assertEquals(norm(list), "No matches");
  assertEquals(all(list, "[role=option]").length, 0);
  press(metric, "Enter");
  assertEquals(calls.changes, []);
});

Deno.test("shell/workspace#R24 [ctx-I47]: 여럿 고르는 입력은 후보마다 chip이고 고른 것은 ✓로 표시되며 누르면 목록에 더하고 뺀다", async () => {
  const search = await declared("findings_about_change");
  const { view, calls } = form(search, await optionsOf(search), {
    kind: ["improvement", "regression"],
  });
  using _ = view;
  await settle();
  const chips = all(
    one(view.container, '[data-input="kind"]'),
    "button[aria-pressed]",
  );
  assertEquals(
    chips.map((chip) => [norm(chip), chip.getAttribute("aria-pressed")]),
    [["✓ improvement", "true"], ["✓ regression", "true"], ["neutral", "false"]],
  );
  click(chips[2]!);
  click(chips[0]!);
  assertEquals(calls.changes, [
    ["kind", ["improvement", "regression", "neutral"]],
    ["kind", ["regression"]],
  ]);
});

Deno.test("shell/workspace#R24 [ctx-I47]: 범위 입력은 시작과 끝 두 칸이고 글 입력은 한 칸이며 채워 둔 값이 보인다", async () => {
  const { view, calls } = form(rangeSearch, {}, {
    effect: { from: "3", to: "" },
    note: "slow",
  });
  using _ = view;
  await settle();
  const range = one(view.container, '[data-input="effect"]');
  const from = fieldLabeled(range, "From") as HTMLInputElement;
  const to = fieldLabeled(range, "To") as HTMLInputElement;
  assertEquals([from.value, to.value], ["3", ""]);
  typeInto(to, "9");
  assertEquals(calls.changes.at(-1), ["effect", { from: "3", to: "9" }]);
  const note = fieldLabeled(view.container, "Note") as HTMLInputElement;
  assertEquals(note.value, "slow");
  typeInto(note, "slower");
  assertEquals(calls.changes.at(-1), ["note", "slower"]);
});

Deno.test("shell/workspace#R24 [ctx-I47]: 그릴 수 없는 입력 타입이면 form 대신 이유와 [Ask Context Engineer]만 보인다", async () => {
  const unsupported = {
    ...rangeSearch,
    inputs: [{
      name: "when",
      label: "When",
      type: "calendar",
      many: false,
      required: false,
    }],
  } as unknown as DeclaredSearch;
  const { view, calls } = form(unsupported, {});
  using _ = view;
  await settle();
  const reason = one(view.container, "[data-unsupported]");
  assert(
    norm(reason).includes("calendar"),
    `reason should name the type: ${norm(reason)}`,
  );
  assertEquals(all(view.container, "[data-input]").length, 0);
  assert(buttonNamed(view.container, "Search") === null);
  click(buttonNamed(view.container, "Ask Context Engineer")!);
  assertEquals(calls.asked, 1);
});
