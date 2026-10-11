// agent-I23: Agent 탭의 composer. 입력칸 안 아래 줄, 입력칸 밖 자리·권한 줄, 일하는 중의 Stop과 select,
// context chip, `/` 메뉴 자리. model picker 안쪽은 model-picker_test가 본다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  one,
  press,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../../../../packages/design/components/testing.ts";

import { AgentComposer } from "./agent-composer.tsx";
import {
  composerCalls,
  composerProps,
  draftOf,
  VIOLATIONS_CHIP,
} from "../testdata/agent-composer.ts";

function before(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function text(element: Element): string {
  return element.textContent!.trim();
}

function write(textarea: HTMLElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function sendButton(root: ParentNode): HTMLButtonElement {
  return one(root, "[data-send]") as HTMLButtonElement;
}

Deno.test("shell/desktop#R43 [agent-I23]: inside the input box the bottom row holds the plus button, the model button and send in that order", () => {
  const calls = composerCalls();
  using view = render(
    <AgentComposer
      {...composerProps({ draft: draftOf("Summarize the notes") }, calls)}
    />,
  );
  const box = one(view.container, "[data-composer-box]");
  const row = one(box, "[data-composer-row]");
  const plus = one(row, "button[aria-label='Add attachment']");
  const model = one(row, "[data-model-button]");
  const send = one(row, "[data-send]");
  assert(before(plus, model) && before(model, send));
  assert(text(model).startsWith("Sonnet 5.5 · Medium"));
  assert(
    before(one(box, "[data-composer-input]"), row),
    "the row sits below the text",
  );
  click(plus);
  assertEquals(calls.attached, 1);
  click(send);
  assertEquals(calls.sent, ["request"]);
});

Deno.test("shell/desktop#R43 [agent-I23]: outside the input box a second line shows the place name and the permission summary, and there is no agent chooser", () => {
  const calls = composerCalls();
  using view = render(<AgentComposer {...composerProps({}, calls)} />);
  const box = one(view.container, "[data-composer-box]");
  const scope = one(view.container, "[data-composer-scope]");
  assert(!box.contains(scope), "the scope line is outside the input box");
  assert(before(box, scope), "and below it");
  const place = one(scope, "[data-place-kind]");
  assertEquals(place.getAttribute("data-place-kind"), "project");
  assertEquals(text(place), "phroner");
  const permissions = one(scope, "[data-composer-permissions]");
  assert(text(permissions).includes("Ask first, 1 edit allowed this session"));
  click(permissions);
  assertEquals(
    calls.permissions,
    1,
    "it goes to the Permissions of the Agents screen",
  );
  assertEquals(view.container.querySelectorAll("[role=combobox]").length, 0);
  assertEquals(
    view.container.querySelectorAll("[aria-label*='agent' i]").length,
    0,
  );
});

Deno.test("shell/desktop#R43 [agent-I23]: the permission summary and the place follow the props for an app", () => {
  using view = render(
    <AgentComposer
      {...composerProps({
        place: { kind: "app", name: "Expense tracker" },
        permissionSummary: "Edit documents, ask before anything else",
      })}
    />,
  );
  const scope = one(view.container, "[data-composer-scope]");
  assertEquals(
    one(scope, "[data-place-kind]").getAttribute("data-place-kind"),
    "app",
  );
  assertEquals(text(one(scope, "[data-place-kind]")), "Expense tracker");
  assert(
    text(one(scope, "[data-composer-permissions]")).includes(
      "Edit documents, ask before anything else",
    ),
  );
  view.rerender(
    <AgentComposer {...composerProps({ permissionSummary: "Ask first" })} />,
  );
  assert(
    text(one(view.container, "[data-composer-permissions]")).includes(
      "Ask first",
    ),
  );
});

Deno.test("shell/desktop#R43 [agent-I23]: while the agent works the send slot is Stop and a select picks Change this work or Next request", () => {
  const calls = composerCalls();
  using view = render(
    <AgentComposer
      {...composerProps(
        { working: true, draft: draftOf("Use March", "request") },
        calls,
      )}
    />,
  );
  const row = one(view.container, "[data-composer-row]");
  assertEquals(row.querySelector("[data-send]"), null);
  const stop = one(row, "[data-stop]");
  assert(text(stop).includes("Stop"));
  const mode = one(row, "[data-send-mode]");
  const trigger = one(mode, "[role=combobox]");
  assertEquals(text(trigger), "Next request");
  assert(before(mode, stop), "the select sits beside the send slot");
  click(stop);
  assertEquals(calls.stopped, 1);
  assertEquals(calls.sent, [], "Stop sends nothing");

  view.rerender(
    <AgentComposer
      {...composerProps({
        working: true,
        draft: draftOf("Use March", "correction"),
      })}
    />,
  );
  assertEquals(
    text(one(view.container, "[data-send-mode] [role=combobox]")),
    "Change this work",
  );
});

Deno.test("shell/desktop#R43 [agent-I23]: when the agent is idle there is no Stop and no select", () => {
  using view = render(
    <AgentComposer {...composerProps({ draft: draftOf("Hello") })} />,
  );
  assertEquals(view.container.querySelector("[data-stop]"), null);
  assertEquals(view.container.querySelector("[data-send-mode]"), null);
  assert(sendButton(view.container));
});

Deno.test("shell/desktop#R43 [agent-I23]: choosing in the select changes how the draft will be sent", async () => {
  const calls = composerCalls();
  const view = render(
    <AgentComposer
      {...composerProps(
        { working: true, draft: draftOf("Use March", "request") },
        calls,
      )}
    />,
  );
  const select = one(view.container, "[data-send-mode] [role=combobox]");
  focus(select);
  await pressAsync(select, "ArrowDown");
  const options = [...document.querySelectorAll("[role=option]")].map(text);
  assertEquals(options, ["Change this work", "Next request"]);
  await pressAsync(document.activeElement!, "ArrowUp");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(calls.drafts, [{ mode: "correction" }]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R43 [agent-I23]: Enter sends the draft by its mode while the agent works and Shift+Enter keeps writing", () => {
  const calls = composerCalls();
  using view = render(
    <AgentComposer
      {...composerProps(
        { working: true, draft: draftOf("Use March", "correction") },
        calls,
      )}
    />,
  );
  const input = one(view.container, "[data-composer-input]");
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assertEquals(calls.sent, []);
  press(input, "Enter");
  assertEquals(calls.sent, ["correction"]);
});

Deno.test("shell/desktop#R43 [agent-I23]: typing reports the text", () => {
  const calls = composerCalls();
  using view = render(<AgentComposer {...composerProps({}, calls)} />);
  write(one(view.container, "[data-composer-input]"), "Rename the file");
  assertEquals(calls.drafts.length, 1);
  assertEquals(calls.drafts[0].text, "Rename the file");
});

Deno.test("shell/desktop#R43 [agent-I23]: send needs text or a context chip and is off while offline, too long or locked", () => {
  using view = render(<AgentComposer {...composerProps()} />);
  assert(sendButton(view.container).disabled, "no text and no chip");
  view.rerender(
    <AgentComposer {...composerProps({ draft: draftOf("   ") })} />,
  );
  assert(sendButton(view.container).disabled, "blank text");
  view.rerender(
    <AgentComposer {...composerProps({ draft: draftOf("Go") })} />,
  );
  assert(!sendButton(view.container).disabled);
  for (
    const blocked of [{ offline: true }, { tooLong: true }, { locked: true }]
  ) {
    view.rerender(
      <AgentComposer
        {...composerProps({ draft: draftOf("Go"), ...blocked })}
      />,
    );
    assert(sendButton(view.container).disabled, JSON.stringify(blocked));
  }
});

Deno.test("shell/desktop#R43 [agent-I23]: context chips sit above the input and a first chip alone can be sent without text", () => {
  const calls = composerCalls();
  using view = render(
    <AgentComposer
      {...composerProps({ contexts: [VIOLATIONS_CHIP] }, calls)}
    />,
  );
  const chips = one(view.container, "[data-composer-contexts]");
  assert(before(chips, one(view.container, "[data-composer-input]")));
  assertEquals(
    text(one(chips, "[data-context-chip]")),
    "2 contract violations in eval-loop",
  );
  assertEquals(calls.sent, [], "nothing is sent until the person sends");
  assert(!sendButton(view.container).disabled, "the chip alone is enough");
  click(sendButton(view.container));
  assertEquals(calls.sent, ["request"]);
});

Deno.test("shell/desktop#R43 [agent-I23]: the chip's remove button takes the chip off and without text or chip send is off again", () => {
  const calls = composerCalls();
  using view = render(
    <AgentComposer
      {...composerProps({ contexts: [VIOLATIONS_CHIP] }, calls)}
    />,
  );
  click(one(view.container, "button[aria-label='Remove context']"));
  assertEquals(calls.removed, [VIOLATIONS_CHIP.id]);
  view.rerender(<AgentComposer {...composerProps({ contexts: [] }, calls)} />);
  assertEquals(view.container.querySelector("[data-composer-contexts]"), null);
  assert(sendButton(view.container).disabled);
  assertEquals(calls.sent, []);
});

Deno.test("shell/desktop#R45 [agent-I23]: the slash menu slot opens above the input box and is absent when closed", () => {
  using view = render(
    <AgentComposer
      {...composerProps({
        draft: draftOf("/"),
        slashMenu: <div data-slash-slot="">menu</div>,
      })}
    />,
  );
  const slot = one(view.container, "[data-slash-slot]");
  assert(before(slot, one(view.container, "[data-composer-box]")));
  view.rerender(
    <AgentComposer {...composerProps({ draft: draftOf("Hi") })} />,
  );
  assertEquals(view.container.querySelector("[data-slash-slot]"), null);
});

Deno.test("shell/desktop#R44 [agent-I23]: an open picker prop shows the picker panel under the model button", async () => {
  const view = render(
    <AgentComposer
      {...composerProps({
        picker: {
          ...composerProps().picker,
          open: true,
        },
      })}
    />,
  );
  await settle();
  assert(document.querySelector("[data-model-picker]"));
  await unmountSettled(view);
});
