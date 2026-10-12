import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
} from "../../../../design/components/testing.ts";

import { ContextFrame } from "./context-frame.tsx";
import {
  createFakeContextsSource,
  EVAL,
  HARNESS,
  RELEASE_NOTES,
} from "./fake-source.ts";
import type { SubTab } from "./shared.ts";
import { activate, all, buttonNamed, norm, NOW } from "./testing.tsx";

function frame(
  context: string,
  sub: SubTab,
  overrides: Partial<Parameters<typeof ContextFrame>[0]> = {},
) {
  return render(
    <ContextFrame
      source={createFakeContextsSource({ drafting: true })}
      context={context}
      sub={sub}
      onSub={() => {}}
      renderPanel={(shown) => <p data-panel-body={shown}>{shown} body</p>}
      onAsk={() => {}}
      onHistory={() => {}}
      now={NOW}
      {...overrides}
    />,
  );
}

Deno.test("shell/workspace#R17 [ctx-I41]: 머리는 이름·Context 표시·목적을 이 순서로 보이고 Overview에서는 Context Engineer가 갱신한다는 줄만 더한다", async () => {
  using view = frame(EVAL, "overview");
  await settle();
  const head = one(view.container, "[data-context-head]");
  assertEquals(norm(head.querySelector("h1")), "eval");
  assertEquals(norm(head.querySelector("[data-context-chip]")), "Context");
  assertEquals(
    norm(head.querySelector("[data-purpose]")),
    "Keep experiments, scenarios, rubrics and findings of the eval loop findable.",
  );
  assertEquals(
    norm(head.querySelector("[data-kept-up-to-date]")),
    "Kept up to date by Context Engineer",
  );
  assert(head.querySelector("[data-version]") === null);
  assertEquals(all(head, "button").length, 0);
});

Deno.test("shell/workspace#R17 [ctx-I41]: 하위 탭은 Overview · Search · Violations · Glossary · Contract 순이고 위반이 있으면 Violations에 개수가 붙는다", async () => {
  using view = frame(EVAL, "overview");
  await settle();
  assertEquals(all(view.container, "[role=tab]").map(norm), [
    "Overview",
    "Search",
    "Violations (2)",
    "Glossary",
    "Contract",
  ]);
  using harness = frame(HARNESS, "overview");
  await settle();
  assertEquals(
    all(harness.container, "[role=tab]").map(norm)[2],
    "Violations",
  );
});

Deno.test("shell/workspace#R17 [ctx-I41]: 고른 하위 탭이 활성이고 그 본문을 renderPanel에서 받아 보이며 탭을 누르면 onSub로 알린다", async () => {
  const chosen: SubTab[] = [];
  using view = frame(EVAL, "search", { onSub: (sub) => chosen.push(sub) });
  await settle();
  const tabs = all(view.container, "[role=tab]");
  assertEquals(
    tabs.filter((item) => item.dataset.state === "active").map(norm),
    ["Search"],
  );
  assertEquals(
    norm(one(view.container, "[role=tabpanel][data-state=active]")),
    "search body",
  );
  activate(tabs[2]!);
  assertEquals(chosen, ["violations"]);
});

Deno.test("shell/workspace#R21 [ctx-I41]: Contract에서만 판 번호·적용 시각·검사 결과 줄과 안내가 보이고 [Ask Context Engineer]가 유일한 primary다", async () => {
  const asked: string[] = [];
  using view = frame(EVAL, "contract", {
    onAsk: () => asked.push("ask"),
    onHistory: () => asked.push("history"),
  });
  await settle();
  const head = one(view.container, "[data-context-head]");
  assertEquals(
    norm(head.querySelector("[data-version]")),
    "Version r3 · applied 2 hours ago · tests passed",
  );
  assertEquals(
    norm(head.querySelector("[data-note]")),
    "Details for Context Engineer and the curious",
  );
  assert(head.querySelector("[data-kept-up-to-date]") === null);
  const primaries = all(head, "button[data-variant=primary]");
  assertEquals(primaries.map(norm), ["Ask Context Engineer"]);
  click(buttonNamed(head, "Ask Context Engineer")!);
  click(buttonNamed(head, "History")!);
  assertEquals(asked, ["ask", "history"]);
});

Deno.test("shell/workspace#R30 [ctx-I41]: 만드는 중인 context는 단계 n of 4를 보이는 drafting 틀로 그린다", async () => {
  using view = frame(RELEASE_NOTES, "overview");
  await settle();
  assertEquals(
    norm(one(view.container, "[data-drafting]")),
    "Context Engineer is drafting · step 2 of 4",
  );
  assert(
    view.container.querySelector("[data-panel-body]") === null,
    "a drafting context does not render the panels",
  );
});
