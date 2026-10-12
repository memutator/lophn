// agent-I29: Operator editor(built-in의 [Open]도 같은 editor). 칸 순서, Profile·Name·Instructions 두 겹·Model 상속과
// Changed·Reset·Contexts·skill·MCP·권한, [Save]·[Cancel]·[Delete Operator]. 약속하는 DOM은 agent-editor.tsx의 머리 주석을
// 본다. Agents 탭 본문은 agents-tab_test가 본다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  one,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../../../../design/components/testing.ts";

import { AgentEditor } from "./agent-editor.tsx";
import {
  BODY,
  BUILT_IN_TEXT,
  editorCalls,
  editorProps,
  EVAL_LOOP,
  GLOSSARY,
  lophnProps,
  newOperatorProps,
  RELEASE_PLAN,
} from "./testdata/agent-editor.ts";
import {
  HAIKU_PLAIN,
  LOPHN_MD,
  PROJECT_PLACE,
  RELEASE_ID,
} from "../testdata/common.ts";
import {
  HAIKU,
  pickerProps,
  SONNET,
} from "../../../conversation/testdata/model-picker.ts";

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

function field(root: ParentNode, name: string): HTMLElement {
  return one(root, `[data-field=${name}]`);
}

function fieldNames(root: ParentNode): (string | null)[] {
  return [...root.querySelectorAll("[data-field]")].map((item) =>
    item.getAttribute("data-field")
  );
}

function buttonWithText(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((button) =>
    label(button) === name
  );
  if (!found) throw new Error(`no button with text ${name}`);
  return found as HTMLButtonElement;
}

function hasButton(root: ParentNode, name: string): boolean {
  return [...root.querySelectorAll("button")].some((button) =>
    label(button) === name
  );
}

/** Switch·Checkbox의 label이 가리키는 control(Radix는 button role=switch|checkbox)이다. */
function controlOf(root: ParentNode, name: string): HTMLElement {
  const label = [...root.querySelectorAll("label")].find((item) =>
    text(item) === name
  );
  if (!label) throw new Error(`no control labelled ${name}`);
  return document.getElementById(label.htmlFor)!;
}

function checked(control: Element): boolean {
  return control.getAttribute("aria-checked") === "true";
}

function write(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      target,
      value,
    );
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector("[role=dialog]");
}

Deno.test("shell/workspace#R38 [agent-I29]: an Operator editor has Profile, Name, Instructions, Model, Contexts, Skills, MCP servers and Permissions in that order, then Save and Cancel, and Delete Operator at the very bottom", () => {
  using view = render(<AgentEditor {...editorProps()} />);
  assertEquals(fieldNames(view.container), [
    "profile",
    "name",
    "instructions",
    "model",
    "contexts",
    "skills",
    "mcp",
    "permissions",
  ]);
  const save = buttonWithText(view.container, "Save");
  const cancel = buttonWithText(view.container, "Cancel");
  const remove = buttonWithText(view.container, "Delete Operator");
  assert(before(field(view.container, "permissions"), save));
  assert(before(save, cancel) && before(cancel, remove));
  assert(remove.querySelector("svg"), "Delete Operator has a trash icon");
});

Deno.test("shell/workspace#R38 [agent-I29]: the editor has no What it does, Schedule, Last run or output-document field", () => {
  using view = render(<AgentEditor {...editorProps()} />);
  const all = text(view.container).toLowerCase();
  for (
    const word of [
      "what it does",
      "schedule",
      "last run",
      "run now",
      "output document",
    ]
  ) {
    assert(!all.includes(word), `the editor shows "${word}"`);
  }
  assertEquals(
    view.container.querySelectorAll("textarea").length,
    1,
    "the only free text area is the agent's instructions",
  );
});

Deno.test("shell/workspace#R38 [agent-I29]: Save saves at once without a confirmation window and Cancel goes back to the list", async () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  click(buttonWithText(view.container, "Save"));
  await settle();
  assertEquals(calls.saved, 1);
  assertEquals(dialog(), null, "no confirmation for Save");
  click(buttonWithText(view.container, "Cancel"));
  assertEquals(calls.cancelled, 1);
  assertEquals(calls.saved, 1);
});

