import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import { ContextsTab } from "./contexts-tab.tsx";
import {
  createFakeContextsSource,
  EVAL,
  HARNESS,
  PROJECT,
} from "./fake-source.ts";
import type { ContextsSource } from "./source.ts";
import { all, buttonNamed, norm } from "./testing.tsx";

function tab(
  overrides: Partial<Parameters<typeof ContextsTab>[0]> = {},
  source = createFakeContextsSource(),
) {
  return render(
    <ContextsTab
      projectTitle="phroner"
      project={PROJECT}
      source={source}
      onOpenContext={() => {}}
      onNewContext={() => {}}
      {...overrides}
    />,
  );
}

Deno.test("shell/workspace#R16 [ctx-I40]: Contexts 탭은 제목 아래에 context 카드를 이름 순으로 나열하고 카드마다 이름과 목적을 보인다", async () => {
  using view = tab();
  await settle();
  assertEquals(norm(one(view.container, "h1")), "Contexts in phroner");
  const cards = all(view.container, "[data-context-card]");
  assertEquals(cards.map((card) => card.dataset.contextCard), [EVAL, HARNESS]);
  assertEquals(cards.map((card) => norm(card.querySelector("h3"))), [
    "eval",
    "harness",
  ]);
  assertEquals(
    cards.map((card) => norm(card.querySelector("[data-purpose]"))),
    [
      "Keep experiments, scenarios, rubrics and findings of the eval loop findable.",
      "Keep harness changes and components findable.",
    ],
  );
});

Deno.test("shell/workspace#R16 [ctx-I40]: 카드는 종류 수·적용된 판과 검사 결과·위반 수·쓰는 Operator 수를 이 순서의 줄로 보인다", async () => {
  using view = tab();
  await settle();
  const rows = (id: string) =>
    all(one(view.container, `[data-context-card="${id}"]`), "li").map(norm);
  assertEquals(rows(EVAL), [
    "4 kinds of things (Experiment, Scenario, Rubric, Finding)",
    "Version r3, tests passed",
    "2 violations",
    "Used by 1 Operator",
  ]);
  assertEquals(rows(HARNESS), [
    "2 kinds of things (Change, Component)",
    "Version r5, tests passed",
    "no violations",
    "Used by 2 Operators",
  ]);
});

Deno.test("shell/workspace#R16 [ctx-I40]: 위반이 있는 카드의 위반 줄만 data-warn으로 구별된다", async () => {
  using view = tab();
  await settle();
  const violations = (id: string) =>
    one(view.container, `[data-context-card="${id}"] [data-violations]`);
  assertEquals(violations(EVAL).dataset.warn, "true");
  assert(violations(HARNESS).dataset.warn === undefined);
});

Deno.test("shell/workspace#R16 [ctx-I40]: 카드의 [Open]은 그 context ID로 열고 [New context]는 카드들 아래에 안내 글과 함께 있다", async () => {
  const opened: string[] = [];
  let created = 0;
  using view = tab({
    onOpenContext: (context) => opened.push(context),
    onNewContext: () => created += 1,
  });
  await settle();
  const harness = one(view.container, `[data-context-card="${HARNESS}"]`);
  click(buttonNamed(harness, "Open")!);
  assertEquals(opened, [HARNESS]);
  const create = buttonNamed(view.container, "New context")!;
  assert(create, "[New context] is missing");
  const lastCard = all(view.container, "[data-context-card]").at(-1)!;
  assert(
    lastCard.compareDocumentPosition(create) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "[New context] must come after the cards",
  );
  assertEquals(
    norm(one(view.container, "[data-new-context-note]")),
    "Context Engineer sets it up with you in an Agent tab.",
  );
  click(create);
  assertEquals(created, 1);
});

Deno.test("shell/workspace#R16 [ctx-I40]: context가 없으면 카드 없이 비었음 상태와 [New context] 하나만 보인다", async () => {
  using view = tab({}, createFakeContextsSource({ empty: true }));
  await settle();
  assertEquals(all(view.container, "[data-context-card]").length, 0);
  one(view.container, "[data-state=empty]");
  assertEquals(
    all(view.container, "button").map(norm),
    ["New context"],
  );
});

Deno.test("shell/workspace#R16 [ctx-I39b]: 색인이나 Operator 수를 읽지 못해도 카드는 그 줄만 빼고 보인다", async () => {
  const fake = createFakeContextsSource();
  const source: ContextsSource = {
    ...fake,
    overview: () => Promise.resolve({ ok: false, message: "unavailable" }),
    operatorCount: () => Promise.resolve({ ok: false, message: "unavailable" }),
  };
  using view = tab({}, source);
  await settle();
  const rows = (id: string) =>
    all(one(view.container, `[data-context-card="${id}"]`), "li").map(norm);
  assertEquals(rows(EVAL), [
    "Version r3, tests passed",
    "2 violations",
  ]);
  assertEquals(rows(HARNESS), [
    "Version r5, tests passed",
    "no violations",
  ]);
});
