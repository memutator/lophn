// agent-I28: project의 Agents 탭 본문. 카드(avatar·이름·종류·model·개수·[Open])와 [+ New Operator], 그 아래
// Instructions · Models for this project · Skills · MCP servers · Permissions 구역. 약속하는 DOM은 agents-tab.tsx의
// 머리 주석을 본다. Operator editor는 editor/agent-editor_test가 본다.
import { assert, assertEquals } from "@std/assert";
import { click, one, render } from "../../../../design/components/testing.ts";

import { AgentsTab } from "./agents-tab.tsx";
import {
  DIGEST_ID,
  ENGINEER_ID,
  LOPHN_ID,
  RELEASE_ID,
} from "./testdata/common.ts";
import { NO_OPERATORS, tabCalls, tabProps } from "./testdata/agents-tab.ts";

function text(element: Element): string {
  return element.textContent!.trim().replace(/\s+/g, " ");
}

/** 단추 글. 앞의 "+"는 icon이든 글자든 단추 이름이 아니다. */
function label(button: Element): string {
  return text(button).replace(/^\+\s*/, "");
}

function before(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function cards(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-agent-card]")];
}

function section(root: ParentNode, name: string): HTMLElement {
  return one(root, `section[data-section=${name}]`);
}

function buttonWithText(root: ParentNode, name: string): HTMLElement {
  const found = [...root.querySelectorAll("button")].find((button) =>
    label(button) === name
  );
  if (!found) throw new Error(`no button with text ${name}`);
  return found as HTMLElement;
}

/** Switch의 label이 가리키는 switch(Radix는 button role=switch)다. */
function switchOf(root: ParentNode, name: string): HTMLElement {
  const label = [...root.querySelectorAll("label")].find((item) =>
    text(item) === name
  );
  if (!label) throw new Error(`no switch labelled ${name}`);
  return document.getElementById(label.htmlFor)!;
}

Deno.test("shell/workspace#R36 [agent-I28]: with two Operators the cards are lophn, Context Engineer and then the Operators in that order, each with its name and kind", () => {
  using view = render(<AgentsTab {...tabProps()} />);
  const found = cards(view.container);
  assertEquals(
    found.map((card) => card.getAttribute("data-assignment")),
    [LOPHN_ID, ENGINEER_ID, RELEASE_ID, DIGEST_ID],
  );
  assertEquals(
    found.map((card) => text(one(card, "[data-agent-name]"))),
    ["lophn", "Context Engineer", "Release notes", "Weekly digest"],
  );
  assertEquals(
    found.map((card) => text(one(card, "[data-agent-kind]"))),
    ["Built in", "Built in", "Operator", "Operator"],
  );
  assertEquals(
    found.map((card) => card.getAttribute("data-role")),
    ["lophn", "context_engineer", "operator", "operator"],
  );
});

Deno.test("shell/workspace#R36 [agent-I28]: every card shows an avatar from the profile, icon or the uploaded image, and the model name", () => {
  using view = render(<AgentsTab {...tabProps()} />);
  const [lophn, engineer, release, digest] = cards(view.container);
  const icon = one(lophn, "[data-avatar]");
  assertEquals(icon.getAttribute("data-kind"), "icon");
  assertEquals(icon.getAttribute("data-icon"), "dock");
  assertEquals(
    one(engineer, "[data-avatar]").getAttribute("data-icon"),
    "contexts",
  );
  assertEquals(
    one(release, "[data-avatar]").getAttribute("data-icon"),
    "edit",
  );
  const image = one(digest, "[data-avatar]");
  assertEquals(image.getAttribute("data-kind"), "image");
  assertEquals(
    one(image, "img").getAttribute("src"),
    `lophn-agent://profiles/${DIGEST_ID}/avatar.png`,
  );
  assertEquals(
    [lophn, engineer, release, digest].map((card) =>
      text(one(card, "[data-agent-model]"))
    ),
    ["Sonnet 5.5", "Haiku 5.5", "Sonnet 5.5", "Sonnet 5.5"],
  );
});