Deno.test("shell/workspace#R38 [agent-I29]: Delete Operator asks once and deletes only after the confirmation", async () => {
  const calls = editorCalls();
  const view = render(<AgentEditor {...editorProps({}, calls)} />);
  click(buttonWithText(view.container, "Delete Operator"));
  await settle();
  const asking = dialog();
  assert(asking, "a confirmation shows");
  assertEquals(calls.deleted, 0, "nothing is deleted before the answer");
  click(buttonWithText(asking, "Cancel"));
  await settle();
  assertEquals(dialog(), null);
  assertEquals(calls.deleted, 0, "cancelling the question keeps the Operator");
  click(buttonWithText(view.container, "Delete Operator"));
  await settle();
  click(buttonWithText(dialog()!, "Delete"));
  await settle();
  assertEquals(calls.deleted, 1);
  await unmountSettled(view);
});

Deno.test("shell/workspace#R38 [agent-I29]: a new Operator that is not saved yet has nothing to delete", () => {
  using view = render(<AgentEditor {...newOperatorProps()} />);
  assert(!hasButton(view.container, "Delete Operator"));
  assert(hasButton(view.container, "Save"));
});

Deno.test("shell/workspace#R38 [agent-I29]: Name is an input holding the name, and typing tells the tab the new text", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  const input = one(field(view.container, "name"), "input") as HTMLInputElement;
  assertEquals(input.value, "Release notes");
  write(input, "Release notes v2");
  assertEquals(calls.names, ["Release notes v2"]);
});

Deno.test("shell/workspace#R38 [agent-I29]: a refused field shows the reason code in its own field", () => {
  using view = render(
    <AgentEditor
      {...editorProps({
        issues: [
          { field: "name", code: "reserved_name" },
          { field: "contexts.1", code: "missing_reference" },
        ],
      })}
    />,
  );
  assertEquals(
    field(view.container, "name").querySelector("[data-issue]")
      ?.getAttribute("data-issue"),
    "reserved_name",
  );
  assertEquals(
    field(view.container, "contexts").querySelector("[data-issue]")
      ?.getAttribute("data-issue"),
    "missing_reference",
  );
  assertEquals(
    field(view.container, "model").querySelector("[data-issue]"),
    null,
    "a field without a problem shows none",
  );
});

Deno.test("shell/workspace#R39 [agent-I29]: Profile shows a large avatar preview and the icon grid in the order given, with the current icon pressed", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  const profile = field(view.container, "profile");
  const preview = one(profile, "[data-avatar]");
  assertEquals(preview.getAttribute("data-size"), "lg");
  assertEquals(preview.getAttribute("data-icon"), "edit");
  const options = [
    ...profile.querySelectorAll<HTMLElement>("[data-icon-option]"),
  ];
  assertEquals(
    options.map((item) => item.getAttribute("data-icon-option")),
    ["dock", "roles", "contexts", "edit", "terminal"],
  );
  assertEquals(
    options.map((item) => item.getAttribute("aria-pressed")),
    ["false", "false", "false", "true", "false"],
  );
  assertEquals(options[0].getAttribute("aria-label"), "Chat");
  click(options[4]);
  assertEquals(calls.icons, ["terminal"]);
});

Deno.test("shell/workspace#R39 [agent-I29]: an uploaded image is the preview and no icon is pressed until one is picked again", () => {
  using view = render(
    <AgentEditor
      {...editorProps({
        definition: {
          ...editorProps().definition,
          profile: { kind: "image", image: "avatar.png" },
        },
      })}
    />,
  );
  const profile = field(view.container, "profile");
  const preview = one(profile, "[data-avatar]");
  assertEquals(preview.getAttribute("data-kind"), "image");
  assertEquals(
    one(preview, "img").getAttribute("src"),
    `lophn-agent://profiles/${RELEASE_ID}/avatar.png`,
  );
  for (const item of profile.querySelectorAll("[data-icon-option]")) {
    assertEquals(item.getAttribute("aria-pressed"), "false");
  }
});

