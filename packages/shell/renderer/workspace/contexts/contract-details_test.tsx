import { assert, assertEquals } from "@std/assert";
import { one, render, settle } from "../../../../design/components/testing.ts";

import { ContractDetails } from "./contract-details.tsx";
import { createFakeContextsSource, EVAL, HARNESS } from "./fake-source.ts";
import { all, norm } from "./testing.tsx";

function details(context = EVAL) {
  return render(
    <ContractDetails source={createFakeContextsSource()} context={context} />,
  );
}

const card = (root: ParentNode, name: string) =>
  one(root, `[data-type-card="${name}"]`);

Deno.test("shell/workspace#R21 [ctx-I46]: 위쪽에 개체 관계 그림이 있고 개체는 계약 순서, 다른 context의 개체는 harness.Change처럼 바깥 표시로 맨 뒤에 놓인다", async () => {
  using view = details();
  await settle();
  const diagram = one(view.container, "svg[role=img]");
  const nodes = all(diagram, "[data-node]");
  assertEquals(nodes.map(norm), [
    "Experiment",
    "Scenario",
    "Rubric",
    "Finding",
    "harness.Change",
  ]);
  assertEquals(
    nodes.map((node) => node.dataset.nodeExternal === "true"),
    [false, false, false, false, true],
  );
  const edges = all(diagram, "[data-edge]");
  assertEquals(edges.length, 6);
  assertEquals(
    edges.filter((edge) => edge.dataset.edgeExternal === "true").map((edge) =>
      `${edge.dataset.from}>${edge.dataset.to}`
    ),
    ["Experiment>Change", "Finding>Change"],
  );
  // 그림은 개체 카드보다 위에 있다.
  assert(
    diagram.compareDocumentPosition(card(view.container, "Experiment")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

Deno.test("shell/workspace#R21 [ctx-I46]: 개체 카드는 계약 순서로 이름·public 표시·kind·경로·문서 수를 보인다", async () => {
  using view = details();
  await settle();
  const cards = all(view.container, "[data-type-card]");
  assertEquals(cards.map((item) => item.dataset.typeCard), [
    "Experiment",
    "Scenario",
    "Rubric",
    "Finding",
  ]);
  const head = (name: string) => {
    const item = card(view.container, name);
    return [
      norm(item.querySelector("h3")),
      item.querySelector("[data-public]") === null ? "" : "public",
      norm(item.querySelector("[data-type-kind]")),
      norm(item.querySelector("[data-type-path]")),
      norm(item.querySelector("[data-type-count]")),
    ];
  };
  assertEquals(head("Experiment"), [
    "Experiment",
    "public",
    "kind series",
    "eval/experiments/exp-{n}-*.md",
    "13 documents",
  ]);
  assertEquals(head("Scenario"), [
    "Scenario",
    "",
    "kind folder",
    "eval/scenarios/*",
    "34 documents",
  ]);
  assertEquals(head("Rubric")[3], "eval/rubrics/*");
  assertEquals(head("Finding").slice(1, 4), [
    "public",
    "kind series",
    "loop/findings/F-{n}.md",
  ]);
});

Deno.test("shell/workspace#R21 [ctx-I46]: 카드의 Fields는 key와 관계 field를 빼고 값 종류·출처·public 표시를, Relations는 이름 → 대상을 적는다", async () => {
  using view = details();
  await settle();
  const experiment = card(view.container, "Experiment");
  assertEquals(all(experiment, "[data-fields] li").map(norm), [
    "status draft | running | reported public",
    "question = section 질문",
    "baseline = section 기준선",
  ]);
  assertEquals(all(experiment, "[data-relations] li").map(norm), [
    "about → harness.Change public",
    "scenarios → Scenario",
    "findings → Finding",
  ]);
  // 관계가 없는 개체는 Relations 구역이 없다.
  assert(
    card(view.container, "Rubric").querySelector("[data-relations]") === null,
  );
  assertEquals(
    all(card(view.container, "Rubric"), "[data-fields] li").map(norm),
    ["criteria"],
  );
});

Deno.test("shell/workspace#R21 [ctx-I46]: 선언된 검색은 이름과 예시 검사 결과를 계약 순서로 보인다", async () => {
  using view = details();
  await settle();
  assertEquals(
    norm(one(view.container, "[data-declared-searches] h2")),
    "Declared searches",
  );
  assertEquals(
    all(view.container, "[data-declared-search]").map((row) => [
      norm(row.querySelector("[data-search-title]")),
      norm(row.querySelector("[data-search-name]")),
      norm(row.querySelector("[data-search-examples]")),
    ]),
    [
      ["Findings about a change", "findings_about_change", "✓ 6 examples pass"],
      ["Experiments by status", "experiments_by_status", "✓ 6 examples pass"],
      ["Scenarios using a rubric", "scenarios_by_rubric", "✓ 6 examples pass"],
    ],
  );
});

Deno.test("shell/workspace#R21 [ctx-I46]: 판 번호·적용 시각·단추는 머리(ContextFrame)의 몫이라 본문에 나오지 않고, 선언된 검색이 없는 context는 그 구역이 없다", async () => {
  using view = details(HARNESS);
  await settle();
  assertEquals(
    all(view.container, "[data-type-card]").map((item) =>
      item.dataset.typeCard
    ),
    ["Change", "Component"],
  );
  assertEquals(all(view.container, "[data-declared-search]").length, 0);
  const text = norm(view.container);
  assert(!/Version r\d/.test(text) && !/applied/.test(text));
  assertEquals(all(view.container, "button").length, 0);
});
