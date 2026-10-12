import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import {
  createFakeContextsSource,
  EVAL,
  experimentPath,
} from "./fake-source.ts";
import { SearchResults } from "./search-results.tsx";
import type { DeclaredSearch, SearchPage } from "./source.ts";
import { all, buttonNamed, norm } from "./testing.tsx";

async function load(name: string, cursor?: string) {
  const source = createFakeContextsSource();
  const contract = await source.contract(EVAL);
  if (!contract.ok || contract.value.content === null) {
    throw new Error("no contract");
  }
  const search = contract.value.content.searches.find((item) =>
    item.name === name
  )!;
  const page = await source.search({
    context: EVAL,
    search: name,
    inputs: {},
    ...(cursor === undefined ? {} : { cursor }),
  });
  if (!page.ok) throw new Error(page.message);
  return { search, page: page.value };
}

function results(
  search: DeclaredSearch,
  page: SearchPage,
  state: { page: number; pageSize: number },
  handlers: {
    onPage?: (page: number) => void;
    onOpenDocument?: (path: string) => void;
  } = {},
) {
  return render(
    <SearchResults
      search={search}
      rows={page.rows}
      page={state.page}
      pageSize={state.pageSize}
      total={page.total}
      onPage={handlers.onPage ?? (() => {})}
      onOpenDocument={handlers.onOpenDocument ?? (() => {})}
    />,
  );
}

Deno.test("shell/workspace#R25 [ctx-I48]: 표는 선언한 열 이름과 순서로 그리고 위에 결과 개수를 적는다", async () => {
  const { search, page } = await load("findings_about_change");
  using view = results(search, page, { page: 0, pageSize: 5 });
  await settle();
  assertEquals(norm(one(view.container, "[data-result-count]")), "14 findings");
  assertEquals(all(view.container, "table th").map(norm), [
    "Finding",
    "Kind",
    "Scenario",
    "Effect",
    "Experiment",
  ]);
  const rows = all(view.container, "tbody tr");
  assertEquals(rows.length, 5);
  assertEquals(all(rows[0]!, "td").map(norm), [
    "F-009",
    "improvement",
    "query-leave-still",
    "world_actions 3 → 0",
    "exp-008",
  ]);
  assertEquals(rows.map((row) => norm(row.querySelector("td"))), [
    "F-009",
    "F-010",
    "F-011",
    "F-013",
    "F-014",
  ]);
});

Deno.test("shell/workspace#R26 [ctx-I48]: 개체 이름(Finding·Scenario·Experiment 열)은 링크이고 누르면 그 개체의 문서 경로로 연다", async () => {
  const { search, page } = await load("findings_about_change");
  const opened: string[] = [];
  using view = results(search, page, { page: 0, pageSize: 5 }, {
    onOpenDocument: (path) => opened.push(path),
  });
  await settle();
  const first = one(view.container, "tbody tr");
  const links = all(first, "[data-open-document]");
  assertEquals(links.map(norm), ["F-009", "query-leave-still", "exp-008"]);
  for (const link of links) click(link);
  assertEquals(opened, [
    "loop/findings/F-009.md",
    "eval/scenarios/query-leave-still/r1.yaml",
    experimentPath("exp-008"),
  ]);
  // 개체가 아닌 열(Kind·Effect)은 링크가 아니다.
  assertEquals(
    all(first, "td")[1]!.querySelector("[data-open-document]"),
    null,
  );
  assertEquals(
    all(first, "td")[3]!.querySelector("[data-open-document]"),
    null,
  );
});

Deno.test("shell/workspace#R25 [ctx-I48]: 한 page를 넘으면 '1–5 of 14', 이전·다음, page 번호가 보이고 지금 page는 aria-current다", async () => {
  const { search, page } = await load("findings_about_change");
  const moved: number[] = [];
  using view = results(search, page, { page: 0, pageSize: 5 }, {
    onPage: (next) => moved.push(next),
  });
  await settle();
  const pager = one(view.container, "[data-pager]");
  assertEquals(norm(one(pager, "[data-range]")), "1–5 of 14");
  assertEquals(all(pager, "button").map(norm), [
    "‹ Prev",
    "1",
    "2",
    "3",
    "Next ›",
  ]);
  assertEquals(buttonNamed(pager, "‹ Prev")!.hasAttribute("disabled"), true);
  assertEquals(buttonNamed(pager, "Next ›")!.hasAttribute("disabled"), false);
  assertEquals(
    all(pager, "button[aria-current=page]").map(norm),
    ["1"],
  );
  click(buttonNamed(pager, "3")!);
  click(buttonNamed(pager, "Next ›")!);
  assertEquals(moved, [2, 1]);
});

