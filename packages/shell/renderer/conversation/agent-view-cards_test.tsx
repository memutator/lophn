// agent-I33a: Agent 화면 안의 질문 묶음 카드·승인 카드·진행. 카드 안쪽은 부품 test가 보고, 여기서는 카드가
// 대화 안(질문)과 composer 위(승인)의 제자리에 놓이고 source와 맞물려 일하는지를 본다.
import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  press,
  pressAsync,
  settle,
  unmountSettled,
} from "../../../design/components/testing.ts";

import {
  fakeAgentSource,
  messageId,
  SESSION_WEEK,
  waitingApproval,
  waitingQuestions,
  workingReport,
} from "./testdata/fake-agent-source.ts";
import {
  all,
  before,
  buttonNamed,
  connect,
  find,
  flush,
  mount,
  text,
} from "./testdata/agent-view-harness.tsx";
import { REPORT_ANSWERS, REPORT_GROUP } from "./testdata/question-card.ts";
import { TOOL_ASK_REQUEST } from "./testdata/approval-card.ts";

function questionFake() {
  const fake = fakeAgentSource({ sessions: [SESSION_WEEK] });
  fake.state.threads[SESSION_WEEK.id] = waitingQuestions(fake);
  return fake;
}

function approvalFake() {
  const fake = fakeAgentSource({ sessions: [SESSION_WEEK] });
  fake.state.threads[SESSION_WEEK.id] = waitingApproval(fake);
  return fake;
}

