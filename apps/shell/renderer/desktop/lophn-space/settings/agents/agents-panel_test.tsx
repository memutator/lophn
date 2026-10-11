import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../../packages/design/components/testing.ts";

import { find, flush } from "../../testdata/dom.ts";
import { buttonText } from "../testdata/field.ts";
import { AgentsPanel } from "./agents-panel.tsx";
import {
  ANTHROPIC,
  CATALOG,
  choice,
  fakeAgents,
  type FakeAgentsOptions,
  OPENAI,
  speedAxis,
  view,
  XAI,
} from "./testdata/fake-agents.ts";

const NEXT_RUN = "Changes apply to new work.";

async function open(options: FakeAgentsOptions = {}) {
  const fake = fakeAgents(options);
  const rendered = render(<AgentsPanel source={fake.source} />);
  await flush();
  return { fake, view: rendered };
}

function text(root: ParentNode, selector: string): string {
  return find(root, selector).textContent ?? "";
}

function attributes(root: ParentNode, selector: string, name: string) {
  return [...root.querySelectorAll(selector)].map((element) =>
    element.getAttribute(name) ?? ""
  );
}

function slot(root: ParentNode, name: string): HTMLElement {
  return find(root, `[data-slot='${name}']`);
}

function change(root: ParentNode, name: string): HTMLElement {
  click(find(slot(root, name), "[data-action='change']"));
  return find(root, `[data-editor='${name}']`);
}

function pick(editor: ParentNode, modelName: string): void {
  click(find(editor, `[role='option'][data-model-name='${modelName}']`));
}

function checked(editor: ParentNode, axis: string): string[] {
  return [...editor.querySelectorAll(
    `[role='radiogroup'][data-axis='${axis}'] [role='radio']`,
  )].filter((radio) => radio.getAttribute("aria-checked") === "true").map(
    (radio) => radio.getAttribute("data-value") ?? "",
  );
}

Deno.test("shell/desktop#R50 [agent-I30]: Agents는 Default models, Model for summaries, 모든 project의 LOPHN.md, Skills, MCP servers 순으로 보인다", async () => {
  const { view: rendered } = await open();
  using _ = rendered;
  assertEquals(
    [...rendered.container.querySelectorAll("h2")].map((h) => h.textContent),
    [
      "Default models",
      "Model for summaries",
      "Instructions for all projects",
      "Skills (all projects)",
      "MCP servers (all projects)",
    ],
  );
});

Deno.test("shell/desktop#R50, lophn-agent/harness/model#R8 [agent-I30]: Default models는 role 넷이 각자 provider·model과 option 값을 보이고 아직 고르지 않은 role은 Not chosen이다", async () => {
  const { view: rendered } = await open();
  using _ = rendered;
  assertEquals(
    attributes(rendered.container, "[data-slot]", "data-slot"),
    ["lophn", "context_engineer", "app_engineer", "operator", "summaries"],
  );
  const rows: [string, string, string, string | null][] = [
    ["lophn", "lophn", "Anthropic · claude-sonnet-5-5", "Effort: Medium"],
    [
      "context_engineer",
      "Context Engineer",
      "Anthropic · claude-opus-5-5",
      "Effort: High · Speed: Standard",
    ],
    ["app_engineer", "App Engineer", "OpenAI · gpt-6.1", "Effort: Medium"],
    ["operator", "Operators", "Not chosen", null],
    // option이 없다고 확인된 model은 option 줄이 없다.
    ["summaries", "Model for summaries", "OpenAI · gpt-6.1-mini", null],
  ];
  for (const [name, label, value, options] of rows) {
    const row = slot(rendered.container, name);
    assertEquals(text(row, "[data-slot-label]"), label, name);
    assertEquals(text(row, "[data-slot-value]"), value, name);
    if (options === null) {
      assertEquals(row.querySelector("[data-slot-options]"), null, name);
    } else {
      assertEquals(text(row, "[data-slot-options]"), options, name);
    }
    assertEquals(text(row, "[data-action='change']"), "Change", name);
  }
});