Deno.test("shell/workspace#R36 [agent-I28]: an Operator card counts contexts, skills and MCP, and a built-in card leaves the contexts out", () => {
  using view = render(<AgentsTab {...tabProps()} />);
  const counts = cards(view.container).map((card) =>
    text(one(card, "[data-agent-counts]"))
  );
  assertEquals(counts, [
    "3 skills · 2 MCP",
    "3 skills · 2 MCP",
    "2 contexts · 3 skills · 2 MCP",
    "4 contexts · 2 skills · 3 MCP",
  ]);
});

Deno.test("shell/workspace#R36 [agent-I28]: no card has a schedule or a last-run line", () => {
  using view = render(<AgentsTab {...tabProps()} />);
  const all = text(view.container).toLowerCase();
  for (const word of ["schedule", "last run", "run now", "what it does"]) {
    assert(!all.includes(word), `the tab shows "${word}"`);
  }
});

Deno.test("shell/workspace#R36 [agent-I28]: with no Operator only the two built-in cards show and [+ New Operator] is below them", () => {
  const calls = tabCalls();
  using view = render(
    <AgentsTab {...tabProps({ agents: NO_OPERATORS }, calls)} />,
  );
  const found = cards(view.container);
  assertEquals(found.length, 2);
  const create = buttonWithText(view.container, "New Operator");
  assert(before(found[1], create), "[+ New Operator] comes after the cards");
  click(create);
  assertEquals(calls.newOperator, 1);
});

Deno.test("shell/workspace#R36 [agent-I28]: [Open] on a card gives that agent's assignment and role to the tab, which opens its editor in place", () => {
  const calls = tabCalls();
  using view = render(<AgentsTab {...tabProps({}, calls)} />);
  const [lophn, engineer, release] = cards(view.container);
  click(buttonWithText(release, "Open"));
  click(buttonWithText(lophn, "Open"));
  click(buttonWithText(engineer, "Open"));
  assertEquals(calls.opened, [
    [RELEASE_ID, "operator"],
    [LOPHN_ID, "lophn"],
    [ENGINEER_ID, "context_engineer"],
  ]);
});

Deno.test("shell/workspace#R37 [agent-I28]: below the cards come Instructions, Models for this project, Skills, MCP servers and Permissions in that order, and the stored-in-lophn line is last", () => {
  using view = render(<AgentsTab {...tabProps()} />);
  const sections = [
    ...view.container.querySelectorAll("section[data-section]"),
  ];
  assertEquals(
    sections.map((item) => text(one(item, "h2"))),
    [
      "Instructions",
      "Models for this project",
      "Skills",
      "MCP servers",
      "Permissions",
    ],
  );
  const cardsAndCreate = buttonWithText(view.container, "New Operator");
  assert(before(cardsAndCreate, sections[0]), "sections are below the cards");
  const note = one(view.container, "[data-stored-note]");
  assertEquals(
    text(note),
    "Agent definitions are stored in lophn, not in your project folder.",
  );
  assert(before(sections[sections.length - 1], note), "the line is last");
});

Deno.test("shell/workspace#R37 [agent-I28]: Instructions shows the first line of LOPHN.md with the shared-by line, and [Edit] asks to open the file", () => {
  const calls = tabCalls();
  using view = render(<AgentsTab {...tabProps({}, calls)} />);
  const instructions = section(view.container, "instructions");
  assert(
    text(instructions).includes("Shared by every agent in phroner"),
    "the shared-by line is missing",
  );
  assertEquals(
    text(one(instructions, "[data-instructions-preview]")),
    "# phroner",
  );
  assert(!text(instructions).includes("Answer in short paragraphs."));
  click(buttonWithText(instructions, "Edit"));
  assertEquals(calls.editInstructions, 1);
});