Deno.test("shell/workspace#R39 [agent-I29]: Upload image takes png, jpeg and webp and gives the chosen file to the tab", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  const profile = field(view.container, "profile");
  assert(!buttonWithText(profile, "Upload image").disabled);
  assert(
    !text(profile).includes("Save first to upload an image"),
    "a saved agent can take an image",
  );
  const input = one(profile, "input[type=file]") as HTMLInputElement;
  assertEquals(
    input.accept.split(",").map((type) => type.trim()).sort(),
    ["image/jpeg", "image/png", "image/webp"],
  );
  const file = new File(["x"], "me.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assertEquals(calls.uploads, [file]);
});

Deno.test("shell/workspace#R39 [agent-I29]: a new Operator can only pick an icon, and Upload image waits for the first save", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...newOperatorProps({}, calls)} />);
  const profile = field(view.container, "profile");
  assert(buttonWithText(profile, "Upload image").disabled);
  assert(text(profile).includes("Save first to upload an image"));
  click(one(profile, "[data-icon-option=terminal]"));
  assertEquals(calls.icons, ["terminal"]);
});

Deno.test("shell/workspace#R40 [agent-I29]: Instructions shows the read-only project block above the agent's own editor, with the first four lines of LOPHN.md", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  const instructions = field(view.container, "instructions");
  const block = one(instructions, "[data-project-instructions]");
  assert(
    text(block).includes(
      "Project instructions · LOPHN.md — shared by every agent in phroner",
    ),
    text(block),
  );
  assertEquals(
    one(block, "[data-project-instructions-body]").textContent,
    LOPHN_MD.split("\n").slice(0, 4).join("\n"),
  );
  assertEquals(block.querySelector("textarea, input"), null, "read only");
  const textarea = one(instructions, "textarea") as HTMLTextAreaElement;
  assert(before(block, textarea), "the project block is above");
  click(buttonWithText(block, "Edit LOPHN.md"));
  assertEquals(calls.editProject, 1);
  assert(
    text(instructions).includes(
      "The agent reads project instructions first, then these.",
    ),
  );
});

Deno.test("shell/workspace#R40 [agent-I29]: the agent's own instructions are the editable text and typing tells the tab the new body", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  const textarea = one(
    field(view.container, "instructions"),
    "textarea",
  ) as HTMLTextAreaElement;
  assertEquals(textarea.value, BODY);
  write(textarea, `${BODY} Keep it short.`);
  assertEquals(calls.instructions, [`${BODY} Keep it short.`]);
});

Deno.test("shell/workspace#R41 [agent-I29]: with no model of its own the Model field shows the inherited model and where it comes from, with no Changed or Reset", () => {
  using view = render(<AgentEditor {...editorProps()} />);
  const model = field(view.container, "model");
  assertEquals(
    text(one(model, "[data-model-inherit]")),
    "Use project default — Sonnet 5.5 · Medium (from Workspace)",
  );
  assertEquals(model.querySelector("[data-model-changed]"), null);
  assert(!hasButton(model, "Reset"));
  assert(model.querySelector("[data-model-button]"), "the picker button");
  assert(
    text(model).includes(
      "Only the fields you change are saved; the rest follow project and Workspace defaults.",
    ),
  );
});

Deno.test("shell/workspace#R41 [agent-I29]: the inherited model names the project when the project chose it", () => {
  const effective = editorProps().effective;
  using view = render(
    <AgentEditor
      {...editorProps({
        effective: {
          ...effective,
          model: {
            value: HAIKU_PLAIN,
            source: { layer: "place", place: PROJECT_PLACE },
          },
        },
      })}
    />,
  );
  assertEquals(
    text(one(field(view.container, "model"), "[data-model-inherit]")),
    "Use project default — Haiku 5.5 (from project)",
  );
});

