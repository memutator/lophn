import { assert, assertEquals } from "@std/assert";
import { one, render, settle } from "../../../../design/components/testing.ts";

import { ContextComposition } from "./context-composition.tsx";
import { createFakeContextsSource, EVAL } from "./fake-source.ts";
import { all, norm } from "./testing.tsx";

function composition() {
  return render(
    <ContextComposition source={createFakeContextsSource()} context={EVAL} />,
  );
}

Deno.test("shell/workspace#R18 [ctx-I43]: Composition은 제목 아래 트리로 context 이름을 뿌리로 하고 개체를 계약 순서로 늘어놓는다", async () => {
  using view = composition();
  await settle();
  const root = one(view.container, "[data-composition]");
  assertEquals(norm(root.querySelector("h2")), "Composition");
  one(root, "[role=tree]");
  const labels = all(root, "[data-node-label]").map(norm);
  assertEquals(labels[0], "eval");
  const types = labels.filter((label) => label.includes(" — "));
  assertEquals(types.map((label) => label.split(" — ")[0]), [
    "Experiment",
    "Scenario",
    "Rubric",
    "Finding",
  ]);
});

Deno.test("shell/workspace#R18 [ctx-I43]: 개체 줄은 이름·문서 수·자료 경로를 보인다", async () => {
  using view = composition();
  await settle();
  const labels = all(view.container, "[data-node-label]").map(norm);
  const line = (name: string) =>
    labels.find((label) => label.startsWith(`${name} — `))!;
  assert(
    line("Experiment").startsWith(
      "Experiment — 13 documents in eval/experiments",
    ),
  );
  assert(
    line("Scenario").startsWith("Scenario — 34 folders in eval/scenarios"),
  );
  assert(line("Rubric").startsWith("Rubric — 2 folders in eval/rubrics"));
  assert(line("Finding").startsWith("Finding — 14 documents in loop/findings"));
});

Deno.test("shell/workspace#R18 [ctx-I43]: 개체 아래에 가진 것(section에서 온 것은 출처)과 이어진 것을 사람 말로 적는다", async () => {
  using view = composition();
  await settle();
  const labels = all(view.container, "[data-node-label]").map(norm);
  assertEquals(
    labels.filter((label) => /^(has|links):/.test(label)),
    [
      "has: status · question (from section “질문”) · baseline (from section “기준선”)",
      "links: checks → Change (harness) · runs on → Scenario · produces → Finding",
      "has: tags · stages",
      "links: graded by → Rubric",
      "has: criteria",
      "has: kind · effects",
      "links: about → Change (harness) · from → Scenario",
    ],
  );
  assertEquals(labels.at(-1), "uses from harness: Change");
});

Deno.test("shell/workspace#R18 [ctx-I43]: 뿌리와 개체 줄은 펼쳐 있고 계약 말(public·series·kind 값)이 없다", async () => {
  using view = composition();
  await settle();
  const items = all(view.container, "[role=treeitem]");
  const expanded = items
    .filter((item) => item.getAttribute("aria-expanded") === "true")
    .map((item) =>
      norm(item.querySelector("[data-node-label]")).split(" — ")[0]
    );
  assertEquals(expanded, [
    "eval",
    "Experiment",
    "Scenario",
    "Rubric",
    "Finding",
  ]);
  const text = norm(view.container);
  for (
    const word of [
      /\bpublic\b/i,
      /\bseries\b/i,
      /\bkind series\b/i,
      /\bfolder\b/,
    ]
  ) {
    assert(!word.test(text), `contract word ${word} in Composition`);
  }
});
