// agent-I24: `/` 메뉴. 묶음·거르기 규칙은 lophn-agent/commands(list_test)가 보고, 여기서는 받은 묶음을
// 순서대로 그리는지, 맞는 글자를 굵게 하는지, 일하는 중 못 쓰는 명령을 흐리게 하고 이유를 말하는지,
// 알 수 없는 명령과 같은 이름 skill을 어떻게 알리는지 본다.
import { assert, assertEquals } from "@std/assert";
import { click, one, render } from "../../../../design/components/testing.ts";

import { SlashMenu } from "./slash-menu.tsx";
import {
  COMPACT,
  CONTEXT_ENGINEER_ALL,
  FORK,
  LOPHN_CO,
  LOPHN_DUPLICATE_SKILLS,
  OPERATOR_ALL,
  slashCalls,
  slashProps,
  WEEKLY_REPORT_PLACE,
  WEEKLY_REPORT_WORKSPACE,
} from "../testdata/slash-menu.ts";

function text(element: Element): string {
  return element.textContent!.trim();
}

function groups(root: ParentNode): { title: string; labels: string[] }[] {
  return [...root.querySelectorAll("[data-slash-group]")].map((group) => ({
    title: text(one(group, "[data-slash-heading]")),
    labels: [...group.querySelectorAll("[role=option]")].map((row) =>
      text(one(row, "[data-slash-label]"))
    ),
  }));
}

function rowOf(root: ParentNode, name: string, origin?: string): HTMLElement {
  const suffix = origin === undefined ? "" : `[data-origin="${origin}"]`;
  return one(root, `[role=option][data-command="${name}"]${suffix}`);
}

function bold(root: ParentNode): string[] {
  return [...root.querySelectorAll("strong")].map(text);
}

Deno.test("shell/desktop#R45 [agent-I24]: the menu is a listbox with Commands, the agent's name and Skills in that order", () => {
  using view = render(<SlashMenu {...slashProps()} />);
  const menu = one(view.container, "[role=listbox]");
  assertEquals(menu.getAttribute("aria-label"), "Commands");
  assertEquals(groups(menu), [
    {
      title: "Commands",
      labels: [
        "New session",
        "Rename",
        "Archive",
        "Compact",
        "Fork",
        "MCP",
        "Skills",
        "Permissions",
      ],
    },
    { title: "lophn", labels: ["New app", "Repair app"] },
    {
      title: "Skills",
      labels: ["eval-metrics", "release-notes", "weekly-report"],
    },
  ]);
  assertEquals(
    [...menu.querySelectorAll("[data-slash-group]")].map((group) =>
      group.getAttribute("data-source")
    ),
    ["builtin", "role", "skill"],
  );
  assertEquals(
    text(one(rowOf(menu, "compact"), "[data-slash-description]")),
    "Summarize this session to free up context",
  );
});

Deno.test("shell/desktop#R45 [agent-I24]: the second group takes the agent's name and Operator has no second group", () => {
  using view = render(
    <SlashMenu
      {...slashProps({
        agentName: "Context Engineer",
        state: { kind: "list", groups: CONTEXT_ENGINEER_ALL },
      })}
    />,
  );
  assertEquals(groups(view.container).map((group) => group.title), [
    "Commands",
    "Context Engineer",
    "Skills",
  ]);
  assertEquals(groups(view.container)[1].labels, [
    "Check contracts",
    "New context",
  ]);
  view.rerender(
    <SlashMenu
      {...slashProps({
        agentName: "Operator",
        state: { kind: "list", groups: OPERATOR_ALL },
      })}
    />,
  );
  assertEquals(groups(view.container).map((group) => group.title), [
    "Commands",
    "Skills",
  ]);
});