Deno.test("shell/desktop#R50 [agent-I30]: option의 이름과 값은 화면 코드가 아니라 catalog가 주는 말이다", async () => {
  const renamed = CATALOG.map((entry) =>
    entry.modelName === "claude-opus-5-5"
      ? {
        ...entry,
        options: [
          ...entry.options!.slice(0, 1),
          {
            ...speedAxis("Pace"),
            values: [
              { value: "standard", label: "Relaxed" },
              { value: "fast", label: "Quick" },
            ],
          },
        ],
      }
      : entry
  );
  const { view: rendered } = await open({ view: view({ catalog: renamed }) });
  using _ = rendered;
  assertEquals(
    text(slot(rendered.container, "context_engineer"), "[data-slot-options]"),
    "Effort: High · Pace: Relaxed",
  );
});

Deno.test("shell/desktop#R50 [agent-I30]: [Change]는 그 줄 아래에 연결된 provider의 model 목록을 열고 지금 model과 option 값이 골라져 있으며 editor는 하나만 열린다", async () => {
  const { view: rendered } = await open();
  using _ = rendered;
  assertEquals(rendered.container.querySelector("[data-editor]"), null);
  const editor = change(rendered.container, "context_engineer");
  assertEquals(
    [...editor.querySelectorAll("[role='option']")].map((option) =>
      option.textContent
    ),
    [
      "Anthropic · claude-sonnet-5-5",
      "Anthropic · claude-opus-5-5",
      "OpenAI · gpt-6.1",
      "OpenAI · gpt-6.1-mini",
      "xAI · grok-4.7",
    ],
  );
  assertEquals(
    attributes(
      editor,
      "[role='option'][aria-selected='true']",
      "data-model-name",
    ),
    ["claude-opus-5-5"],
  );
  assertEquals(
    attributes(editor, "[role='radiogroup']", "aria-label"),
    ["Effort", "Speed"],
  );
  assertEquals(checked(editor, "effort"), ["high"]);
  assertEquals(checked(editor, "speed"), ["standard"]);
  // 다른 줄의 [Change]를 누르면 앞의 editor는 닫힌다.
  change(rendered.container, "app_engineer");
  assertEquals(
    attributes(rendered.container, "[data-editor]", "data-editor"),
    ["app_engineer"],
  );
});

Deno.test("shell/desktop#R50, lophn-agent/harness/model#R21 [agent-I30]: 다른 model을 고르면 그 model의 축으로 바뀌어 기본값이 골라지고 option이 없거나 모르는 model은 그렇게 알린다", async () => {
  const { view: rendered } = await open();
  using _ = rendered;
  const editor = change(rendered.container, "lophn");
  assertEquals(checked(editor, "effort"), ["medium"]);
  pick(editor, "claude-opus-5-5");
  assertEquals(
    attributes(editor, "[role='radiogroup']", "data-axis"),
    ["effort", "speed"],
  );
  assertEquals(checked(editor, "effort"), ["high"]);
  assertEquals(checked(editor, "speed"), ["standard"]);
  pick(editor, "gpt-6.1-mini");
  assertEquals(editor.querySelectorAll("[role='radiogroup']").length, 0);
  assertEquals(text(editor, "[data-no-options]"), "No options for this model.");
  pick(editor, "grok-4.7");
  assertEquals(editor.querySelectorAll("[role='radiogroup']").length, 0);
  assertEquals(
    text(editor, "[data-options-unknown]"),
    "Options for this model aren't known yet.",
  );
});

Deno.test("shell/desktop#R50, platform/settings#R7 [agent-I30]: [Save]는 그 칸과 읽은 비교 기준으로 model과 고른 option 값을 한 번 보내고 줄이 새 값으로 바뀌며 다음 run부터라고 알린다", async () => {
  const { fake, view: rendered } = await open();
  using _ = rendered;
  const editor = change(rendered.container, "lophn");
  pick(editor, "claude-opus-5-5");
  click(
    find(
      editor,
      "[role='radiogroup'][data-axis='effort'] [data-value='maximum']",
    ),
  );
  assertEquals(checked(editor, "effort"), ["maximum"]);
  assertEquals(fake.calls, []);
  click(find(editor, "[data-action='save']"));
  await flush();
  assertEquals(fake.calls, [[
    "change",
    "lophn",
    choice(ANTHROPIC, "claude-opus-5-5", {
      effort: "maximum",
      speed: "standard",
    }),
    "7",
  ]]);
  assertEquals(rendered.container.querySelector("[data-editor]"), null);
  const row = slot(rendered.container, "lophn");
  assertEquals(text(row, "[data-slot-value]"), "Anthropic · claude-opus-5-5");
  assertEquals(
    text(row, "[data-slot-options]"),
    "Effort: Max · Speed: Standard",
  );
  assertEquals(text(rendered.container, "[data-note='next-run']"), NEXT_RUN);
  // 다른 칸은 그대로다.
  assertEquals(
    text(slot(rendered.container, "app_engineer"), "[data-slot-value]"),
    "OpenAI · gpt-6.1",
  );
});

