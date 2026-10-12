// agent-I33a: Agent 화면의 composer 쪽. 보내기와 전달 상태, 일하는 중의 Stop·수정, model 선택, `/` 명령.
// 부품 안쪽은 부품 test가 보고 여기서는 부품과 source가 맞물려 일하는지를 본다.
import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  isFocused,
  press,
  pressAsync,
  settle,
  unmountSettled,
} from "../../../../packages/design/components/testing.ts";

import {
  at,
  fakeAgentSource,
  finishedReport,
  messageId,
  runId,
  say,
  SESSION_WEEK,
  workingReport,
} from "./testdata/fake-agent-source.ts";
import {
  all,
  buttonNamed,
  composerInput,
  find,
  flush,
  mount,
  text,
  tick,
  write,
} from "./testdata/agent-view-harness.tsx";
import { SOL } from "./testdata/model-picker.ts";
import { LOPHN_DUPLICATE_SKILLS } from "./testdata/slash-menu.ts";
import { TASKS } from "./testdata/activity.ts";
import { barBlock, DOC, VER } from "../workspace/visuals/testdata/blocks.ts";
import { MESSAGE_TEXT_MAX_BYTES } from "./delivery-state.ts";

function weekFake() {
  const fake = fakeAgentSource({ sessions: [SESSION_WEEK] });
  fake.state.threads[SESSION_WEEK.id] = finishedReport(fake);
  return fake;
}

function workingFake() {
  const fake = fakeAgentSource({ sessions: [SESSION_WEEK] });
  fake.state.threads[SESSION_WEEK.id] = workingReport(fake);
  return fake;
}