Deno.test("shell/desktop#R45 [agent-I24]: Skills is one group with no origin badge and the Commands group has no Feedback", () => {
  using view = render(<SlashMenu {...slashProps()} />);
  const skills = one(view.container, "[data-slash-group][data-source=skill]");
  assertEquals(skills.querySelectorAll("[role=option]").length, 3);
  assertEquals(
    skills.querySelectorAll("[data-origin],[data-slash-origin]").length,
    0,
  );
  assert(!view.container.textContent!.includes("Feedback"));
});

Deno.test("shell/desktop#R45 [agent-I24]: typed letters are bold where they match and a group with no match is hidden", () => {
  using view = render(
    <SlashMenu
      {...slashProps({
        query: "co",
        state: { kind: "list", groups: LOPHN_CO },
      })}
    />,
  );
  assertEquals(groups(view.container), [
    { title: "Commands", labels: ["Compact", "Fork"] },
    { title: "Skills", labels: ["eval-metrics"] },
  ]);
  // 글자는 입력한 대소문자가 아니라 글에 있는 대로 굵게 한다.
  assertEquals(
    bold(one(rowOf(view.container, "compact"), "[data-slash-label]")),
    ["Co"],
  );
  assertEquals(
    bold(one(rowOf(view.container, "compact"), "[data-slash-description]")),
    ["co"],
  );
  assertEquals(bold(rowOf(view.container, "fork")), ["Co"]);
  assertEquals(
    bold(one(rowOf(view.container, "eval-metrics"), "[data-slash-label]")),
    [],
  );
  assertEquals(
    bold(
      one(rowOf(view.container, "eval-metrics"), "[data-slash-description]"),
    ),
    ["Co"],
  );
  // 굵은 글자를 빼도 글은 그대로 읽힌다.
  assertEquals(
    text(one(rowOf(view.container, "compact"), "[data-slash-label]")),
    "Compact",
  );
});

Deno.test("shell/desktop#R45 [agent-I24]: with no letters typed nothing is bold", () => {
  using view = render(<SlashMenu {...slashProps({ query: "" })} />);
  assertEquals(bold(view.container), []);
});

Deno.test("lophn-agent/commands#R8 [agent-I24]: while the agent works Fork is dimmed with a reason and cannot be picked, Compact still can", () => {
  const calls = slashCalls();
  using view = render(
    <SlashMenu
      {...slashProps({
        query: "co",
        working: true,
        state: { kind: "list", groups: LOPHN_CO },
      }, calls)}
    />,
  );
  const fork = rowOf(view.container, "fork");
  assertEquals(fork.getAttribute("aria-disabled"), "true");
  assertEquals(fork.hasAttribute("data-blocked"), true);
  assertEquals(
    text(one(fork, "[data-slash-reason]")),
    "Not while lophn is working",
  );
  click(fork);
  assertEquals(calls.picked, []);

  const compact = rowOf(view.container, "compact");
  assertEquals(compact.getAttribute("aria-disabled"), null);
  assertEquals(compact.hasAttribute("data-blocked"), false);
  assertEquals(compact.querySelector("[data-slash-reason]"), null);
  click(compact);
  assertEquals(calls.picked, [COMPACT]);
});

Deno.test("lophn-agent/commands#R8 [agent-I24]: when the agent is idle Fork is an ordinary row and the reason names the agent", () => {
  const calls = slashCalls();
  using view = render(
    <SlashMenu
      {...slashProps({
        query: "co",
        state: { kind: "list", groups: LOPHN_CO },
      }, calls)}
    />,
  );
  const fork = rowOf(view.container, "fork");
  assertEquals(fork.getAttribute("aria-disabled"), null);
  assertEquals(fork.querySelector("[data-slash-reason]"), null);
  click(fork);
  assertEquals(calls.picked, [FORK]);

  view.rerender(
    <SlashMenu
      {...slashProps({
        agentName: "Context Engineer",
        working: true,
        state: { kind: "list", groups: CONTEXT_ENGINEER_ALL },
      })}
    />,
  );
  assertEquals(
    text(one(rowOf(view.container, "fork"), "[data-slash-reason]")),
    "Not while Context Engineer is working",
  );
  assertEquals(
    view.container.querySelectorAll("[data-blocked]").length,
    1,
    "only Fork is blocked while working",
  );
});