Deno.test("shell/desktop#R50, lophn-agent/harness/model#R9 [agent-I30]: 비어 있는 칸은 model을 고를 때까지 [Save]가 꺼져 있고 option을 모르는 model은 option 값 없이 저장한다", async () => {
  const { fake, view: rendered } = await open();
  using _ = rendered;
  const editor = change(rendered.container, "operator");
  assertEquals(editor.querySelectorAll("[aria-selected='true']").length, 0);
  assertEquals(editor.querySelectorAll("[role='radiogroup']").length, 0);
  assertEquals(
    find(editor, "[data-action='save']").hasAttribute("disabled"),
    true,
  );
  pick(editor, "grok-4.7");
  assertEquals(
    find(editor, "[data-action='save']").hasAttribute("disabled"),
    false,
  );
  click(find(editor, "[data-action='save']"));
  await flush();
  assertEquals(fake.calls, [[
    "change",
    "operator",
    choice(XAI, "grok-4.7"),
    "7",
  ]]);
  assertEquals(
    text(slot(rendered.container, "operator"), "[data-slot-value]"),
    "xAI · grok-4.7",
  );
});

Deno.test("shell/desktop#R50 [agent-I30]: Model for summaries도 같은 [Change] editor로 바꾼다", async () => {
  const { fake, view: rendered } = await open();
  using _ = rendered;
  const editor = change(rendered.container, "summaries");
  pick(editor, "gpt-6.1");
  click(find(editor, "[data-action='save']"));
  await flush();
  assertEquals(fake.calls, [[
    "change",
    "summaries",
    choice(OPENAI, "gpt-6.1", { effort: "medium" }),
    "7",
  ]]);
});

Deno.test("shell/desktop#R50 [agent-I30]: [Cancel]은 아무것도 보내지 않고 editor를 닫으며 줄은 그대로다", async () => {
  const { fake, view: rendered } = await open();
  using _ = rendered;
  const editor = change(rendered.container, "lophn");
  pick(editor, "gpt-6.1");
  click(find(editor, "[data-action='cancel']"));
  assertEquals(rendered.container.querySelector("[data-editor]"), null);
  assertEquals(fake.calls, []);
  assertEquals(
    text(slot(rendered.container, "lophn"), "[data-slot-value]"),
    "Anthropic · claude-sonnet-5-5",
  );
});

Deno.test("shell/desktop#R50, platform/settings#R18 [agent-I30]: 그 사이 설정이 바뀌어 저장이 거절되면 최신 값을 다시 읽어 보이고 바뀌었다고 알린다", async () => {
  const { fake, view: rendered } = await open({
    failing: { change: "conflict" },
  });
  using _ = rendered;
  const editor = change(rendered.container, "lophn");
  pick(editor, "gpt-6.1");
  click(find(editor, "[data-action='save']"));
  await flush();
  assertEquals(fake.calls.length, 1);
  assertEquals(fake.counts.reads, 2);
  assertEquals(
    text(rendered.container, "[data-notice='stale']"),
    "This changed somewhere else. The latest is shown. Try again.",
  );
  assertEquals(
    text(slot(rendered.container, "lophn"), "[data-slot-value]"),
    "Anthropic · claude-sonnet-5-5",
  );
});

Deno.test("shell/desktop#R50, lophn-agent/instructions [agent-I30]: 모든 project의 LOPHN.md는 앞부분을 미리 보이고 [Edit]은 그 문서를 열 뿐이다", async () => {
  const { fake, view: rendered } = await open();
  using _ = rendered;
  const preview = text(rendered.container, "[data-instructions-preview]");
  assert(preview.startsWith("# About me\nI run the eval loop on my own."));
  assertEquals(
    rendered.container.querySelector("textarea, [contenteditable]"),
    null,
  );
  click(buttonText(rendered.container, "Edit"));
  await flush();
  assertEquals(fake.calls, [["instructions"]]);
});

