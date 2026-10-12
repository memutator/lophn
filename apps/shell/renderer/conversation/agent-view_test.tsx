// agent-I33a: Agent 화면 하나가 부품을 묶어 한 agent의 한 session을 보이는 일. 읽기·머리·session 관리·
// 대화 줄·빈 session·읽기 실패·context track이 더한 것을 본다. 부품 안쪽(질문 카드의 선택, picker의 줄 등)은
// 부품 test가 보고, 여기서는 부품이 source와 맞물려 일하는지를 본다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  one,
  press,
  pressAsync,
  settle,
  unmountSettled,
} from "../../../../packages/design/components/testing.ts";

import {
  at,
  CONTEXT_ENGINEER,
  fakeAgentSource,
  finishedReport,
  LOPHN,
  messageId,
  NOW,
  say,
  SESSION_EARLIER,
  SESSION_WEEK,
  sessionId,
  workingReport,
} from "./testdata/fake-agent-source.ts";
import {
  all,
  before,
  buttonNamed,
  composerInput,
  connect,
  find,
  flush,
  mount,
  text,
  tick,
  write,
} from "./testdata/agent-view-harness.tsx";
import { VIOLATIONS_CHIP } from "./testdata/agent-composer.ts";
import { DraftStore } from "./drafts.ts";
import type { ThreadEntry } from "./agent-source.ts";

function weekFake() {
  const fake = fakeAgentSource({ sessions: [SESSION_WEEK, SESSION_EARLIER] });
  fake.state.threads[SESSION_WEEK.id] = finishedReport(fake);
  fake.state.threads[SESSION_EARLIER.id] = {
    entries: [say(fake, 31, "user", "Check the release notes.")],
    run: null,
    tasks: [],
    approval: null,
  };
  return fake;
}