Deno.test("shell/desktop#R43 lophn-agent/conversation#R3 [agent-I33a]: sending shows my message at once, then received, and the answer arrives with the progress and Worked for", async () => {
  const fake = weekFake();
  let release!: () => void;
  fake.state.gate = new Promise<void>((resolve) => release = resolve);
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "Now add the regressions");
  click(find(root, "[data-send]"));
  await flush();

  // being sent: a provisional bubble, and the box is locked so the same words are not sent twice
  assertEquals(fake.calls.sent.length, 1);
  const sent = fake.calls.sent[0]!;
  assertEquals(sent.session, SESSION_WEEK.id);
  assertEquals(sent.text, "Now add the regressions");
  assertEquals(sent.mode, "request");
  assertEquals(sent.run, null);
  assertEquals(sent.key, `messages-receive-${sent.id}`);
  const bubble = find(root, `[data-message="${sent.id}"]`);
  assertEquals(text(bubble).includes("Now add the regressions"), true);
  assertEquals(find(bubble, "[data-delivery]").dataset.delivery, "sending");
  assertEquals(text(find(bubble, "[data-delivery]")), "Sending");
  assert(find(bubble, "[data-provisional]"));
  assertEquals(composerInput(root).readOnly, true);

  release();
  await flush();
  // accepted: the confirmed message replaces the provisional one, the box is empty again
  const confirmed = find(root, `[data-message="${sent.id}"]`);
  assertEquals(all(confirmed, "[data-provisional]").length, 0);
  assertEquals(text(find(confirmed, "[data-delivery]")), "Received");
  assertEquals(composerInput(root).value, "");
  assertEquals(composerInput(root).readOnly, false);
  // the run is working: Stop replaces send
  assertEquals(all(root, "[data-send]").length, 0);
  assert(find(root, "[data-stop]"));

  // progress: the Tasks chip in the header
  const working = fake.state.threads[SESSION_WEEK.id]!;
  fake.state.threads[SESSION_WEEK.id] = { ...working, tasks: TASKS };
  await tick(view);
  assertEquals(text(find(root, '[aria-label="Tasks"]')), "2/4");

  // the answer: tool line, reply, then the end of the run
  const run = working.run!.id;
  fake.state.threads[SESSION_WEEK.id] = {
    ...working,
    tasks: [],
    run: { id: run, phase: "ended" },
    entries: [
      ...working.entries.map((entry) =>
        entry.kind === "message" && entry.id === sent.id
          ? { ...entry, applied: true }
          : entry
      ),
      say(fake, 40, "agent", "I added the regressions section.", {
        at: at(5),
        run: { id: run, ended: true },
      }),
      {
        kind: "run-end",
        id: "end-2",
        at: at(6),
        outcome: "completed",
        durationMs: 75_000,
      },
    ],
  };
  await tick(view);
  assertEquals(all(root, '[aria-label="Tasks"]').length, 0);
  assertEquals(
    text(find(root, `[data-message="${messageId(40)}"]`)),
    "I added the regressions section.",
  );
  const ends = all(root, "[data-worked-for]").map(text);
  assertEquals(ends, ["Worked for 18s", "Worked for 1m 15s"]);
  assertEquals(
    text(find(find(root, `[data-message="${sent.id}"]`), "[data-delivery]")),
    "Taken into account",
  );
  assert(find(root, "[data-send]"));
  assertEquals(all(root, "[data-stop]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R43 [agent-I33a]: Enter sends and Shift+Enter does not", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const input = composerInput(root);
  write(input, "One line");
  pressShiftEnter(input);
  await flush();
  assertEquals(fake.calls.sent, []);
  await pressAsync(input, "Enter");
  await flush();
  assertEquals(fake.calls.sent.map((item) => item.text), ["One line"]);
  await unmountSettled(view.view);
});

function pressShiftEnter(input: HTMLElement): void {
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

Deno.test("shell/desktop#R42 lophn-agent/conversation#R5 [agent-I33a]: while it works Stop stops the run by its id, and Change this work sends a correction to that run", async () => {
  const fake = workingFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  // a correction needs a run to correct, and the select picks between that and the next request
  write(composerInput(root), "Use March");
  const select = find(root, "[data-send-mode] [role=combobox]");
  focus(select);
  await pressAsync(select, "ArrowDown");
  await pressAsync(document.activeElement!, "ArrowUp");
  await pressAsync(document.activeElement!, "Enter");
  await pressAsync(composerInput(root), "Enter");
  await flush();
  assertEquals(fake.calls.sent.length, 1);
  assertEquals(fake.calls.sent[0]!.mode, "correction");
  assertEquals(fake.calls.sent[0]!.run, runId(1));
  assertEquals(
    text(
      find(
        find(root, `[data-message="${fake.calls.sent[0]!.id}"]`),
        "[data-delivery]",
      ),
    ),
    "Received",
  );
  assert(
    find(root, `[data-message="${fake.calls.sent[0]!.id}"]`).textContent!
      .includes("Change"),
    "a correction is marked as one",
  );

  click(find(root, "[data-stop]"));
  await flush();
  assertEquals(fake.calls.stopped.length, 1);
  assertEquals(fake.calls.stopped[0]!.run, runId(1));
  assert(fake.calls.stopped[0]!.key.startsWith("stop_"));
  // Stop is not a refusal: the thread says the work stopped, and sending is back
  assertEquals(text(find(root, "[data-run-stopped]")), "Stopped");
  assert(find(root, "[data-send]"));
  assertEquals(all(root, "[data-stop]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R42 [agent-I33a]: a Stop that fails is told and the work is still shown as working", async () => {
  const fake = workingFake();
  fake.state.writeFails.stopped = "unavailable";
  const view = await mount({ fake, session: SESSION_WEEK.id });
  click(find(view.view.container, "[data-stop]"));
  await flush();
  assertEquals(
    find(view.view.container, "[data-problem]").dataset.problem,
    "stop-failed",
  );
  assert(find(view.view.container, "[data-stop]"));
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R8 [agent-I33a]: a message the core refused is shown as not sent, keeps the words in the box, and can be sent again", async () => {
  const fake = weekFake();
  fake.state.replies = [{ ok: false, code: "forbidden" }];
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "Hello");
  click(find(root, "[data-send]"));
  await flush();
  const bubble = find(root, `[data-message="${fake.calls.sent[0]!.id}"]`);
  assertEquals(text(find(bubble, "[data-delivery]")), "Not sent");
  assert(find(bubble, "[data-provisional]"));
  assert(text(bubble).includes("It's still in the box"));
  assertEquals(composerInput(root).value, "Hello");
  assertEquals(composerInput(root).readOnly, false);
  // sending again is a new message
  click(find(root, "[data-send]"));
  await flush();
  assertEquals(fake.calls.sent.length, 2);
  assert(fake.calls.sent[1]!.id !== fake.calls.sent[0]!.id);
  assertEquals(composerInput(root).value, "");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R8 lophn-agent/conversation#R2 [agent-I33a]: when the result is unknown the box locks, Check looks in the record first, and only then Send again reuses the same id and key", async () => {
  const fake = weekFake();
  fake.state.replies = [{ ok: false, code: "unavailable" }];
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "Maybe sent");
  click(find(root, "[data-send]"));
  await flush();
  const first = fake.calls.sent[0]!;
  const bubble = () => find(root, `[data-message="${first.id}"]`);
  assertEquals(text(find(bubble(), "[data-delivery]")), "Not confirmed");
  assertEquals(composerInput(root).readOnly, true);
  assertEquals(all(bubble(), "[data-resend]").length, 0);

  // not in the record: now sending again is offered
  click(find(bubble(), "[data-check-delivery]"));
  await flush();
  assertEquals(all(bubble(), "[data-check-delivery]").length, 0);
  click(find(bubble(), "[data-resend]"));
  await flush();
  assertEquals(fake.calls.sent.length, 2);
  assertEquals(
    [fake.calls.sent[1]!.id, fake.calls.sent[1]!.key],
    [first.id, first.key],
  );
  assertEquals(composerInput(root).value, "");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R8 [agent-I33a]: a message the record already holds is accepted when I check, without sending it again", async () => {
  const fake = weekFake();
  fake.state.replies = [{ ok: false, code: "unavailable" }];
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "It did arrive");
  click(find(root, "[data-send]"));
  await flush();
  const first = fake.calls.sent[0]!;
  // the core had taken it after all
  fake.state.bodies[first.id] = [{ kind: "text", text: first.text }];
  const thread = fake.state.threads[SESSION_WEEK.id]!;
  fake.state.threads[SESSION_WEEK.id] = {
    ...thread,
    entries: [
      ...thread.entries,
      { ...say(fake, 50, "user", first.text, { at: at(1) }), id: first.id },
    ],
  };
  click(find(root, `[data-message="${first.id}"] [data-check-delivery]`));
  await flush();
  assertEquals(fake.calls.sent.length, 1, "checking sends nothing");
  assertEquals(composerInput(root).value, "");
  assertEquals(composerInput(root).readOnly, false);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R8 [agent-I33a]: a message over the limit is not sent, says why, and keeps the words", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const long = "a".repeat(MESSAGE_TEXT_MAX_BYTES);
  write(composerInput(root), long);
  await flush();
  assertEquals(
    text(find(root, "[data-too-long]")),
    "This message is too long to send. Shorten it, or split it into parts.",
  );
  assertEquals(find(root, "[data-send]").hasAttribute("disabled"), true);
  await pressAsync(composerInput(root), "Enter");
  await flush();
  assertEquals(fake.calls.sent, []);
  assertEquals(composerInput(root).value, long);
  await unmountSettled(view.view);
});

Deno.test("shell/workspace#R13 [agent-I33a]: Save as document sends a request through the thread, keeps what I was writing and the focus, and shows the saved link after the answer", async () => {
  const fake = weekFake();
  fake.state.bodies[messageId(2)] = [{ kind: "visual", block: barBlock }];
  fake.state.titles[DOC] = "Budget 2026";
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const input = composerInput(root);
  write(input, "half a thought");
  focus(input);
  click(find(root, "[data-save-visual='spend']"));
  await flush();
  assertEquals(fake.calls.sent.length, 1);
  assertEquals(fake.calls.sent[0]!.mode, "request");
  assertEquals(
    fake.calls.sent[0]!.text,
    `Save the visual “Monthly spend” (block spend in message ${
      messageId(2)
    }) as a document.`,
  );
  assertEquals(composerInput(root).value, "half a thought");
  assert(isFocused(input), "saving moved the focus");
  const save = () => find(root, "[data-visual-save]");
  assertEquals(save().getAttribute("data-visual-save"), "requested");

  // the run that took the request answers with a version link
  const run = fake.state.threads[SESSION_WEEK.id]!.run!.id;
  fake.state.threads[SESSION_WEEK.id] = {
    ...fake.state.threads[SESSION_WEEK.id]!,
    entries: [
      ...fake.state.threads[SESSION_WEEK.id]!.entries,
      say(fake, 51, "agent", "Saved it.", {
        run: { id: run, ended: true },
        results: [{ kind: "version", document: DOC, version: VER }],
      }),
    ],
    run: { id: run, phase: "ended" },
  };
  await tick(view);
  assertEquals(save().getAttribute("data-visual-save"), "saved");
  const link = find(save(), `[data-visual-document='${DOC}@${VER}']`);
  assertEquals(text(link), "Budget 2026");
  click(link);
  assertEquals(view.host.results.at(-1), [DOC, VER]);
  assert(isFocused(input), "a saved answer moved the focus");
  await unmountSettled(view.view);
});

Deno.test("shell/workspace#R13 [agent-I33a]: a save request that was not sent shows the failure on its block and leaves the box alone", async () => {
  const fake = weekFake();
  fake.state.bodies[messageId(2)] = [{ kind: "visual", block: barBlock }];
  fake.state.replies = [{ ok: false, code: "conflict" }];
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "keep me");
  click(find(root, "[data-save-visual='spend']"));
  await flush();
  assertEquals(find(root, "[data-visual-save]").dataset.visualSave, "failed");
  assertEquals(all(root, "[data-provisional]").length, 0);
  assertEquals(composerInput(root).value, "keep me");
  assertEquals(
    (find(root, "[data-save-visual='spend']") as HTMLButtonElement).disabled,
    false,
  );
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R44 lophn-agent/conversation#R23 [agent-I33a]: the model button shows the session's model, choosing one goes to the source for this session and the button follows", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assertEquals(text(find(root, "[data-model-button]")), "Sonnet 5.5 · Medium");
  click(find(root, "[data-model-button]"));
  await settle();
  const picker = find(document.body, "[data-model-picker]");
  assertEquals(
    all(picker, "[data-picker-section=favorites] [role=option]").map((row) =>
      row.dataset.model
    ),
    ["GPT-6.1 Sol", "Sonnet 5.5"],
  );
  click(
    find(
      picker,
      '[data-picker-section=provider][data-provider$="a1"] [data-model="Opus 5.5"]',
    ),
  );
  await flush();
  assertEquals(fake.calls.chosen.map((model) => model.modelName), ["Opus 5.5"]);
  assertEquals(
    text(find(root, "[data-model-button]")),
    "Opus 5.5 · High · Fast",
  );
  click(buttonNamed(find(document.body, "[data-picker-section=axes]"), "Low"));
  await flush();
  assertEquals(fake.calls.options, [["effort", "low"]]);
  assertEquals(
    text(find(root, "[data-model-button]")),
    "Opus 5.5 · Low · Fast",
  );
  // only this session: another session read later still has its own
  assert(
    text(find(document.body, "[data-picker-section=scope]")).includes(
      "Only this session",
    ),
  );
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/harness/model#R25 [agent-I33a]: a value that was fitted to the new model is told in the picker, and then it goes away", async () => {
  const fake = weekFake();
  fake.state.models[SESSION_WEEK.id] = SOL;
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assertEquals(
    text(find(root, "[data-model-button]")),
    "GPT-6.1 Sol · XHigh · Priority",
  );
  click(find(root, "[data-model-button]"));
  await settle();
  const picker = find(document.body, "[data-model-picker]");
  click(
    find(
      picker,
      '[data-picker-section=provider][data-provider$="a1"] [data-model="Sonnet 5.5"]',
    ),
  );
  await flush();
  assertEquals(text(find(root, "[data-model-button]")), "Sonnet 5.5 · High");
  assertEquals(
    text(find(find(document.body, "[data-model-picker]"), "[role=status]")),
    "Effort set to High. XHigh isn't available for Sonnet 5.5.",
  );
  // the next change of the options is a plain read, so the notice is gone
  click(buttonNamed(find(document.body, "[data-picker-section=axes]"), "Low"));
  await flush();
  assertEquals(
    all(find(document.body, "[data-model-picker]"), "[role=status]").length,
    0,
  );
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/harness/model#R26 [agent-I33a]: the search box asks the source for the filtered list, and a star asks it to toggle the favorite without picking", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  click(find(view.view.container, "[data-model-button]"));
  await settle();
  const search = find(
    document.body,
    "[data-model-picker] input",
  ) as HTMLInputElement;
  typeIntoInput(search, "so");
  await flush();
  assertEquals(fake.calls.modelQueries.at(-1), "so");
  const picker = find(document.body, "[data-model-picker]");
  assertEquals(
    all(picker, "[role=option]").map((row) => row.dataset.model),
    ["GPT-6.1 Sol", "Sonnet 5.5", "Sonnet 5.5", "GPT-6.1 Sol"],
  );
  click(
    find(
      picker,
      '[data-picker-section=favorites] [data-model="Sonnet 5.5"] button',
    ),
  );
  await flush();
  assertEquals(fake.calls.starred.map((model) => model.modelName), [
    "Sonnet 5.5",
  ]);
  assertEquals(fake.calls.chosen, []);
  click(
    buttonNamed(
      find(document.body, "[data-picker-section=defaults]"),
      "Change defaults…",
    ),
  );
  assertEquals(view.host.settings, ["defaults"]);
  await unmountSettled(view.view);
});

function typeIntoInput(input: HTMLElement, value: string): void {
  // 검색칸은 input이다.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

Deno.test("shell/desktop#R44 lophn-agent/conversation#R23 [agent-I33a]: a model picked before the session exists is kept for the session the first message opens", async () => {
  const fake = fakeAgentSource();
  const view = await mount({ fake, session: null });
  const root = view.view.container;
  click(find(root, "[data-model-button]"));
  await settle();
  click(
    find(
      document.body,
      '[data-picker-section=provider][data-provider$="a1"] [data-model="Opus 5.5"]',
    ),
  );
  await flush();
  assertEquals(fake.calls.chosen.length, 1);
  assertEquals(
    text(find(root, "[data-model-button]")),
    "Opus 5.5 · High · Fast",
  );
  await pressAsync(document.activeElement!, "Escape");
  write(composerInput(root), "Hello");
  click(find(root, "[data-send]"));
  await flush();
  assertEquals(fake.calls.opened.length, 1);
  assertEquals(
    text(find(root, "[data-model-button]")),
    "Opus 5.5 · High · Fast",
  );
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R43 [agent-I33a]: the permission summary goes to Permissions, and the plus button is the host's", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assertEquals(
    text(find(root, "[data-composer-permissions]")),
    "Ask first, 1 edit allowed this session",
  );
  click(find(root, "[data-composer-permissions]"));
  assertEquals(view.host.permissions, 1);
  click(buttonNamed(root, "Add attachment"));
  assertEquals(view.host.attached, 1);
  // the summary follows the source
  fake.state.agent = { ...fake.state.agent, permissionSummary: "Ask first" };
  await tick(view);
  assertEquals(text(find(root, "[data-composer-permissions]")), "Ask first");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R45 [agent-I33a]: typing / opens the menu with the groups in order, more letters narrow it with the matching letters bold, and a space closes it", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assertEquals(all(root, "[data-slash-group]").length, 0);
  write(composerInput(root), "/");
  await flush();
  assertEquals(
    all(root, "[data-slash-heading]").map(text),
    ["Commands", "lophn", "Skills"],
  );
  write(composerInput(root), "/co");
  await flush();
  assertEquals(fake.calls.commandQueries.at(-1), "co");
  assertEquals(all(root, "[data-slash-heading]").map(text), [
    "Commands",
    "Skills",
  ]);
  assertEquals(
    all(root, "[data-slash-label]").map((label) => label.textContent),
    ["Compact", "Fork", "eval-metrics"],
  );
  assert(
    all(root, "[data-command=compact] strong").some((mark) =>
      mark.textContent === "Co"
    ),
  );
  write(composerInput(root), "/compact now");
  await flush();
  assertEquals(all(root, "[data-slash-group]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R45 lophn-agent/commands#R8 [agent-I33a]: while the work runs a command that can't run is dimmed with the reason and does nothing when pressed", async () => {
  const fake = workingFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "/fork");
  await flush();
  const row = find(root, "[data-command=fork]");
  assertEquals(row.hasAttribute("data-blocked"), true);
  assertEquals(
    text(find(row, "[data-slash-reason]")),
    "Not while lophn is working",
  );
  click(row);
  await flush();
  assertEquals(fake.calls.forked, []);
  press(composerInput(root), "Enter");
  await flush();
  assertEquals(
    fake.calls.forked,
    [],
    "Enter on a dimmed row does nothing either",
  );
  assertEquals(fake.calls.sent, []);
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/conversation#R24 lophn-agent/commands#R9 [agent-I33a]: the session commands do what the menus do, with the person as the actor", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const run = async (query: string, name: string) => {
    write(composerInput(root), query);
    await flush();
    click(find(root, `[data-command=${name}]`));
    await flush();
    assertEquals(
      composerInput(root).value,
      "",
      `/${name} leaves the box empty`,
    );
    assertEquals(all(root, "[data-slash-group]").length, 0);
  };
  await run("/compact", "compact");
  assertEquals(fake.calls.compacted, [SESSION_WEEK.id]);
  await run("/archive", "archive");
  assertEquals(fake.calls.archived, [SESSION_WEEK.id]);
  await run("/fork", "fork");
  assertEquals(fake.calls.forked.map((item) => [item.session, item.through]), [[
    SESSION_WEEK.id,
    null,
  ]]);
  assertEquals(view.host.forked, [fake.calls.forked[0]!.id]);
  await run("/permissions", "permissions");
  assertEquals(view.host.permissions, 1);
  await run("/mcp", "mcp");
  await run("/skills", "skills");
  assertEquals(view.host.settings, ["mcp", "skills"]);
  assertEquals(fake.calls.sent, [], "none of these is a message to the agent");
  await run("/new", "new");
  assertEquals(view.changes, [null]);
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/commands#R9 [agent-I33a]: a role command and a skill command are run through the source for this session, not typed as messages", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "/new-app");
  await flush();
  click(find(root, "[data-command=new-app]"));
  await flush();
  write(composerInput(root), "/weekly");
  await flush();
  click(find(root, "[data-command=weekly-report]"));
  await flush();
  assertEquals(
    fake.calls.commands.map((
      item,
    ) => [item.session, item.entry.name, item.entry.source]),
    [[SESSION_WEEK.id, "new-app", "role"], [
      SESSION_WEEK.id,
      "weekly-report",
      "skill",
    ]],
  );
  assertEquals(fake.calls.sent, []);
  assertEquals(composerInput(root).value, "");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R45 [agent-I33a]: Rename from the menu waits for a title, and Enter then renames; the keyboard moves through the rows", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const input = composerInput(root);
  write(input, "/ren");
  await flush();
  press(input, "Enter");
  await flush();
  assertEquals(fake.calls.renamed, [], "the title is still to be written");
  assertEquals(composerInput(root).value, "/rename ");
  write(composerInput(root), "/rename Weekly report");
  await flush();
  press(composerInput(root), "Enter");
  await flush();
  assertEquals(fake.calls.renamed, [[SESSION_WEEK.id, "Weekly report"]]);
  assertEquals(composerInput(root).value, "");

  write(composerInput(root), "/");
  await flush();
  assertEquals(
    find(root, "[aria-selected=true][data-command]").dataset.command,
    "new",
  );
  press(composerInput(root), "ArrowDown");
  await flush();
  assertEquals(
    find(root, "[aria-selected=true][data-command]").dataset.command,
    "rename",
  );
  press(composerInput(root), "ArrowUp");
  press(composerInput(root), "ArrowUp");
  await flush();
  assertEquals(
    find(root, "[aria-selected=true][data-command]").dataset.command,
    "weekly-report",
    "the highlight wraps around",
  );
  press(composerInput(root), "Escape");
  await flush();
  assertEquals(all(root, "[data-slash-group]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/commands#R11 [agent-I33a]: an unknown /name is told, sent nowhere, and kept in the box", async () => {
  const fake = weekFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "/compcat");
  await flush();
  press(composerInput(root), "Enter");
  await flush();
  assertEquals(
    text(find(root, "[data-agent-composer] [role=status]")),
    "Unknown command: /compcat",
  );
  assertEquals(fake.calls.sent, []);
  assertEquals(fake.calls.commands, []);
  assertEquals(composerInput(root).value, "/compcat");
  // writing on clears the notice
  write(composerInput(root), "/compact");
  await flush();
  assertEquals(all(root, "[data-slash-label]").length > 0, true);
  await unmountSettled(view.view);
});

Deno.test("lophn-agent/commands#R6 [agent-I33a]: a name that two skills share asks which one, and the choice is the one run", async () => {
  const fake = weekFake();
  fake.state.slashGroups = LOPHN_DUPLICATE_SKILLS;
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  write(composerInput(root), "/weekly-report");
  await flush();
  assertEquals(
    all(root, "[data-command=weekly-report]").map((row) => row.dataset.origin),
    ["place", "workspace"],
    "both are listed with where each came from",
  );
  press(composerInput(root), "Enter");
  await flush();
  assertEquals(fake.calls.commands, [], "nothing runs until one is chosen");
  assertEquals(
    text(find(root, "[data-slash-choose]")),
    "More than one skill is named /weekly-report. Choose which one to use.",
  );
  click(find(root, "[data-command=weekly-report][data-origin=workspace]"));
  await flush();
  assertEquals(
    fake.calls.commands.map((
      item,
    ) => [item.entry.name, item.entry.skillOrigin]),
    [["weekly-report", "workspace"]],
  );
  await unmountSettled(view.view);
});
