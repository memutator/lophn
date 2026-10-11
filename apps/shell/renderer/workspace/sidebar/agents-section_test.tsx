import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
} from "../../../../../packages/design/components/testing.ts";

import {
  AgentRailButton,
  AgentsSection,
  type AgentsSectionProps,
} from "./agents-section.tsx";
import {
  AGENTS_SHUFFLED,
  CONTEXT_ENGINEER,
  EVAL_ANALYST,
  LOPHN,
  RELEASE_WATCHER,
  waiting,
} from "./testdata/agents.ts";

type Call = readonly [string, ...string[]];

function section(
  agents: AgentsSectionProps["agents"],
  calls: Call[] = [],
) {
  return render(
    <AgentsSection
      agents={agents}
      onOpenAgent={(assignment) => calls.push(["open", assignment])}
      onManage={() => calls.push(["manage"])}
    />,
  );
}

// agent 줄과 Manage를 문서 순서로 모은다.
function entries(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    "[data-agents] [data-agent], [data-agents] [data-agents-manage]",
  )];
}

function label(entry: HTMLElement): string {
  return entry.hasAttribute("data-agents-manage")
    ? "Manage"
    : one(entry, "[data-agent-name]").textContent ?? "";
}

Deno.test("shell/workspace#R34 [agent-I31]: Agents 묶음은 lophn · Context Engineer · Operator들 · Manage 순이고 줄마다 avatar와 이름이 보인다", () => {
  using view = section(AGENTS_SHUFFLED);
  assertEquals(one(view.container, "[data-agents] h2").textContent, "Agents");
  const rows = entries(view.container);
  assertEquals(rows.map(label), [
    "lophn",
    "Context Engineer",
    "Eval analyst",
    "Release watcher",
    "Manage",
  ]);
  assertEquals(
    rows.slice(0, 4).map((row) => row.getAttribute("data-agent")),
    [LOPHN, CONTEXT_ENGINEER, EVAL_ANALYST, RELEASE_WATCHER].map((agent) =>
      agent.assignment
    ),
  );
  for (const row of rows.slice(0, 4)) {
    assertEquals(row.tagName, "BUTTON");
    // avatar가 이름보다 앞이다.
    const avatar = one(row, "[data-avatar]");
    const name = one(row, "[data-agent-name]");
    assert(
      avatar.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the avatar comes before the name",
    );
  }
  assertEquals(
    one(rows[2], "[data-avatar]").getAttribute("data-icon"),
    "search",
  );
  assertEquals(rows[3].querySelector("[data-avatar]")!.textContent, "RW");
});

Deno.test("shell/workspace#R34 [agent-I31]: Operator가 없는 project의 묶음은 lophn · Context Engineer · Manage뿐이다", () => {
  using view = section([CONTEXT_ENGINEER, LOPHN]);
  assertEquals(entries(view.container).map(label), [
    "lophn",
    "Context Engineer",
    "Manage",
  ]);
});

Deno.test("shell/workspace#R34 [agent-I31]: agent 줄을 누르면 그 agent의 assignment로 onOpenAgent를 한 번 부른다", () => {
  const calls: Call[] = [];
  using view = section(AGENTS_SHUFFLED, calls);
  click(one(view.container, `[data-agent="${EVAL_ANALYST.assignment}"]`));
  assertEquals(calls, [["open", EVAL_ANALYST.assignment]]);
  click(one(view.container, `[data-agent="${LOPHN.assignment}"]`));
  assertEquals(calls, [
    ["open", EVAL_ANALYST.assignment],
    ["open", LOPHN.assignment],
  ]);
});

Deno.test("shell/workspace#R34 [agent-I31]: Manage는 onManage만 부르고 agent를 열지 않는다", () => {
  const calls: Call[] = [];
  using view = section(AGENTS_SHUFFLED, calls);
  click(one(view.container, "[data-agents-manage]"));
  assertEquals(calls, [["manage"]]);
});

Deno.test("shell/workspace#R34 [agent-I31]: sidebar에는 session 목록도 session을 여는 단추도 없다", () => {
  using view = section(AGENTS_SHUFFLED);
  const root = one(view.container, "[data-agents]");
  assertEquals(root.querySelector("[role=listbox], [data-session]"), null);
  assertEquals(
    [...root.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label")
    ).filter((name) => name !== null && /session/i.test(name)),
    [],
  );
  assert(!/session/i.test(root.textContent ?? ""), "no session wording");
});

Deno.test("shell/workspace#R35 [agent-I31]: 답을 기다리는 session이 있는 agent 줄에만 Waiting for you 점이 이름과 함께 보인다", () => {
  using view = section([
    LOPHN,
    CONTEXT_ENGINEER,
    waiting(EVAL_ANALYST),
    RELEASE_WATCHER,
  ]);
  const dots = (row: HTMLElement) =>
    [...row.querySelectorAll<HTMLElement>("[role=img]")].filter((dot) =>
      dot.getAttribute("aria-label") === "Waiting for you"
    );
  const rows = entries(view.container);
  assertEquals(rows.slice(0, 4).map((row) => dots(row).length), [0, 0, 1, 0]);
  // 점은 줄 button 안에 있고 이름도 그대로 보인다.
  assertEquals(label(rows[2]), "Eval analyst");
  assertEquals(dots(rows[2])[0].closest("button"), rows[2]);
  // 점은 줄을 누르는 일을 바꾸지 않는다.
  assertEquals(rows[2].getAttribute("data-agent"), EVAL_ANALYST.assignment);
});

Deno.test("shell/workspace#R32 [agent-I31]: 접힌 rail의 Agent 단추는 onOpenLophn을 한 번 부른다", () => {
  const calls: Call[] = [];
  using view = render(
    <AgentRailButton onOpenLophn={() => calls.push(["lophn"])} />,
  );
  const button = one(view.container, 'button[data-rail="agent"]');
  assertEquals(button.getAttribute("aria-label"), "Agent");
  assertEquals(view.container.querySelectorAll("button").length, 1);
  click(button);
  assertEquals(calls, [["lophn"]]);
});