Deno.test("shell/desktop#R50 [agent-I30]: 아직 LOPHN.md가 없으면 비었다고 보이고 [Edit]은 그대로 있다", async () => {
  const { view: rendered } = await open({
    view: view({ instructionsPreview: null }),
  });
  using _ = rendered;
  assertEquals(
    text(rendered.container, "[data-instructions-empty]"),
    "No instructions yet.",
  );
  assertEquals(
    rendered.container.querySelector("[data-instructions-preview]"),
    null,
  );
  buttonText(rendered.container, "Edit");
});

Deno.test("shell/desktop#R50 [agent-I30]: 전역 skill은 이름·설명·켬 스위치가 줄마다 있고 스위치와 [Add skill]은 각자 한 번 부른다", async () => {
  const { fake, view: rendered } = await open();
  using _ = rendered;
  const section = find(rendered.container, "[data-section='skills']");
  assertEquals(
    attributes(section, "[data-skill]", "data-skill"),
    ["plain-writing", "cite-documents", "meeting-notes"],
  );
  const row = find(section, "[data-skill='plain-writing']");
  assertEquals(
    text(row, "[data-extension-detail]"),
    "Keeps summaries short and in plain words.",
  );
  assertEquals(
    [...section.querySelectorAll("[role='switch']")].map((item) =>
      item.getAttribute("aria-checked")
    ),
    ["true", "true", "false"],
  );
  click(find(section, "[data-skill='meeting-notes'] [role='switch']"));
  await flush();
  assertEquals(fake.calls, [["skill", "meeting-notes", true]]);
  click(buttonText(section, "Add skill"));
  await flush();
  assertEquals(fake.calls[1], ["add-skill"]);
});

Deno.test("shell/desktop#R50 [agent-I30]: 전역 MCP server는 이름·설명·상태와 켬 스위치가 줄마다 있고 [Add server]는 한 번 부른다", async () => {
  const { fake, view: rendered } = await open();
  using _ = rendered;
  const section = find(rendered.container, "[data-section='servers']");
  assertEquals(
    attributes(section, "[data-server]", "data-server"),
    ["fetch", "mail", "calendar"],
  );
  assertEquals(
    [...section.querySelectorAll("[data-server-status]")].map((item) =>
      item.textContent
    ),
    ["Connected", "Needs sign-in", "Off"],
  );
  click(find(section, "[data-server='fetch'] [role='switch']"));
  await flush();
  assertEquals(fake.calls, [["server", "fetch", false]]);
  assertEquals(
    text(section, "[data-server='fetch'] [data-server-status]"),
    "Off",
  );
  click(buttonText(section, "Add server"));
  await flush();
  assertEquals(fake.calls[1], ["add-server"]);
});

Deno.test("shell/desktop#R50 [agent-I30]: skill이나 MCP server가 없으면 비었다고 보이고 더하는 단추는 그대로 있다", async () => {
  const { view: rendered } = await open({
    view: view({ skills: [], servers: [] }),
  });
  using _ = rendered;
  assertEquals(
    text(find(rendered.container, "[data-section='skills']"), "[data-empty]"),
    "No skills yet.",
  );
  assertEquals(
    text(find(rendered.container, "[data-section='servers']"), "[data-empty]"),
    "No MCP servers yet.",
  );
  buttonText(rendered.container, "Add skill");
  buttonText(rendered.container, "Add server");
});

Deno.test("shell/desktop#R50, shell/desktop#R7 [agent-I30]: 설정을 읽지 못하면 비어 있는 기본값이 아니라 읽지 못했다고 보이고 다시 읽으면 나온다", async () => {
  const failing: NonNullable<FakeAgentsOptions["failing"]> = {
    read: "unavailable",
  };
  const { view: rendered } = await open({ failing });
  using _ = rendered;
  find(rendered.container, "[data-state='error']");
  assertEquals(rendered.container.querySelectorAll("[data-slot]").length, 0);
  delete failing.read;
  click(buttonText(rendered.container, "Reload"));
  await flush();
  assertEquals(rendered.container.querySelectorAll("[data-slot]").length, 5);
});
