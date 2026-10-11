import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  one,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../../../packages/design/components/testing.ts";

import { AgentSelect, type AgentSelectProps } from "./agent-select.tsx";
import {
  APP_AGENTS_SHUFFLED,
  APP_ENGINEER,
  BUDGET_WATCHER,
  CONTEXT_ENGINEER,
  LOPHN,
  MONTH_CLOSER,
} from "./testdata/agent-select.ts";

type Call = readonly [string, ...string[]];

function select(agents: AgentSelectProps["agents"], calls: Call[] = []) {
  return render(
    <AgentSelect
      agents={agents}
      onOpenAgent={(assignment) => calls.push(["open", assignment])}
      onManage={() => calls.push(["manage"])}
    />,
  );
}

function menu(): HTMLElement | null {
  return document.querySelector("[role=menu]");
}

async function openMenu(container: HTMLElement): Promise<HTMLElement> {
  const trigger = one(container, "[data-agent-select]");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  return one(document, "[role=menu]");
}

function label(item: HTMLElement): string {
  return item.hasAttribute("data-agent-manage")
    ? "Manage"
    : one(item, "[data-agent-name]").textContent ?? "";
}

Deno.test("shell/app-frame#R37 [agent-I38]: 닫힌 select는 버튼 하나이고 menu가 없다", () => {
  using view = select(APP_AGENTS_SHUFFLED);
  const triggers = view.container.querySelectorAll("[data-agent-select]");
  assertEquals(triggers.length, 1);
  const trigger = triggers[0] as HTMLElement;
  assertEquals(trigger.tagName, "BUTTON");
  assertEquals(trigger.getAttribute("aria-haspopup"), "menu");
  assertEquals(
    trigger.getAttribute("aria-label") ?? trigger.textContent,
    "Agent",
  );
  assertEquals(menu(), null);
});

Deno.test("shell/app-frame#R37 [agent-I38]: 펼친 목록은 lophn · App Engineer · Operator들 · Manage 순이고 agent 줄마다 avatar와 이름이 보이며 Context Engineer가 없다", async () => {
  using view = select(APP_AGENTS_SHUFFLED);
  const open = await openMenu(view.container);
  const items = [...open.querySelectorAll<HTMLElement>("[role=menuitem]")];
  assertEquals(items.map(label), [
    "lophn",
    "App Engineer",
    "Budget watcher",
    "Month closer",
    "Manage",
  ]);
  assertEquals(
    items.slice(0, 4).map((item) => item.getAttribute("data-agent")),
    [LOPHN, APP_ENGINEER, BUDGET_WATCHER, MONTH_CLOSER].map((agent) =>
      agent.assignment
    ),
  );
  for (const item of items.slice(0, 4)) {
    const avatar = one(item, "[data-avatar]");
    const name = one(item, "[data-agent-name]");
    assert(
      avatar.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the avatar comes before the name",
    );
  }
  assertEquals(
    one(items[2], "[data-avatar]").getAttribute("data-icon"),
    "search",
  );
  assertEquals(items[3].querySelector("[data-avatar]")!.textContent, "MC");
  // Manage는 agent가 아니다.
  assertEquals(items[4].hasAttribute("data-agent"), false);
  assertEquals(
    open.querySelector(`[data-agent="${CONTEXT_ENGINEER.assignment}"]`),
    null,
  );
  assert(!(open.textContent ?? "").includes("Context Engineer"));
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R37 [agent-I38]: Operator가 없는 앱의 목록은 lophn · App Engineer · Manage뿐이다", async () => {
  using view = select([APP_ENGINEER, LOPHN]);
  const open = await openMenu(view.container);
  assertEquals(
    [...open.querySelectorAll<HTMLElement>("[role=menuitem]")].map(label),
    ["lophn", "App Engineer", "Manage"],
  );
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R38 [agent-I38]: agent를 고르면 그 assignment로 onOpenAgent를 한 번 부르고 menu가 닫힌다", async () => {
  const calls: Call[] = [];
  using view = select(APP_AGENTS_SHUFFLED, calls);
  const open = await openMenu(view.container);
  click(one(open, `[data-agent="${BUDGET_WATCHER.assignment}"]`));
  await settle();
  assertEquals(calls, [["open", BUDGET_WATCHER.assignment]]);
  assertEquals(menu(), null);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R39 [agent-I38]: Manage를 고르면 onManage만 한 번 부르고 menu가 닫힌다", async () => {
  const calls: Call[] = [];
  using view = select(APP_AGENTS_SHUFFLED, calls);
  const open = await openMenu(view.container);
  click(one(open, "[data-agent-manage]"));
  await settle();
  assertEquals(calls, [["manage"]]);
  assertEquals(menu(), null);
  await unmountSettled(view);
});