Deno.test("lophn-agent/commands#R6 [agent-I24]: skills that share a name each show where they come from and the others show nothing", () => {
  const calls = slashCalls();
  using view = render(
    <SlashMenu
      {...slashProps({
        state: { kind: "list", groups: LOPHN_DUPLICATE_SKILLS },
      }, calls)}
    />,
  );
  const same = [...view.container.querySelectorAll(
    '[role=option][data-command="weekly-report"]',
  )];
  assertEquals(same.map((row) => row.getAttribute("data-origin")), [
    "place",
    "workspace",
  ]);
  const badges = same.map((row) => text(one(row, "[data-slash-origin]")));
  assert(badges[0] !== "" && badges[1] !== "" && badges[0] !== badges[1]);
  assertEquals(
    view.container.querySelectorAll("[data-slash-origin]").length,
    2,
  );
  assertEquals(
    rowOf(view.container, "eval-metrics").getAttribute("data-origin"),
    null,
  );
  click(same[1]);
  assertEquals(calls.picked, [WEEKLY_REPORT_WORKSPACE]);
});

Deno.test("shell/desktop#R45 [agent-I24]: the highlighted row follows the index over all rows from top to bottom", () => {
  using view = render(<SlashMenu {...slashProps({ highlightedIndex: 0 })} />);
  const selected = () =>
    [...view.container.querySelectorAll("[role=option]")].map((row) =>
      row.getAttribute("aria-selected") === "true"
    ).flatMap((on, index) => on ? [index] : []);
  assertEquals(selected(), [0]);
  view.rerender(<SlashMenu {...slashProps({ highlightedIndex: 8 })} />);
  assertEquals(selected(), [8]);
  assertEquals(
    rowOf(view.container, "new-app").getAttribute("aria-selected"),
    "true",
    "index 8 is the first row after the eight commands",
  );
});

Deno.test("shell/desktop#R45 [agent-I24]: nothing matching shows an empty line instead of an empty box", () => {
  using view = render(
    <SlashMenu
      {...slashProps({ query: "zzz", state: { kind: "list", groups: [] } })}
    />,
  );
  assertEquals(view.container.querySelectorAll("[role=option]").length, 0);
  assert(view.container.textContent!.includes("No commands match."));
});

Deno.test("lophn-agent/commands#R11 [agent-I24]: an unknown command is announced and offers nothing to pick", () => {
  const calls = slashCalls();
  using view = render(
    <SlashMenu
      {...slashProps({ state: { kind: "unknown", name: "compcat" } }, calls)}
    />,
  );
  assertEquals(
    text(one(view.container, "[role=status]")),
    "Unknown command: /compcat",
  );
  assertEquals(view.container.querySelectorAll("[role=option]").length, 0);
  assertEquals(calls.picked, []);
});

Deno.test("lophn-agent/commands#R6 [agent-I24]: submitting a name two skills share asks which one instead of running either", () => {
  const calls = slashCalls();
  using view = render(
    <SlashMenu
      {...slashProps({
        state: {
          kind: "choose_skill",
          name: "weekly-report",
          candidates: [WEEKLY_REPORT_PLACE, WEEKLY_REPORT_WORKSPACE],
        },
      }, calls)}
    />,
  );
  assert(
    text(one(view.container, "[data-slash-choose]")).includes("weekly-report"),
  );
  const rows = [...view.container.querySelectorAll("[role=option]")];
  assertEquals(rows.map((row) => row.getAttribute("data-origin")), [
    "place",
    "workspace",
  ]);
  assertEquals(calls.picked, [], "nothing runs until the person chooses");
  click(rows[0]);
  assertEquals(calls.picked, [WEEKLY_REPORT_PLACE]);
});