Deno.test("shell/workspace#R25 [ctx-I48]: 마지막 page는 남은 줄만 '11–14 of 14'로 적고 [Next]가 막히며 [Prev]는 앞 page로 보낸다", async () => {
  const { search, page } = await load("findings_about_change", "10");
  const moved: number[] = [];
  using view = results(search, page, { page: 2, pageSize: 5 }, {
    onPage: (next) => moved.push(next),
  });
  await settle();
  const pager = one(view.container, "[data-pager]");
  assertEquals(norm(one(pager, "[data-range]")), "11–14 of 14");
  assertEquals(all(view.container, "tbody tr").length, 4);
  assertEquals(buttonNamed(pager, "Next ›")!.hasAttribute("disabled"), true);
  assertEquals(all(pager, "button[aria-current=page]").map(norm), ["3"]);
  click(buttonNamed(pager, "‹ Prev")!);
  assertEquals(moved, [1]);
});

Deno.test("shell/workspace#R25 [ctx-I48]: 결과가 한 page에 다 들어오면 이동 단추 없이 개수만 보인다", async () => {
  const { search, page } = await load("findings_about_change");
  const few: SearchPage = {
    ...page,
    rows: page.rows.slice(0, 3),
    total: 3,
    complete: true,
    next_cursor: null,
  };
  using view = results(search, few, { page: 0, pageSize: 5 });
  await settle();
  assertEquals(norm(one(view.container, "[data-result-count]")), "3 findings");
  assertEquals(view.container.querySelector("[data-pager]"), null);
});

Deno.test("shell/workspace#R25 [ctx-I48]: board는 board_by 값마다 열이고 열 제목과 개수 아래 카드가 줄 순서로 쌓인다", async () => {
  const { search, page } = await load("experiments_by_status");
  using view = results(search, page, { page: 0, pageSize: 30 });
  await settle();
  const columns = all(view.container, "[data-board-column]");
  assertEquals(
    columns.map((column) => [
      column.dataset.boardColumn,
      norm(column.querySelector("[data-board-title]")),
      norm(column.querySelector("[data-board-count]")),
      all(column, "[data-board-card]").map((card) =>
        norm(card.querySelector("[data-open-document]"))
      ),
    ]),
    [
      ["draft", "Draft", "2", ["exp-013", "exp-014"]],
      ["running", "Running", "3", ["exp-008", "exp-011", "exp-012"]],
      ["reported", "Reported", "3", ["exp-007", "exp-006", "exp-005"]],
    ],
  );
  assertEquals(view.container.querySelector("table"), null);
});

Deno.test("shell/workspace#R25 [ctx-I48]: board 카드는 개체 링크 뒤에 첫 열 값을, 아래 줄에 나머지 열 값을 보이고 링크는 문서를 연다", async () => {
  const { search, page } = await load("experiments_by_status");
  const opened: string[] = [];
  using view = results(search, page, { page: 0, pageSize: 30 }, {
    onOpenDocument: (path) => opened.push(path),
  });
  await settle();
  const card = all(view.container, "[data-board-card]").find((item) =>
    norm(item.querySelector("[data-open-document]")) === "exp-008"
  )!;
  assert(card, "exp-008 card is missing");
  assertEquals(
    norm(card.querySelector("[data-board-title-line]")),
    "exp-008 · query tools",
  );
  assertEquals(
    norm(card.querySelector("[data-board-meta]")),
    "6 scenarios · 3 findings",
  );
  click(card.querySelector("[data-open-document]")!);
  assertEquals(opened, [experimentPath("exp-008")]);
});

Deno.test("shell/workspace#R26 [ctx-T10c]: 표의 모든 개체 링크 단추는 table이 직접 data-open-document를 단다", async () => {
  const { search, page } = await load("findings_about_change");
  using view = results(search, page, { page: 0, pageSize: 5 });
  await settle();
  const buttons = all(view.container, "td[data-kind=link] > button");
  assertEquals(buttons.length, 15);
  assert(
    buttons.every((link) => link.getAttribute("data-open-document") === ""),
  );
});