Deno.test("shell/workspace#R41 [agent-I29]: a chosen model shows Changed and Reset, and Reset asks to go back to inheriting", () => {
  const calls = editorCalls();
  using view = render(
    <AgentEditor
      {...editorProps({
        definition: { ...editorProps().definition, model: HAIKU_PLAIN },
        picker: pickerProps({ open: false, scenario: HAIKU }),
      }, calls)}
    />,
  );
  const model = field(view.container, "model");
  assertEquals(text(one(model, "[data-model-changed]")), "Changed");
  assertEquals(model.querySelector("[data-model-inherit]"), null);
  assert(text(one(model, "[data-model-button]")).startsWith("Haiku 5.5"));
  click(buttonWithText(model, "Reset"));
  assertEquals(calls.resetModel, 1);
});

Deno.test("shell/workspace#R41 [agent-I29]: the opened picker shows only the option axes the chosen model has", async () => {
  const withEffort = render(
    <AgentEditor
      {...editorProps({
        definition: { ...editorProps().definition, model: HAIKU_PLAIN },
        picker: pickerProps({ open: true, scenario: SONNET }),
      })}
    />,
  );
  await settle();
  assert(
    document.querySelector("[data-picker-section=axes] [aria-label=Effort]"),
  );
  await unmountSettled(withEffort);
  const without = render(
    <AgentEditor
      {...editorProps({
        definition: { ...editorProps().definition, model: HAIKU_PLAIN },
        picker: pickerProps({ open: true, scenario: HAIKU }),
      })}
    />,
  );
  await settle();
  assertEquals(
    document.querySelector("[data-picker-section=axes] [aria-label=Effort]"),
    null,
  );
  await unmountSettled(without);
});

Deno.test("shell/workspace#R42 [agent-I29]: Contexts shows a chip for each attached context in the order attached, and its x takes that one off", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  const contexts = field(view.container, "contexts");
  const chips = [...contexts.querySelectorAll<HTMLElement>("[data-context]")];
  assertEquals(
    chips.map((chip) => chip.getAttribute("data-context")),
    [EVAL_LOOP, RELEASE_PLAN],
  );
  assertEquals(chips.map(text).map((value) => value.replace("✕", "").trim()), [
    "Eval loop",
    "Release plan",
  ]);
  click(one(chips[1], "button"));
  assertEquals(calls.removedContexts, [RELEASE_PLAN]);
  assert(
    !text(contexts).includes("No contexts."),
    "the zero-contexts line is only for zero",
  );
});

Deno.test("shell/workspace#R42 [agent-I29]: Add context offers only the project contexts not attached yet and attaches the one picked", async () => {
  const calls = editorCalls();
  const view = render(<AgentEditor {...editorProps({}, calls)} />);
  const trigger = buttonWithText(
    field(view.container, "contexts"),
    "Add context",
  );
  focus(trigger);
  await pressAsync(trigger, "Enter");
  const items = [...document.querySelectorAll("[role=menuitem]")];
  assertEquals(items.map(text), ["Glossary"]);
  click(items[0]);
  await settle();
  assertEquals(calls.addedContexts, [GLOSSARY]);
  await unmountSettled(view);
});

Deno.test("shell/workspace#R42 [agent-I29]: with no context the field says so and Add context is still there", () => {
  using view = render(<AgentEditor {...newOperatorProps()} />);
  const contexts = field(view.container, "contexts");
  assert(
    text(contexts).includes(
      "No contexts. This operator works with project documents only.",
    ),
  );
  assertEquals(contexts.querySelectorAll("[data-context]").length, 0);
  assert(hasButton(contexts, "Add context"));
});

Deno.test("shell/workspace#R43 [agent-I29]: Skills and MCP servers list everything the project has, off only for what the definition turned off, and a flip gives the new state", () => {
  const calls = editorCalls();
  using view = render(
    <AgentEditor
      {...editorProps({
        definition: {
          ...editorProps().definition,
          mcp_off: [{ server_name: "linear" }],
        },
      }, calls)}
    />,
  );
  const skills = field(view.container, "skills");
  assertEquals(
    [...skills.querySelectorAll("label")].map(text),
    ["summarize-notes", "release-checklist", "weekly-report"],
  );
  assertEquals(
    [...skills.querySelectorAll("[role=switch]")].map(checked),
    [true, false, true],
  );
  click(controlOf(skills, "release-checklist"));
  click(controlOf(skills, "weekly-report"));
  assertEquals(calls.skills, [["release-checklist", true], [
    "weekly-report",
    false,
  ]]);
  const servers = field(view.container, "mcp");
  assertEquals(
    [...servers.querySelectorAll("[role=switch]")].map(checked),
    [true, false],
  );
  click(controlOf(servers, "github"));
  assertEquals(calls.mcp, [["github", false]]);
});

