import { assert, assertEquals } from "@std/assert";
import { useState } from "react";
import {
  click,
  focus,
  one,
  pressAsync,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import {
  createFakeContextsSource,
  EVAL,
  experimentPath,
  fakeId,
  HARNESS,
  PROJECT,
} from "./fake-source.ts";
import { SearchTab, type SearchTabState } from "./search-tab.tsx";
import type { ContextsSource } from "./source.ts";
import {
  all,
  buttonNamed,
  fieldLabeled,
  norm,
  settleReads,
  typeInto,
} from "./testing.tsx";

const FIRST_VIEW = fakeId("viw", "v1");

const START: SearchTabState = {
  context: EVAL,
  search: "findings_about_change",
  inputs: { kind: ["improvement", "regression"] },
  page: 0,
  savedView: null,
};

interface Spy {
  states: SearchTabState[];
  contexts: string[];
  documents: string[];
  asked: number;
}

function tab(initial: SearchTabState = START) {
  const spy: Spy = { states: [], contexts: [], documents: [], asked: 0 };
  const source = createFakeContextsSource();
  function Controlled() {
    const [state, setState] = useState(initial);
    return (
      <SearchTab
        project={PROJECT}
        source={source}
        state={state}
        onState={(next) => {
          spy.states.push(next);
          setState(next);
        }}
        onOpenContext={(context) => spy.contexts.push(context)}
        onOpenDocument={(path) => spy.documents.push(path)}
        onAsk={() => spy.asked += 1}
      />
    );
  }
  return { view: render(<Controlled />), spy, source };
}

Deno.test("shell/workspace#R23 [ctx-I49]: 왼쪽에 context 고르기·'Open context'·선언된 검색 목록·Saved views가 이 순서로 있다", async () => {
  const { view, spy } = tab();
  using _ = view;
  await settle();
  const side = one(view.container, "[data-search-side]");
  const parts = [
    fieldLabeled(side, "Context"),
    one(side, "[data-open-context]"),
    one(side, "[data-search-list]"),
    one(side, "[data-saved-views]"),
  ];
  for (let i = 1; i < parts.length; i += 1) {
    assert(
      parts[i - 1]!.compareDocumentPosition(parts[i]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      `side part ${i} is out of order`,
    );
  }
  assertEquals(norm(parts[0]), "eval");
  assertEquals(norm(parts[1]), "Open context");
  click(parts[1]!);
  assertEquals(spy.contexts, [EVAL]);
});

Deno.test("shell/workspace#R23 [ctx-I49]: 선언된 검색은 계약에 선언된 순서로 나열되고 고른 검색이 aria-current이며 Saved views는 이름으로 나열된다", async () => {
  const { view } = tab();
  using _ = view;
  await settle();
  const declared = all(view.container, "[data-declared]");
  assertEquals(declared.map(norm), [
    "Findings about a change",
    "Experiments by status",
    "Scenarios using a rubric",
  ]);
  assertEquals(
    declared.filter((item) => item.getAttribute("aria-current") === "true").map(
      norm,
    ),
    ["Findings about a change"],
  );
  assertEquals(
    all(view.container, "[data-saved-view]").map((item) =>
      item.dataset.savedView
    ),
    [FIRST_VIEW, fakeId("viw", "v2")],
  );
  assertEquals(all(view.container, "[data-saved-view]").map(norm), [
    "Findings for C-049",
    "Running experiments",
  ]);
});

Deno.test("shell/workspace#R23 [ctx-I49]: 본문은 고른 검색의 제목과 입력 form과 결과 표를 보인다", async () => {
  const { view } = tab();
  using _ = view;
  await settle();
  assertEquals(norm(one(view.container, "h1")), "Findings about a change");
  assertEquals(
    fieldLabeled(view.container, "Change").getAttribute("role"),
    "combobox",
  );
  assertEquals(norm(one(view.container, "[data-result-count]")), "14 findings");
  assertEquals(all(view.container, "tbody tr").length, 5);
});

Deno.test("shell/workspace#R23 [ctx-I49]: 다른 검색을 고르면 그 검색으로 입력과 page를 비운 state를 알리고 board 결과가 나온다", async () => {
  const { view, spy } = tab();
  using _ = view;
  await settle();
  click(all(view.container, "[data-declared]")[1]!);
  await settle();
  assertEquals(spy.states.at(-1), {
    context: EVAL,
    search: "experiments_by_status",
    inputs: {},
    page: 0,
    savedView: null,
  });
  assertEquals(norm(one(view.container, "h1")), "Experiments by status");
  assertEquals(all(view.container, "[data-board-column]").length, 3);
});

Deno.test("shell/workspace#R23 [ctx-I49]: context를 바꾸면 검색 목록과 Saved views가 그 context 것으로 바뀌고 선언된 검색이 없으면 비었음 상태와 [Open context]만 보인다", async () => {
  const { view, spy } = tab();
  using _ = view;
  await settle();
  const trigger = fieldLabeled(view.container, "Context");
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  await settle();
  assertEquals(spy.states.at(-1), {
    context: HARNESS,
    search: null,
    inputs: {},
    page: 0,
    savedView: null,
  });
  assertEquals(all(view.container, "[data-declared]").length, 0);
  assertEquals(all(view.container, "[data-saved-view]").length, 0);
  const empty = one(view.container, "[data-state=empty]");
  assertEquals(all(empty, "button").map(norm), ["Open context"]);
  click(buttonNamed(empty, "Open context")!);
  assertEquals(spy.contexts, [HARNESS]);
});

Deno.test("shell/workspace#R27 [ctx-I49]: Saved views에서 고르면 저장한 입력을 채운 state를 알리고 최신 결과를 다시 계산한다", async () => {
  const { view, spy } = tab();
  using _ = view;
  await settle();
  click(one(view.container, `[data-saved-view="${FIRST_VIEW}"]`));
  await settle();
  assertEquals(spy.states.at(-1), {
    context: EVAL,
    search: "findings_about_change",
    inputs: { change: "c-049" },
    page: 0,
    savedView: FIRST_VIEW,
  });
  assertEquals(norm(one(view.container, "[data-result-count]")), "3 findings");
  assert(
    (fieldLabeled(view.container, "Change") as HTMLInputElement).value
      .startsWith("C-049"),
  );
});

Deno.test("shell/workspace#R25 [ctx-I49]: 입력을 바꾸면 1 page로 돌아가고 [Search]가 바뀐 입력의 결과를 보인다", async () => {
  const { view, spy } = tab({ ...START, page: 1 });
  using _ = view;
  // page 1은 앞 page의 cursor를 따라 두 번 읽으므로 읽기가 act 틈에서 끝난다.
  await settleReads();
  assertEquals(norm(one(view.container, "[data-range]")), "6–10 of 14");
  click(
    buttonNamed(one(view.container, '[data-input="kind"]'), "✓ regression")!,
  );
  assertEquals(spy.states.at(-1), {
    ...START,
    inputs: { kind: ["improvement"] },
    page: 0,
  });
  await settle();
  click(buttonNamed(view.container, "Search")!);
  await settle();
  assertEquals(norm(one(view.container, "[data-result-count]")), "11 findings");
});

Deno.test("shell/workspace#R25 [ctx-I49]: page 번호를 누르면 그 page를 알리고 그 범위의 줄이 보인다", async () => {
  const { view, spy } = tab();
  using _ = view;
  await settle();
  click(buttonNamed(one(view.container, "[data-pager]"), "2")!);
  await settle();
  assertEquals(spy.states.at(-1), { ...START, page: 1 });
  assertEquals(norm(one(view.container, "[data-range]")), "6–10 of 14");
  assertEquals(
    all(view.container, "tbody tr").map((row) => norm(row.querySelector("td"))),
    ["F-001", "F-002", "F-003", "F-004", "F-005"],
  );
});

Deno.test("shell/workspace#R27 [ctx-I49]: [Save as view]는 이름을 받아 지금 입력으로 저장하고 Saved views에 더한다", async () => {
  const { view, source } = tab({ ...START, inputs: { change: "c-041" } });
  using _ = view;
  await settle();
  click(buttonNamed(view.container, "Save as view")!);
  typeInto(fieldLabeled(view.container, "View name"), "Chest names");
  click(buttonNamed(view.container, "Save")!);
  await settle();
  assertEquals(source.calls, [{
    command: "saveView",
    request: {
      context: EVAL,
      name: "Chest names",
      search: "findings_about_change",
      inputs: { change: "c-041" },
    },
  }]);
  assertEquals(
    all(view.container, "[data-saved-view]").map(norm).at(-1),
    "Chest names",
  );
});

Deno.test("shell/workspace#R26 [ctx-I49]: 결과의 개체 링크는 문서 경로를 부른 쪽에 넘긴다", async () => {
  const { view, spy } = tab();
  using _ = view;
  await settle();
  const links = all(one(view.container, "tbody tr"), "[data-open-document]");
  click(links[2]!);
  assertEquals(spy.documents, [experimentPath("exp-008")]);
});

function requiredSource() {
  const base = createFakeContextsSource();
  const source: ContextsSource = {
    ...base,
    contract: async (context) => {
      const read = await base.contract(context);
      if (!read.ok || read.value.content === null) return read;
      const searches = read.value.content.searches.map((search) => ({
        ...search,
        inputs: search.inputs.map((input) =>
          input.name === "kind" ? { ...input, required: true } : input
        ),
      }));
      return {
        ok: true as const,
        value: {
          ...read.value,
          content: { ...read.value.content, searches },
        },
      };
    },
  };
  return source;
}

Deno.test("shell/workspace#R24 [ctx-T10c]: 꼭 채워야 하는 입력이 비면 그 입력 이름을 담은 안내 글이 보이고 결과는 읽지 않는다", async () => {
  const source = requiredSource();
  const view = render(
    <SearchTab
      project={PROJECT}
      source={source}
      state={{ ...START, inputs: {}, page: 0 }}
      onState={() => {}}
      onOpenContext={() => {}}
      onOpenDocument={() => {}}
      onAsk={() => {}}
    />,
  );
  using _ = view;
  await settleReads();
  assertEquals(
    norm(one(view.container, "[data-input-required]")),
    "Fill in Kind to see results.",
  );
  assertEquals(all(view.container, "[data-result-count]").length, 0);
});

Deno.test("shell/workspace#R24 [ctx-T10c]: 꼭 채워야 하는 입력이 차 있으면 안내 글 없이 결과가 보인다", async () => {
  const view = render(
    <SearchTab
      project={PROJECT}
      source={requiredSource()}
      state={START}
      onState={() => {}}
      onOpenContext={() => {}}
      onOpenDocument={() => {}}
      onAsk={() => {}}
    />,
  );
  using _ = view;
  await settleReads();
  assertEquals(all(view.container, "[data-input-required]").length, 0);
  assertEquals(all(view.container, "[data-result-count]").length, 1);
});