function typeInto(input: HTMLElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openMore(root: ParentNode): Promise<void> {
  const more = one(root, '[aria-label="More"]');
  focus(more);
  await pressAsync(more, "Enter");
}

async function pickMore(index: number): Promise<void> {
  for (let step = 0; step < index; step += 1) {
    await pressAsync(document.activeElement!, "ArrowDown");
  }
  await pressAsync(document.activeElement!, "Enter");
}

Deno.test("shell/desktop#R37 shell/desktop#R38 [agent-I33a]: the view shows one agent's one session, with the agent name and session title in the header and no agent chooser", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = find(view.view.container, "[data-agent-view]");
  const header = find(root, "[data-agent-header]");
  assertEquals(find(header, "[data-avatar]").dataset.icon, "search");
  assertEquals(
    text(find(header, "[data-session-trigger]")),
    "lophn·Week 41 summary",
  );
  // the only select in the header is the view detail, which does not choose an agent
  assertEquals(
    all(header, "select, [role=combobox]").filter((element) =>
      !element.closest("[data-view-detail-select]")
    ).length,
    0,
  );
  // header, thread and composer stack in this order.
  const thread = find(root, "[data-thread]");
  const composer = find(root, "[data-agent-composer]");
  assert(before(header, thread) && before(thread, composer));
  assertEquals(
    all(root, "[data-agent-turn]").length,
    1,
    "the three agent items before the end of the run are one turn",
  );
  // no floating dock or overlay of its own
  assertEquals(document.body.querySelectorAll("[data-dock]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R38 [agent-I33a]: the agent's name comes from the source, not from fixed text", async () => {
  const fake = fakeAgentSource({
    agent: CONTEXT_ENGINEER,
    sessions: [{ ...SESSION_WEEK, assignment: CONTEXT_ENGINEER.assignment }],
  });
  fake.state.threads[SESSION_WEEK.id] = finishedReport(fake);
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assertEquals(
    text(find(root, "[data-session-trigger]")),
    "Context Engineer·Week 41 summary",
  );
  assertEquals(text(find(root, "[data-agent-name]")), "Context Engineer");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R40 shell/desktop#R41 [agent-I33a]: the thread shows my message on the right, then one agent turn with the tool line, the reply, the edit card and Worked for", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const mine = find(root, `[data-message="${messageId(1)}"]`);
  assertEquals(mine.dataset.actor, "user");
  assertEquals(mine.dataset.side, "end");
  assertEquals(
    text(mine).includes("Write this week's eval report from the new findings."),
    true,
  );
  assertEquals(mine.querySelector("[data-avatar]"), null);
  const turn = find(root, "[data-agent-turn]");
  assertEquals(text(find(turn, "[data-agent-name]")), "lophn");
  assertEquals(
    all(turn, "[data-turn-block], [data-message]").map((item) =>
      item.dataset.turnBlock ?? item.dataset.message
    ),
    [
      "tcl_01h455vb4pex5v6nkc6gd5f001",
      messageId(2),
      "edit-1",
      "end-1",
    ],
  );
  const tool = find(turn, "[data-tool-line] button");
  assertEquals(tool.getAttribute("aria-expanded"), "false");
  assert(text(tool).startsWith("Read 3 documents"));
  assertEquals(
    text(find(turn, `[data-message="${messageId(2)}"]`)),
    "I wrote the report from the three findings.",
  );
  assertEquals(
    text(find(turn, "[data-edit-summary]")),
    "Edited docs/reports/2026-w40.md +24 −3",
  );
  assertEquals(text(find(turn, "[data-worked-for]")), "Worked for 18s");
  // the time is the clock time of the turn's first item.
  assert(/^\d{1,2}:\d{2}\s?[AP]M$/.test(text(find(turn, "[data-turn-time]"))));
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R41 lophn-agent/revert#R19 [agent-RW3e]: the edit card's Open opens the document and Undo goes to the source with the session and the card, and an undone card has only Open", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const card = find(view.view.container, "[data-edit-card]");
  click(buttonNamed(card, "Open"));
  assertEquals(view.host.results, [["doc_01h455vb4pex5v6nkc6gd5f001", null]]);
  click(buttonNamed(card, "Undo"));
  await flush();
  assertEquals(fake.calls.undone, [
    { session: SESSION_WEEK.id, edit: "edit-1" },
  ]);
  // the source says the edit was undone: the card says so and offers nothing more than Open.
  const thread = fake.state.threads[SESSION_WEEK.id]!;
  fake.state.threads[SESSION_WEEK.id] = {
    ...thread,
    entries: thread.entries.map((entry) =>
      entry.kind === "edit"
        ? {
          ...entry,
          undone: true,
          undo: { can: false, reason: "already_reverted" },
        }
        : entry
    ),
  };
  await tick(view);
  const undone = find(view.view.container, "[data-edit-card]");
  assert(
    text(find(undone, "[data-edit-summary]")).startsWith("Undid the edit to"),
  );
  assertEquals(all(undone, "button").map(text), ["Open"]);
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/revert#R19 [agent-RW3e]: an edit that cannot be undone shows why on a disabled Undo", async () => {
  const fake = weekFake();
  const thread = fake.state.threads[SESSION_WEEK.id]!;
  fake.state.threads[SESSION_WEEK.id] = {
    ...thread,
    entries: thread.entries.map((entry) =>
      entry.kind === "edit"
        ? { ...entry, undo: { can: false, reason: "later_edit" } }
        : entry
    ),
  };
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const card = find(view.view.container, "[data-edit-card]");
  assert((buttonNamed(card, "Undo") as HTMLButtonElement).disabled);
  assertEquals(
    text(find(card, "[data-undo-reason]")),
    "A later edit changed the same file, so only that one can be undone first.",
  );
  click(buttonNamed(card, "Undo"));
  await flush();
  assertEquals(fake.calls.undone, []);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R42 [agent-I33a]: the view-detail select hides the tool lines in Messages and opens them in Everything while messages and cards stay", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const trigger = find(root, "[data-view-detail-select] button");
  assertEquals(text(trigger), "Compact");
  assertEquals(all(root, "[data-tool-line]").length, 1);
  assertEquals(all(root, "[data-tool-sub]").length, 0);

  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(
    text(find(root, "[data-view-detail-select] button")),
    "Everything",
  );
  assertEquals(all(root, "[data-tool-sub]").length, 3);

  const again = find(root, "[data-view-detail-select] button");
  focus(again);
  await pressAsync(again, "ArrowDown");
  await pressAsync(document.activeElement!, "ArrowUp");
  await pressAsync(document.activeElement!, "ArrowUp");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(
    text(find(root, "[data-view-detail-select] button")),
    "Messages",
  );
  assertEquals(all(root, "[data-tool-line]").length, 0);
  // an agent turn that only had tool lines would be left with a bare name, so none is drawn for them.
  assertEquals(all(root, "[data-agent-turn]").length, 1);
  assert(find(root, "[data-edit-card]"));
  assert(find(root, `[data-message="${messageId(2)}"]`));
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R39 [agent-I33a]: switching in the session popover reads that session and tells the tab, and the list only holds this agent's sessions", async () => {
  const fake = weekFake();
  fake.state.sessions.push({
    ...SESSION_EARLIER,
    id: sessionId(3),
    assignment: "asg_other",
    title: "Another agent's session",
  });
  const view = await mount({ fake, session: SESSION_WEEK.id });
  click(find(view.view.container, "[data-session-trigger]"));
  await settle();
  const box = find(document.body, "[data-session-popover]");
  assertEquals(
    all(box, "[role=option] [data-session-title]").map(text),
    ["Week 41 summary", "Release notes check"],
  );
  assertEquals(
    all(box, "[data-session-group]").map(text),
    ["Today", "Earlier"],
    "the groups follow the user's calendar day of the activity",
  );
  click(find(box, `[data-session="${SESSION_EARLIER.id}"]`));
  await flush();
  assertEquals(view.changes, [SESSION_EARLIER.id]);
  const root = view.view.container;
  assertEquals(
    text(find(root, "[data-session-trigger]")),
    "lophn·Release notes check",
  );
  assert(
    text(find(root, "[data-thread]")).includes("Check the release notes."),
  );
  assertEquals(all(root, "[data-edit-card]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R39 shell/desktop#R38 [agent-I33a]: Rename in the ⋯ menu and in the popover, and Archive, go to the source and the lists follow", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  await openMore(root);
  await pickMore(0);
  const input = find(root, "input[data-header-rename]") as HTMLInputElement;
  typeInto(input, "  Week 41 report ");
  press(input, "Enter");
  await flush();
  assertEquals(fake.calls.renamed, [[SESSION_WEEK.id, "Week 41 report"]]);
  assertEquals(
    text(find(root, "[data-session-trigger]")),
    "lophn·Week 41 report",
  );

  click(find(root, "[data-session-trigger]"));
  await settle();
  const box = find(document.body, "[data-session-popover]");
  click(
    buttonNamed(find(box, `[data-session="${SESSION_EARLIER.id}"]`), "Archive"),
  );
  await flush();
  assertEquals(fake.calls.archived, [SESSION_EARLIER.id]);
  assertEquals(all(box, "[role=option]").length, 1);
  assert(text(box).includes("Archived (1)"));
  click(buttonNamed(box, "Archived (1)"));
  click(buttonNamed(box, "Restore"));
  await flush();
  assertEquals(fake.calls.unarchived, [SESSION_EARLIER.id]);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R39 lophn-agent/conversation#R20 [agent-I33a]: Delete asks first, and deleting the session being read leaves the view on a new session", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  click(find(view.view.container, "[data-session-trigger]"));
  await settle();
  const box = find(document.body, "[data-session-popover]");
  click(
    buttonNamed(find(box, `[data-session="${SESSION_WEEK.id}"]`), "Delete"),
  );
  assertEquals(fake.calls.deleted, []);
  click(buttonNamed(find(box, "[role=alertdialog]"), "Delete"));
  await flush();
  assertEquals(fake.calls.deleted, [SESSION_WEEK.id]);
  assertEquals(view.changes, [null]);
  assert(find(view.view.container, "[data-empty-thread]"));
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R39 [agent-I33a]: a conflict from Delete (a run is still going) is told and the session stays", async () => {
  const fake = weekFake();
  fake.state.writeFails.deleted = "conflict";
  const view = await mount({ fake, session: SESSION_WEEK.id });
  click(find(view.view.container, "[data-session-trigger]"));
  await settle();
  const box = find(document.body, "[data-session-popover]");
  click(
    buttonNamed(find(box, `[data-session="${SESSION_WEEK.id}"]`), "Delete"),
  );
  click(buttonNamed(find(box, "[role=alertdialog]"), "Delete"));
  await flush();
  assertEquals(view.changes, []);
  assertEquals(
    find(view.view.container, "[data-problem]").dataset.problem,
    "action-failed",
  );
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R38 lophn-agent/conversation#R9 [agent-I33a]: Fork in the ⋯ menu copies up to the last message and hands the new session to the tab host", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  await openMore(view.view.container);
  await pickMore(1);
  await flush();
  assertEquals(fake.calls.forked.length, 1);
  const forked = fake.calls.forked[0]!;
  assertEquals([forked.session, forked.through], [SESSION_WEEK.id, null]);
  assert(forked.id.startsWith("ses_"));
  assertEquals(view.host.forked, [forked.id]);
  assertEquals(view.changes, [], "this tab stays on its own session");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R48 lophn-agent/revert#R15 [agent-RW3e]: Rewind to here opens the menu on that message and Rewind… in the header opens it on a chosen one; Fork from here still goes straight to the source, and a closed session has neither", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const mine = find(view.view.container, `[data-message="${messageId(1)}"]`);
  click(buttonNamed(mine, "Rewind to here"));
  await flush();
  // the button opens a menu; it does not rewind by itself.
  const dialog = find(document.body, "[role=dialog]");
  assertEquals(fake.calls.rewinds, []);
  assertEquals(dialog.querySelector("select"), null);
  const choice = [...dialog.querySelectorAll<HTMLElement>("[role=radio]")]
    .find((radio) => text(radio).startsWith("Restore messages only"))!;
  click(choice);
  await flush();
  assertEquals(fake.calls.previews, [{
    session: SESSION_WEEK.id,
    message: messageId(1),
    choice: "messages_only",
  }]);
  click(find(dialog, "[data-rewind-primary]"));
  await flush();
  assertEquals(fake.calls.rewinds, [{
    session: SESSION_WEEK.id,
    message: messageId(1),
    choice: "messages_only",
  }]);
  // the menu closed once the confirmation window was asked for.
  assertEquals(document.body.querySelector("[role=dialog]"), null);

  click(buttonNamed(mine, "Fork from here"));
  await flush();
  assertEquals(fake.calls.forked[0]!.through, messageId(1));
  assertEquals(view.host.forked, [fake.calls.forked[0]!.id]);

  await openMore(view.view.container);
  await pickMore(2);
  await flush();
  const header = find(document.body, "[role=dialog]");
  assertEquals(find(header, "select").tagName, "SELECT");
  click(find(header, "[data-rewind-cancel]"));
  await flush();
  assertEquals(fake.calls.rewinds.length, 1);

  fake.state.sessions = [{ ...SESSION_WEEK, closed: true }, SESSION_EARLIER];
  await tick(view);
  const closedMine = find(
    view.view.container,
    `[data-message="${messageId(1)}"]`,
  );
  assertEquals(closedMine.querySelectorAll("button").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R38 [agent-I33a]: Usage and Close tab are the host's, and Close tab leaves the session alone", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  await openMore(view.view.container);
  await pickMore(3);
  assertEquals(view.host.usage, 1);
  await openMore(view.view.container);
  await pickMore(4);
  assertEquals(view.host.closed, 1);
  assertEquals(fake.calls.deleted.concat(fake.calls.archived), []);
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/conversation#R8 [agent-I33a]: a closed session is read only, and a paused agent takes no new message", async () => {
  const fake = weekFake();
  fake.state.sessions = [{ ...SESSION_WEEK, closed: true }];
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assert(find(root, "[data-ended]"));
  assertEquals(all(root, "[data-agent-composer]").length, 0);
  await unmountSettled(view.view);

  const paused = weekFake();
  paused.state.agent = { ...LOPHN, state: "paused" };
  const second = await mount({ fake: paused, session: SESSION_WEEK.id });
  assert(find(second.view.container, "[data-paused]"));
  assertEquals(all(second.view.container, "[data-agent-composer]").length, 0);
  assert(
    text(find(second.view.container, "[data-thread]")).includes(
      "Write this week's eval report",
    ),
  );
  await unmountSettled(second.view);
});

Deno.test("shell/desktop#R43 lophn-agent/conversation#R16 [agent-I33a]: a session that does not exist yet shows an empty thread, the composer and the place, and nothing is created until I send", async () => {
  const fake = fakeAgentSource();
  const view = await mount({ fake, session: null });
  const root = view.view.container;
  assertEquals(
    text(find(root, "[data-empty-thread]")),
    "Nothing here yet. Write what you need below.",
  );
  assertEquals(
    text(find(root, "[data-session-trigger]")),
    "lophn·New session",
  );
  assertEquals(text(find(root, "[data-place-kind]")), "phroner");
  assertEquals(fake.calls.opened, []);
  assertEquals(find(root, "[data-send]").hasAttribute("disabled"), true);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R43 lophn-agent/conversation#R16 [agent-I33a]: the first message opens the session, sends into it, tells the tab, and the title follows the first words", async () => {
  const fake = fakeAgentSource();
  const view = await mount({ fake, session: null });
  const root = view.view.container;
  write(composerInput(root), "Write the weekly report");
  click(find(root, "[data-send]"));
  await flush();
  assertEquals(fake.calls.opened.length, 1);
  const opened = fake.calls.opened[0]!;
  assert(opened.id.startsWith("ses_"));
  assertEquals(opened.contexts, []);
  assertEquals(fake.calls.sent.length, 1);
  assertEquals(fake.calls.sent[0]!.session, opened.id);
  assertEquals(fake.calls.sent[0]!.text, "Write the weekly report");
  assertEquals(view.changes, [opened.id]);
  assertEquals(
    text(find(root, "[data-session-trigger]")),
    "lophn·Write the weekly report",
  );
  assertEquals(all(root, "[data-empty-thread]").length, 0);
  assertEquals(composerInput(root).value, "");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R43 shell/desktop#R35 [agent-I33a]: a session opened from an Ask has the event's chip, which sends without text, can be removed, and becomes the session's first context", async () => {
  const fake = fakeAgentSource({ agent: CONTEXT_ENGINEER });
  const view = await mount({
    fake,
    session: null,
    contextChips: [VIOLATIONS_CHIP],
  });
  const root = view.view.container;
  assertEquals(
    all(root, "[data-context-chip]").map(text),
    [VIOLATIONS_CHIP.label],
  );
  assertEquals(
    fake.calls.opened,
    [],
    "nothing is sent before the person sends",
  );
  assertEquals(fake.calls.sent, []);
  // a chip alone is enough to send
  const send = find(root, "[data-send]");
  assertEquals(send.hasAttribute("disabled"), false);

  // without the chip and without text there is nothing to send
  click(buttonNamed(find(root, "[data-context-chip]"), "Remove context"));
  assertEquals(all(root, "[data-context-chip]").length, 0);
  assertEquals(find(root, "[data-send]").hasAttribute("disabled"), true);
  await unmountSettled(view.view);

  const second = await mount({
    fake: fakeAgentSource({ agent: CONTEXT_ENGINEER }),
    session: null,
    contextChips: [VIOLATIONS_CHIP],
  });
  click(find(second.view.container, "[data-send]"));
  await flush();
  assertEquals(
    second.fake.calls.opened.map((item) => item.contexts),
    [[VIOLATIONS_CHIP]],
  );
  assertEquals(second.fake.calls.sent.length, 1);
  assert(second.fake.calls.sent[0]!.text.includes(VIOLATIONS_CHIP.label));
  assertEquals(
    all(second.view.container, "[data-context-chip]").length,
    0,
    "the chips are spent once the session exists",
  );
  await unmountSettled(second.view);
});

Deno.test("shell/desktop#R43 [agent-I33a]: a failure to open the session is told, keeps what I wrote, and sends nothing", async () => {
  const fake = fakeAgentSource();
  fake.state.writeFails.openSession = "conflict";
  const view = await mount({ fake, session: null });
  const root = view.view.container;
  write(composerInput(root), "Hello");
  click(find(root, "[data-send]"));
  await flush();
  assertEquals(find(root, "[data-problem]").dataset.problem, "open-failed");
  assertEquals(fake.calls.sent, []);
  assertEquals(composerInput(root).value, "Hello");
  assertEquals(view.changes, []);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R43 lophn-agent/conversation#R22 [agent-I33a]: the first-time hint from the host is the empty composer's placeholder while the session has no message, then the usual one", async () => {
  const hint =
    "Say what this context should cover. The Context Engineer will ask for whatever else it needs.";
  const fake = fakeAgentSource({ agent: CONTEXT_ENGINEER });
  const view = await mount({ fake, session: null, hint });
  assertEquals(composerInput(view.view.container).placeholder, hint);
  await unmountSettled(view.view);

  const used = weekFake();
  const second = await mount({ fake: used, session: SESSION_WEEK.id, hint });
  const placeholder = composerInput(second.view.container).placeholder;
  assert(placeholder !== hint && placeholder !== "");
  assert(
    placeholder.includes("lophn"),
    "the usual placeholder names the agent",
  );
  await unmountSettled(second.view);
});

Deno.test("shell/workspace#R31 lophn-agent/conversation#R4 [agent-I33a]: a context among the results of an answer is a link the host opens, named by the host", async () => {
  const fake = weekFake();
  const thread = fake.state.threads[SESSION_WEEK.id]!;
  fake.state.threads[SESSION_WEEK.id] = {
    ...thread,
    entries: thread.entries.map((entry) =>
      entry.kind === "message" && entry.actor === "agent"
        ? {
          ...entry,
          results: [
            { kind: "context", context: "ctx_01h455vb4pex5v6nkc6gd5f001" },
            { kind: "document", document: "doc_01h455vb4pex5v6nkc6gd5f001" },
          ],
        }
        : entry
    ),
  };
  fake.state.titles.doc_01h455vb4pex5v6nkc6gd5f001 = "Weekly report";
  const opened: string[] = [];
  const view = await mount({
    fake,
    session: SESSION_WEEK.id,
    contexts: {
      open: (context) => opened.push(context),
      titleOf: () => "eval",
    },
  });
  const links = find(view.view.container, "[data-results]");
  assertEquals(
    all(links, "button").map(text),
    ["eval", "Weekly report"],
  );
  click(find(links, "[data-result-context]"));
  assertEquals(opened, ["ctx_01h455vb4pex5v6nkc6gd5f001"]);
  click(find(links, "[data-result]"));
  assertEquals(view.host.results, [["doc_01h455vb4pex5v6nkc6gd5f001", null]]);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R8 [agent-I33a]: what I was writing and where I was reading stay when the view is closed and opened again", async () => {
  const fake = weekFake();
  const drafts = new DraftStore();
  const first = await mount({ fake, session: SESSION_WEEK.id, drafts });
  write(composerInput(first.view.container), "Half a thought");
  await unmountSettled(first.view);
  const second = await mount({ fake, session: SESSION_WEEK.id, drafts });
  assertEquals(composerInput(second.view.container).value, "Half a thought");
  // another session has its own draft
  fake.state.sessions.push({
    ...SESSION_EARLIER,
    id: sessionId(4),
    title: "Other",
  });
  const third = await mount({ fake, session: sessionId(4), drafts });
  assertEquals(composerInput(third.view.container).value, "");
  await unmountSettled(second.view);
  await unmountSettled(third.view);
});

Deno.test("shell/desktop#R7 [agent-I33a]: when the first read fails the view says so and Retry reads again", async () => {
  const fake = weekFake();
  fake.state.readsFail = true;
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const failed = find(root, "[data-load-failed]");
  assertEquals(text(failed), "Couldn't load this conversation. Try again.");
  assertEquals(all(root, "[data-agent-header]").length, 0);
  fake.state.readsFail = false;
  click(buttonNamed(failed, "Try again"));
  await flush();
  assertEquals(all(root, "[data-load-failed]").length, 0);
  assert(find(root, "[data-agent-header]"));
  assert(
    text(find(root, "[data-thread]")).includes("Write this week's eval report"),
  );
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R7 [agent-I33a]: when a later read fails the last content stays with when it was last checked, and the next good read clears the note", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assertEquals(all(root, "[data-stale]").length, 0);
  fake.state.readsFail = true;
  await tick(view);
  assertEquals(
    text(find(root, "[data-stale]")),
    "Couldn't check for new messages. Last checked now.",
  );
  assert(
    text(find(root, "[data-thread]")).includes("Write this week's eval report"),
  );
  fake.state.readsFail = false;
  await tick(view);
  assertEquals(all(root, "[data-stale]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R7 [agent-I33a]: while disconnected the content stays, the composer says it can't send, and sending is off", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "Hello again");
  await connect(view, { state: "stale", confirmedAt: NOW - 120_000 });
  assertEquals(
    text(find(root, "[data-agent-composer] p")),
    "You can send once lophn is connected again.",
  );
  assertEquals(find(root, "[data-send]").hasAttribute("disabled"), true);
  assert(find(root, "[data-stale]"));
  assertEquals(composerInput(root).value, "Hello again");
  await connect(view, { state: "ready", confirmedAt: NOW });
  assertEquals(find(root, "[data-send]").hasAttribute("disabled"), false);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R7 [agent-I33a]: a lost provider and an outside connection are one line each above the composer, with the action the line names", async () => {
  const fake = weekFake();
  fake.state.notices = [{ kind: "provider-lost" }];
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const lost = find(root, "[data-provider=unusable]");
  assert(text(lost).includes("can't reach its account"));
  click(buttonNamed(lost, "Connections"));
  assertEquals(view.host.connections, 1);

  fake.state.notices = [{
    kind: "external",
    state: "connection-failed",
    connection: "Anthropic",
    action: "check",
    retryAt: null,
  }];
  await tick(view);
  const external = find(root, "[data-external=connection-failed]");
  assertEquals(external.dataset.externalConnection, "Anthropic");
  assertEquals(external.dataset.externalAction, "check");
  // while a run is still going the harness retries, so a failure is not told yet.
  fake.state.threads[SESSION_WEEK.id] = {
    ...fake.state.threads[SESSION_WEEK.id]!,
    run: { id: "run_1", phase: "working" },
  };
  await tick(view);
  assertEquals(all(root, "[data-external]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R38 [agent-I33a]: when the session being read is gone the view goes back to a new session", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  fake.state.sessions = [SESSION_EARLIER];
  delete fake.state.threads[SESSION_WEEK.id];
  await tick(view);
  assertEquals(view.changes, [null]);
  assert(find(view.view.container, "[data-empty-thread]"));
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R40 [agent-I33a]: a message from another actor than the agent is not a bubble of mine and a machine fact stays on the agent side", async () => {
  const fake = weekFake();
  const thread = fake.state.threads[SESSION_WEEK.id]!;
  fake.state.threads[SESSION_WEEK.id] = {
    ...thread,
    entries: [
      ...thread.entries,
      say(fake, 9, "machine", "Checked: the report links 3 documents.", {
        at: at(-1),
      }),
    ],
  };
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const fact = find(view.view.container, `[data-message="${messageId(9)}"]`);
  assert(fact.closest("[data-agent-turn]"));
  assertEquals(fact.dataset.actor, "machine");
  assert(text(fact).includes("Checked: the report links 3 documents."));
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3e]: while work is going on the menu tells the person to stop it first and applies nothing", async () => {
  const fake = fakeAgentSource({ sessions: [SESSION_WEEK] });
  fake.state.threads[SESSION_WEEK.id] = workingReport(fake);
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const mine = find(view.view.container, `[data-message="${messageId(1)}"]`);
  click(buttonNamed(mine, "Rewind to here"));
  await flush();
  const dialog = find(document.body, "[role=dialog]");
  assertEquals(
    text(find(dialog, "[data-rewind-running]")),
    "Stop the work in progress first, then rewind.",
  );
  assert(
    (find(dialog, "[data-rewind-primary]") as HTMLButtonElement).disabled,
  );
  assertEquals(fake.calls.rewinds, []);
  await unmountSettled(view.view);
});

function hiddenThread(fake: ReturnType<typeof weekFake>, redo = true) {
  const before = say(fake, 1, "user", "Write the report.");
  const hiddenAsk = say(fake, 3, "user", "Use the short form.");
  const hiddenAnswer = say(fake, 4, "agent", "Done, short form.");
  const hidden: ThreadEntry = {
    kind: "hidden",
    id: "hidden-rvt_01k6q000000000000000000001",
    at: at(-3),
    revert: "rvt_01k6q000000000000000000001",
    checkpoint: messageId(3),
    choice: "restore_all",
    count: 2,
    restored: 1,
    left: [],
    redo,
    entries: [hiddenAsk, hiddenAnswer],
  };
  fake.state.threads[SESSION_WEEK.id] = {
    entries: [before, hidden],
    run: null,
    tasks: [],
    approval: null,
  };
}

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: the hidden range is one folded line; opening it shows the hidden messages read-only with no Rewind or Fork, and their bodies are read only then", async () => {
  const fake = weekFake();
  hiddenThread(fake);
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const row = find(root, "[data-hidden-range]");
  assertEquals(
    text(find(row, "[data-hidden-label]")),
    "Rewound here · 2 messages hidden",
  );
  assertEquals(root.querySelector(`[data-message="${messageId(3)}"]`), null);
  click(buttonNamed(row, "Show"));
  await flush();
  const shown = find(root, `[data-message="${messageId(3)}"]`);
  assertEquals(text(shown).includes("Use the short form."), true);
  // a hidden message cannot be chosen again.
  assertEquals(shown.querySelectorAll("button").length, 0);
  assertEquals(
    all(root, "button").filter((button) =>
      button.getAttribute("aria-label") === "Rewind to here"
    ).length,
    1,
  );
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: Redo on the hidden range goes to the source with the session and that rewind, and is gone once it cannot be redone", async () => {
  const fake = weekFake();
  hiddenThread(fake);
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const row = find(view.view.container, "[data-hidden-range]");
  click(buttonNamed(row, "Redo"));
  await flush();
  assertEquals(fake.calls.redone, [{
    session: SESSION_WEEK.id,
    revert: "rvt_01k6q000000000000000000001",
  }]);
  hiddenThread(fake, false);
  await tick(view);
  assertEquals(
    all(find(view.view.container, "[data-hidden-range]"), "button").map(text),
    ["Show"],
  );
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3e]: a rewind that appears while the view is open puts the chosen message back in the input; one that was already there and a draft already being written are left alone", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  assertEquals(composerInput(view.view.container).value, "");
  hiddenThread(fake);
  await tick(view);
  assertEquals(
    composerInput(view.view.container).value,
    "Use the short form.",
  );

  // the same rewind seen again does not overwrite what the person wrote since.
  write(composerInput(view.view.container), "Something else");
  await tick(view);
  assertEquals(composerInput(view.view.container).value, "Something else");
  await unmountSettled(view.view);

  // a view opened on a thread that already has the hidden range does not fill the input.
  const again = weekFake();
  hiddenThread(again);
  const opened = await mount({ fake: again, session: SESSION_WEEK.id });
  assertEquals(composerInput(opened.view.container).value, "");
  await unmountSettled(opened.view);

  // a draft being written is not replaced.
  const typed = weekFake();
  const draftView = await mount({ fake: typed, session: SESSION_WEEK.id });
  write(composerInput(draftView.view.container), "Half a sentence");
  hiddenThread(typed);
  await tick(draftView);
  assertEquals(
    composerInput(draftView.view.container).value,
    "Half a sentence",
  );
  await unmountSettled(draftView.view);
});
