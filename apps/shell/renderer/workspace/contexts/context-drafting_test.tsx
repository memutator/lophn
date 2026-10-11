import { assert, assertEquals } from "@std/assert";
import {
  one,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";

import { ContextDrafting } from "./context-drafting.tsx";
import { createFakeContextsSource, RELEASE_NOTES } from "./fake-source.ts";
import { activate, all, norm } from "./testing.tsx";

function drafting() {
  return render(
    <ContextDrafting
      source={createFakeContextsSource({ drafting: true })}
      context={RELEASE_NOTES}
    />,
  );
}

Deno.test("shell/workspace#R30 [ctx-I41]: drafting 머리는 이름·Context 표시·목적과 'step 2 of 4'를 보인다", async () => {
  using view = drafting();
  await settle();
  assertEquals(norm(one(view.container, "h1")), "release-notes");
  assertEquals(norm(one(view.container, "[data-context-chip]")), "Context");
  assertEquals(
    norm(one(view.container, "[data-purpose]")),
    "Keep release notes, changelogs and the issues they close findable, so an Operator can draft the next release note.",
  );
  assertEquals(
    norm(one(view.container, "[data-drafting]")),
    "Context Engineer is drafting · step 2 of 4",
  );
});

Deno.test("shell/workspace#R30 [ctx-I41]: 진행 목록은 읽기·초안·검사·적용 네 단계를 done·now·later와 ✓●○ 표시로 보인다", async () => {
  using view = drafting();
  await settle();
  const steps = all(one(view.container, "ol[aria-label=Progress]"), "li");
  assertEquals(
    steps.map((step) => [
      step.dataset.stepState,
      norm(step.querySelector("[data-step-mark]")),
      norm(step).replace(/^[✓●○]\s*/, ""),
    ]),
    [
      ["done", "✓", "Read 3 places (24 documents)"],
      ["now", "●", "Drafting overview and searches"],
      ["later", "○", "Run checks"],
      ["later", "○", "Apply"],
    ],
  );
});

Deno.test("shell/workspace#R30 [ctx-I41]: 흐린 초안 개체와 관계가 Draft 표시와 함께 보이고 확정이 아니라는 글이 붙는다", async () => {
  using view = drafting();
  await settle();
  const heading = one(view.container, "[data-draft-heading]");
  assertEquals(
    norm(heading.querySelector("h2")).replace(/\s*Draft$/, ""),
    "Draft overview",
  );
  assertEquals(norm(heading.querySelector("[data-draft-chip]")), "Draft");
  const cards = all(view.container, "[data-draft-entity]");
  assertEquals(
    cards.map((card) => [
      norm(card.querySelector("h3")),
      norm(card.querySelector("[data-draft-chip]")),
    ]),
    [["Changelog entry", "Draft"], ["Release", "Draft"], ["Issue", "Draft"]],
  );
  const relations = all(view.container, "[data-draft-relation]").map(norm);
  assertEquals(relations.length, 2);
  assert(relations[0]!.includes("mentions") && relations[0]!.includes("→"));
  assert(relations[1]!.includes("closes") && relations[1]!.includes("→"));
  assertEquals(
    norm(one(view.container, "[data-draft-note]")),
    "Not final. Context Engineer applies it when the checks pass.",
  );
});

Deno.test("shell/workspace#R30 [ctx-I41]: 하위 탭은 다섯 개이고 Overview 밖은 첫 판이 적용된 뒤에 쓸 수 있다는 안내만 보인다", async () => {
  using view = drafting();
  await settle();
  const tabs = all(view.container, "[role=tab]");
  assertEquals(tabs.map(norm), [
    "Overview",
    "Search",
    "Violations",
    "Glossary",
    "Contract",
  ]);
  activate(tabs[1]!);
  assertEquals(
    norm(one(view.container, "[role=tabpanel][data-state=active]")),
    "Available after Context Engineer applies the first version.",
  );
});