Deno.test("shell/workspace#R37 [agent-I28]: Models for this project has the four roles in order, and an empty row shows the Workspace default with its value", () => {
  using view = render(<AgentsTab {...tabProps()} />);
  const models = section(view.container, "models");
  const rows = [...models.querySelectorAll<HTMLElement>("[data-role-model]")];
  assertEquals(
    rows.map((row) => row.getAttribute("data-role")),
    ["lophn", "context_engineer", "app_engineer", "operator"],
  );
  assertEquals(
    rows.map((row) => text(one(row, "[data-role-label]"))),
    ["lophn", "Context Engineer", "App Engineer", "Operators"],
  );
  assertEquals(
    text(one(rows[0], "[data-role-model-line]")),
    "Use Workspace default (Sonnet 5.5 · Medium)",
  );
  assertEquals(
    text(one(rows[3], "[data-role-model-line]")),
    "Use Workspace default (Sonnet 5.5 · Medium)",
  );
  for (const row of rows) {
    assert(
      row.querySelector("[data-model-button]"),
      "every row has the model picker button",
    );
  }
});

Deno.test("shell/workspace#R37 [agent-I28]: a row the project filled shows the chosen model with overrides Workspace, and a button to go back to the Workspace default", () => {
  const calls = tabCalls();
  using view = render(<AgentsTab {...tabProps({}, calls)} />);
  const rows = [
    ...section(view.container, "models").querySelectorAll<HTMLElement>(
      "[data-role-model]",
    ),
  ];
  const engineer = rows[1];
  const line = text(one(engineer, "[data-role-model-line]"));
  assert(line.includes("Haiku 5.5"), line);
  assert(line.toLowerCase().includes("overrides workspace"), line);
  assert(!line.includes("Use Workspace default"), line);
  click(buttonWithText(engineer, "Use Workspace default"));
  assertEquals(calls.resetRoles, ["context_engineer"]);
  for (const row of [rows[0], rows[2], rows[3]]) {
    assert(
      ![...row.querySelectorAll("button")].some((button) =>
        text(button) === "Use Workspace default"
      ),
      "a row that follows the default has nothing to go back to",
    );
  }
});

Deno.test("shell/workspace#R37 [agent-I28]: Skills and MCP servers list the registered names as switches, and flipping one tells the tab the new state", () => {
  const calls = tabCalls();
  using view = render(<AgentsTab {...tabProps({}, calls)} />);
  const skills = section(view.container, "skills");
  assertEquals(
    [...skills.querySelectorAll("[role=switch]")].map((item) =>
      item.getAttribute("aria-checked")
    ),
    ["true", "false", "true"],
  );
  click(switchOf(skills, "release-checklist"));
  click(switchOf(skills, "summarize-notes"));
  assertEquals(calls.skills, [["release-checklist", true], [
    "summarize-notes",
    false,
  ]]);
  const servers = section(view.container, "mcp");
  assertEquals(
    [...servers.querySelectorAll("[role=switch]")].map((item) =>
      item.getAttribute("aria-checked")
    ),
    ["true", "false"],
  );
  click(switchOf(servers, "linear"));
  assertEquals(calls.mcp, [["linear", true]]);
});

Deno.test("shell/workspace#R37 [agent-I28]: [Add skill] and [Add server] are in their sections", () => {
  const calls = tabCalls();
  using view = render(<AgentsTab {...tabProps({}, calls)} />);
  click(buttonWithText(section(view.container, "skills"), "Add skill"));
  click(buttonWithText(section(view.container, "mcp"), "Add server"));
  assertEquals([calls.addSkill, calls.addServer], [1, 1]);
});

Deno.test("shell/workspace#R37 [agent-I28]: Permissions lists the project's rules as switches and a flip tells the tab the tool and the new state", () => {
  const calls = tabCalls();
  using view = render(<AgentsTab {...tabProps({}, calls)} />);
  const permissions = section(view.container, "permissions");
  assertEquals(
    [...permissions.querySelectorAll("label")].map(text),
    ["Read documents", "Edit documents", "Run app commands"],
  );
  assertEquals(
    [...permissions.querySelectorAll("[role=switch]")].map((item) =>
      item.getAttribute("aria-checked")
    ),
    ["true", "false", "false"],
  );
  click(switchOf(permissions, "Edit documents"));
  assertEquals(calls.permissions, [["documents.edit", true]]);
});