Deno.test("shell/desktop#R46 [agent-I33a]: a question group is one card inside the agent's side of the thread, and nothing is put above the composer for it", async () => {
  const fake = questionFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const card = find(root, "[data-question-card]");
  assert(card.closest("[data-agent-turn]"), "the card is in an agent turn");
  assert(find(root, "[data-thread]").contains(card));
  assertEquals(all(root, "[data-question-card]").length, 1);
  assert(
    before(find(root, "[data-thread]"), find(root, "[data-agent-composer]")),
  );
  assertEquals(all(root, "[data-question-strip]").length, 0);
  // the work is paused: Stop is in the composer
  assert(find(root, "[data-stop]"));
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R46 lophn-agent/questions#R4 [agent-I33a]: Submit sends all the answers at once in question order, and the card folds into the summary", async () => {
  const fake = questionFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const submit = () =>
    buttonNamed(find(root, "[data-question-card]"), "Submit");
  assertEquals(submit().hasAttribute("disabled"), true);
  click(
    find(
      root,
      `[data-question="${
        REPORT_GROUP.questions[0]!.id
      }"] [data-option="reports"]`,
    ),
  );
  assertEquals(submit().hasAttribute("disabled"), true, "one of two answered");
  click(
    find(
      root,
      `[data-question="${REPORT_GROUP.questions[1]!.id}"] [data-option="yes"]`,
    ),
  );
  assertEquals(fake.calls.answered, [], "choosing alone sends nothing");
  click(submit());
  await flush();
  assertEquals(fake.calls.answered, [{
    group: REPORT_GROUP.id,
    answers: REPORT_ANSWERS,
  }]);
  assertEquals(all(root, "[data-question-card]").length, 0);
  const summary = find(root, "[data-answered-summary]");
  assertEquals(summary.dataset.status, "answered");
  assertEquals(text(summary), "Answered 2 questions: docs/reports/ · Yes");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R46 [agent-I33a]: Skip puts the group off as a whole, and the summary says skipped instead of answered", async () => {
  const fake = questionFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  click(buttonNamed(find(root, "[data-question-card]"), "Skip"));
  await flush();
  assertEquals(fake.calls.deferred, [REPORT_GROUP.id]);
  assertEquals(fake.calls.answered, []);
  const summary = find(root, "[data-answered-summary]");
  assertEquals(summary.dataset.status, "skipped");
  assertEquals(text(summary), "Skipped");
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R46 [agent-I33a]: a failed answer is told and leaves the card with the choices to answer again", async () => {
  const fake = questionFake();
  fake.state.writeFails.answered = "conflict";
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  click(
    find(
      root,
      `[data-question="${
        REPORT_GROUP.questions[0]!.id
      }"] [data-option="reports"]`,
    ),
  );
  click(
    find(
      root,
      `[data-question="${REPORT_GROUP.questions[1]!.id}"] [data-option="yes"]`,
    ),
  );
  click(buttonNamed(find(root, "[data-question-card]"), "Submit"));
  await flush();
  assertEquals(find(root, "[data-problem]").dataset.problem, "action-failed");
  assertEquals(all(root, "[data-question-card]").length, 1);
  // the choices the person made are still there to send again
  assertEquals(
    buttonNamed(find(root, "[data-question-card]"), "Submit").hasAttribute(
      "disabled",
    ),
    false,
  );
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R46 [agent-I33a]: while disconnected the card can't be submitted or skipped", async () => {
  const fake = questionFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  click(
    find(
      root,
      `[data-question="${
        REPORT_GROUP.questions[0]!.id
      }"] [data-option="reports"]`,
    ),
  );
  click(
    find(
      root,
      `[data-question="${REPORT_GROUP.questions[1]!.id}"] [data-option="yes"]`,
    ),
  );
  await connect(view, { state: "stale", confirmedAt: 1 });
  const card = find(root, "[data-question-card]");
  assertEquals(buttonNamed(card, "Submit").hasAttribute("disabled"), true);
  assertEquals(buttonNamed(card, "Skip").hasAttribute("disabled"), true);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R47 [agent-I33a]: the approval card sits right above the composer outside the scrolling thread, and keeps its place until the confirmation window decides", async () => {
  const fake = approvalFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const card = find(root, `[data-approval-id="${TOOL_ASK_REQUEST.id}"]`);
  const thread = find(root, "[data-thread]");
  const composer = find(root, "[data-agent-composer]");
  assert(!thread.contains(card), "the card does not scroll with the thread");
  assert(before(thread, card) && before(card, composer));
  assertEquals(card.nextElementSibling, composer, "right above the composer");
  assert(text(card).includes(TOOL_ASK_REQUEST.title));
  assertEquals(all(root, "[data-approval-id]").length, 1);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R47 platform/approvals#R18 [agent-I33a]: Allow, the scope menu and Deny only ask the source to open the confirmation window with the choice picked, and decide nothing", async () => {
  const fake = approvalFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const card = () => find(root, `[data-approval-id="${TOOL_ASK_REQUEST.id}"]`);
  click(buttonNamed(card(), "Allow"));
  await flush();
  const trigger = buttonNamed(card(), "Allow scope");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  assertEquals(
    all(document.body, "[role=menuitem]").map(text),
    ["Allow once", "Allow for this session"],
  );
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  await flush();
  click(buttonNamed(card(), "Deny"));
  await flush();
  press(card(), "Escape");
  await flush();
  assertEquals(
    fake.calls.approvals.map((item) => [item.approval, item.choice]),
    [
      [TOOL_ASK_REQUEST.id, "allow_once"],
      [TOOL_ASK_REQUEST.id, "allow_session"],
      [TOOL_ASK_REQUEST.id, "deny"],
      [TOOL_ASK_REQUEST.id, "deny"],
    ],
  );
  // still waiting for the decision from the window
  assertEquals(all(root, "[data-approval-id]").length, 1);
  await settle();
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R47 shell/desktop#R42 [agent-I33a]: Stop is in the composer, stops the run, and is not a refusal of the request", async () => {
  const fake = approvalFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  click(find(root, "[data-stop]"));
  await flush();
  assertEquals(fake.calls.stopped.length, 1);
  assertEquals(fake.calls.approvals, []);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R47 [agent-I33a]: an approval that is gone on the next read takes the card away", async () => {
  const fake = approvalFake();
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  assert(find(root, "[data-approval-id]"));
  fake.state.threads[SESSION_WEEK.id] = {
    ...fake.state.threads[SESSION_WEEK.id]!,
    approval: null,
    run: { id: fake.state.threads[SESSION_WEEK.id]!.run!.id, phase: "working" },
  };
  view.ticks.tick();
  await flush();
  assertEquals(all(root, "[data-approval-id]").length, 0);
  await unmountSettled(view.view);
});

Deno.test("shell/desktop#R42 [agent-I33a]: the progress chip in the header counts finished over all tasks and opens the list with the current one marked", async () => {
  const fake = fakeAgentSource({ sessions: [SESSION_WEEK] });
  fake.state.threads[SESSION_WEEK.id] = workingReport(fake);
  const view = await mount({ fake, session: SESSION_WEEK.id });
  const root = view.view.container;
  const chip = find(find(root, "[data-agent-header]"), '[aria-label="Tasks"]');
  assertEquals(text(chip), "2/4");
  click(chip);
  await settle();
  const done = all(document.body, "[data-task][data-state=done]").length;
  assertEquals(done, 2);
  assertEquals(
    find(document.body, "[data-task][data-state=now]").dataset.task,
    "task-3",
  );
  assertEquals(all(document.body, "[data-task][data-state=later]").length, 1);
  assert(find(root, `[data-message="${messageId(1)}"]`));
  await unmountSettled(view.view);
});
