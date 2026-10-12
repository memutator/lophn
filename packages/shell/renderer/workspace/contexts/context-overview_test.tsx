import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../design/components/testing.ts";

import { ContextOverview } from "./context-overview.tsx";
import { createFakeContextsSource, EVAL, HARNESS } from "./fake-source.ts";
import { all, norm } from "./testing.tsx";

function overview(
  context: string,
  handlers: {
    onOpenDocument?: (path: string) => void;
    onSeeAll?: (type: string) => void;
  } = {},
) {
  return render(
    <ContextOverview
      source={createFakeContextsSource()}
      context={context}
      onOpenDocument={handlers.onOpenDocument ?? (() => {})}
      onSeeAll={handlers.onSeeAll ?? (() => {})}
    />,
  );
}

Deno.test("shell/workspace#R18 [ctx-I42]: 개체 카드는 계약의 type 순서로 나오고 다른 context에서 온 개체는 맨 뒤에 'from harness'로 따로 보인다", async () => {
  using view = overview(EVAL);
  await settle();
  const entities = all(view.container, "[data-entity]");
  assertEquals(entities.map((entity) => entity.dataset.entity), [
    "Experiment",
    "Scenario",
    "Rubric",
    "Finding",
    "Change",
  ]);
  const change = entities.at(-1)!;
  assertEquals(
    norm(change.querySelector("[data-entity-from]")),
    "from harness",
  );
  assert(change.querySelector("[data-entity-count]") === null);
  assert(change.querySelector("[data-see-all]") === null);
});

Deno.test("shell/workspace#R18 [ctx-I42]: 카드는 이름·한 줄 뜻·개수·가진 것·예시·See all을 이 순서로 보인다", async () => {
  using view = overview(EVAL);
  await settle();
  const card = one(view.container, '[data-entity="Experiment"]');
  assertEquals(norm(card.querySelector("h3")), "Experiment");
  assertEquals(norm(card.querySelector("[data-entity-count]")), "13");
  assertEquals(
    norm(card.querySelector("[data-entity-meaning]")),
    "Tests whether one change helps, on a set of scenarios.",
  );
  // 가진 것은 key field와 관계를 잇는 field를 빼고 계약의 field 순서로 쓴다.
  const has = norm(card.querySelector("[data-entity-has]"));
  assert(has.startsWith("has "), `unexpected: ${has}`);
  const at = ["status", "question", "baseline"].map((name) =>
    has.indexOf(name)
  );
  assert(at.every((index) => index > 0), `missing field in: ${has}`);
  assertEquals([...at].sort((a, b) => a - b), at);
  for (const hidden of ["about", "scenarios", "findings", "id"]) {
    assert(!has.includes(hidden), `${hidden} should not be listed: ${has}`);
  }
  assert(
    norm(card.querySelector("[data-entity-example]")).startsWith(
      "e.g. exp-008",
    ),
  );
  assertEquals(norm(card.querySelector("[data-see-all]")), "See all 13 →");
  // 카드 안 순서.
  const order = [
    "h3",
    "[data-entity-count]",
    "[data-entity-meaning]",
    "[data-entity-has]",
    "[data-entity-example]",
    "[data-see-all]",
  ]
    .map((selector) => card.querySelector(selector)!);
  for (let i = 1; i < order.length; i += 1) {
    assert(
      order[i - 1]!.compareDocumentPosition(order[i]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      `${i} is out of order`,
    );
  }
});

Deno.test("shell/workspace#R18 [ctx-I42]: 카드 사이는 사람 말 화살표로 이어지고 순서는 계약의 type·관계 순서다", async () => {
  using view = overview(EVAL);
  await settle();
  assertEquals(
    all(view.container, "[data-edge]").map((edge) => [
      edge.dataset.from,
      edge.dataset.to,
      norm(edge.querySelector("[data-edge-label]")),
    ]),
    [
      ["Experiment", "Change", "checks"],
      ["Experiment", "Scenario", "runs on"],
      ["Experiment", "Finding", "produces"],
      ["Scenario", "Rubric", "graded by"],
      ["Finding", "Change", "about"],
      ["Finding", "Scenario", "from"],
    ],
  );
});

Deno.test("shell/workspace#R18 [ctx-I42]: 예시 문서 이름을 누르면 그 문서 경로로 열고 See all은 개체 종류 이름을 넘긴다", async () => {
  const opened: string[] = [];
  const seen: string[] = [];
  using view = overview(EVAL, {
    onOpenDocument: (path) => opened.push(path),
    onSeeAll: (type) => seen.push(type),
  });
  await settle();
  const links = all(
    view.container,
    "[data-entity-example] [data-open-document]",
  );
  assertEquals(links.map(norm), [
    "exp-008",
    "query-leave-still",
    "schedule-quality",
    "F-009",
  ]);
  click(links[0]!);
  click(links[3]!);
  assertEquals(opened, [
    "eval/experiments/exp-008-query-tools.md",
    "loop/findings/F-009.md",
  ]);
  click(one(view.container, '[data-entity="Scenario"] [data-see-all]'));
  assertEquals(seen, ["Scenario"]);
});

Deno.test("shell/workspace#R18 [ctx-I42]: Overview에는 kind·public·series·rule·판 번호 같은 계약 말이 나오지 않는다", async () => {
  using view = overview(EVAL);
  await settle();
  const text = norm(view.container);
  assert(text.length > 0, "nothing rendered");
  for (
    const word of [
      /\bpublic\b/i,
      /\bprivate\b/i,
      /\bseries\b/i,
      /\brules?\b/i,
      /\bVersion\b/,
      /Declared searches/,
    ]
  ) {
    assert(!word.test(text), `contract word ${word} in Overview`);
  }
});

Deno.test("shell/workspace#R18 [ctx-I42]: 아래에 Composition 트리가 붙는다", async () => {
  using view = overview(EVAL);
  await settle();
  assertEquals(
    norm(one(view.container, "[data-composition] h2")),
    "Composition",
  );
});

Deno.test("shell/workspace#R18 [ctx-I42]: 개체 둘만 있고 관계가 없는 context는 화살표 없이 카드 둘만 보인다", async () => {
  using view = overview(HARNESS);
  await settle();
  assertEquals(
    all(view.container, "[data-entity]").map((entity) => entity.dataset.entity),
    ["Change", "Component"],
  );
  assertEquals(all(view.container, "[data-edge]").length, 0);
});