Deno.test("shell/workspace#R43 [agent-I29]: a new Operator starts with every skill and MCP server on", () => {
  using view = render(<AgentEditor {...newOperatorProps()} />);
  for (const name of ["skills", "mcp"]) {
    const switches = [
      ...field(view.container, name).querySelectorAll("[role=switch]"),
    ];
    assert(switches.length > 0);
    assert(switches.every(checked), `${name} are all on`);
  }
});

Deno.test("shell/workspace#R43 [agent-I29]: Permissions says it can't be wider than the project's and does not let a wider choice be picked", () => {
  const calls = editorCalls();
  using view = render(<AgentEditor {...editorProps({}, calls)} />);
  const permissions = field(view.container, "permissions");
  assert(
    text(permissions).includes(
      "Can't be wider than the project's permissions.",
    ),
  );
  assertEquals(
    [...permissions.querySelectorAll("label")].map(text),
    ["Read documents", "Edit documents", "Run app commands"],
  );
  assertEquals(
    [...permissions.querySelectorAll("[role=checkbox]")].map(checked),
    [true, false, false],
  );
  const wider = controlOf(permissions, "Run app commands");
  assert(wider.hasAttribute("disabled"), "wider than the project is disabled");
  click(wider);
  assertEquals(calls.permissions, [], "a wider choice gives nothing");
  click(controlOf(permissions, "Edit documents"));
  click(controlOf(permissions, "Read documents"));
  assertEquals(calls.permissions, [["documents.edit", true], [
    "documents.read",
    false,
  ]]);
});

Deno.test("shell/workspace#R44 [agent-I29]: a built-in editor shows the name as fixed text and has no Contexts field and no Delete", () => {
  using view = render(<AgentEditor {...lophnProps()} />);
  assertEquals(fieldNames(view.container), [
    "profile",
    "name",
    "instructions",
    "model",
    "skills",
    "mcp",
    "permissions",
  ]);
  const name = field(view.container, "name");
  assertEquals(name.querySelector("input"), null);
  assertEquals(text(one(name, "[data-fixed-name]")), "lophn");
  assert(!hasButton(view.container, "Delete Operator"));
  assert(!text(view.container).includes("Delete"));
  assert(hasButton(view.container, "Save"));
});

Deno.test("shell/workspace#R44 [agent-I29]: a built-in editor's Instructions has the project block, then a closed Built-in instructions line, then the person's own editor", () => {
  using view = render(<AgentEditor {...lophnProps()} />);
  const instructions = field(view.container, "instructions");
  const block = one(instructions, "[data-project-instructions]");
  const line = buttonWithText(
    instructions,
    "Built-in instructions (read only)",
  );
  const textarea = one(instructions, "textarea") as HTMLTextAreaElement;
  assert(before(block, line) && before(line, textarea));
  assertEquals(line.getAttribute("aria-expanded"), "false");
  assert(!text(instructions).includes(BUILT_IN_TEXT), "folded");
  click(line);
  assertEquals(line.getAttribute("aria-expanded"), "true");
  assert(text(instructions).includes(BUILT_IN_TEXT));
  assertEquals(textarea.value, "Always name the document you answer from.");
  assert(
    !textarea.readOnly && !textarea.disabled,
    "the person's part is editable",
  );
});

Deno.test("shell/workspace#R44 [agent-I29]: an Operator editor has no Built-in instructions line", () => {
  using view = render(<AgentEditor {...editorProps()} />);
  assert(!hasButton(view.container, "Built-in instructions (read only)"));
  assert(!text(view.container).includes("Built-in instructions"));
});
