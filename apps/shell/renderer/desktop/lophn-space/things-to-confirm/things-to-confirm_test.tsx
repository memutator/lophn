import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  pressAsync,
  render,
} from "../../../../../../packages/design/components/testing.ts";

import { ThingsToConfirm } from "./things-to-confirm.tsx";
import { LophnSpace } from "../lophn-space.tsx";
import { RequestDrafts, RequestsProvider } from "./context.tsx";
import { fakeSource as fakeLophn } from "../testdata/fake-source.ts";
import { find, flush } from "../testdata/dom.ts";
import {
  approval,
  approvalId,
  fakeRequests,
  groupId,
  groupQuestion,
  manualTicks,
  notification,
  question,
  questionId,
  questionText,
} from "./testdata/fake-source.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");
const HOUR = 60 * 60 * 1000;

function screen(
  fake: ReturnType<typeof fakeRequests>,
  initialTab?: "waiting" | "past" | "notifications",
) {
  return (
    <ThingsToConfirm
      deps={{
        source: fake.source,
        drafts: new RequestDrafts(),
        ticks: manualTicks().ticks,
        now: () => NOW,
      }}
      initialTab={initialTab}
    />
  );
}

/** Radix Tabs는 mousedown으로 고른다. */
function pressTab(root: ParentNode, label: string): void {
  const tab = [...root.querySelectorAll("[role=tab]")].find((item) =>
    item.textContent === label
  );
  if (!tab) throw new Error(`no tab ${label}`);
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
}

/** Radix Select를 키보드로 연 자리에서 steps만큼 내려가 고른다. */
async function choose(trigger: HTMLElement, steps: number): Promise<void> {
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  for (let step = 0; step < steps; step += 1) {
    await pressAsync(document.activeElement!, "ArrowDown");
  }
  await pressAsync(document.activeElement!, "Enter");
  await flush();
}

function titles(root: ParentNode): string[] {
  return [
    ...root.querySelectorAll(
      "[data-tab-panel] ul:not([data-counts]) li > button",
    ),
  ]
    .map((item) => item.querySelector("span")?.textContent ?? "");
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((item) =>
    item.textContent === label
  );
  if (!found) throw new Error(`no button ${label}`);
  return found as HTMLButtonElement;
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

function nothingSent(fake: ReturnType<typeof fakeRequests>): void {
  assertEquals(fake.state.answered, []);
  assertEquals(fake.state.deferred, []);
  assertEquals(fake.state.cancelled, []);
  assertEquals(fake.state.reviewed, []);
  assertEquals(fake.state.marked, []);
}

Deno.test("shell/desktop#R28: lophn 공간의 things-to-confirm 형제는 이 화면을 연다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  using view = render(
    <RequestsProvider
      deps={{
        source: fake.source,
        drafts: new RequestDrafts(),
        ticks: manualTicks().ticks,
        now: () => NOW,
      }}
    >
      <LophnSpace
        source={fakeLophn().source}
        windowWidth={1440}
        onLauncher={() => {}}
      />
    </RequestsProvider>,
  );
  await flush();
  click(find(view.container, "[data-screen='things-to-confirm']"));
  await flush();
  assert(
    view.container.querySelector("[data-screen-body='things-to-confirm']"),
  );
  assertEquals(view.container.querySelector("[data-not-ready]"), null);
});

Deno.test("shell/desktop#R9 [I45]: 기다리는 것은 종류별 개수와 다음 행동, 지난 일은 최신순 링크이고 읽는 것만으로 아무것도 보내지 않는다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1),
      approval(2),
      question(3, { blocking: true, role: "operator" }),
      question(4, {
        status: "answered",
        closedSeq: "41",
        questions: [
          groupQuestion(4, 1, { answer: { kind: "option", option: "keep" } }),
        ],
      }),
      approval(5, { status: "rejected", closedSeq: "90" }),
      question(6, {
        status: "cancelled",
        closedReason: "deferred",
        closedSeq: "70",
      }),
    ],
  });
  using view = render(screen(fake));
  await flush();
  const counts = find(view.container, "[data-counts]");
  assertEquals(
    find(counts, "[data-count=questions]").textContent,
    "2 questions",
  );
  assertEquals(
    find(counts, "[data-count=decisions]").textContent,
    "1 decision",
  );
  assertEquals(titles(view.container), [
    "Question from Operator",
    "Question from lophn",
    "Decision asked by lophn",
  ]);
  // 다음 행동은 그 종류의 첫 요청을 열 뿐이다.
  click(find(counts, "[data-next=approval]"));
  await flush();
  assertEquals(
    find(view.container, "[data-detail-column] [data-request-id]")
      .getAttribute("data-request-id"),
    approvalId(2),
  );
  click(find(counts, "[data-next=question]"));
  await flush();
  assertEquals(
    find(view.container, "[data-detail-column] [data-request-id]")
      .getAttribute("data-request-id"),
    groupId(3),
  );
  pressTab(view.container, "Past");
  await flush();
  assertEquals(titles(view.container), [
    "Decision asked by lophn",
    "Question from lophn",
    "Question from lophn",
  ]);
  const metas = [
    ...view.container.querySelectorAll(
      "[data-tab-panel] ul:not([data-counts]) li",
    ),
  ]
    .map((item) => item.textContent ?? "");
  assert(metas[0]!.includes("Declined"));
  assert(metas[1]!.includes("Put off"));
  assert(metas[2]!.includes("Answered"));
  click(
    view.container.querySelectorAll(
      "[data-tab-panel] ul:not([data-counts]) li > button",
    )[2]!,
  );
  await flush();
  assertEquals(
    find(view.container, "[data-detail-column] [data-answered-summary]")
      .textContent,
    "Answered 1 question: Keep both files",
  );
  nothingSent(fake);
});

Deno.test("lophn-agent/questions#R10 [I45]: 지난 묶음은 질문 본문과 받은 자유 답·취소 이유를 core가 둔 글로 다시 보인다", async () => {
  const answered = question(1, {
    status: "answered",
    closedSeq: "50",
    questions: [
      groupQuestion(1, 1, { answer: { kind: "text" } }),
      groupQuestion(1, 2, { answer: { kind: "option", option: "merge" } }),
    ],
  });
  const cancelled = question(2, {
    status: "cancelled",
    closedReason: "cancelled",
    closedSeq: "40",
  });
  const base = questionText(answered);
  const fake = fakeRequests({
    requests: [answered, cancelled],
    texts: {
      [groupId(1)]: {
        ...base,
        questions: [
          {
            ...base.questions[0]!,
            prompt: "What should the summary cover?",
            answer: "Only this week's numbers.",
          },
          base.questions[1]!,
        ],
      },
      [groupId(2)]: questionText(cancelled, {
        closedReason: "Not needed anymore.",
      }),
    },
  });
  using view = render(screen(fake, "past"));
  await flush();
  const rows = () =>
    view.container.querySelectorAll(
      "[data-tab-panel] ul:not([data-counts]) li > button",
    );
  click(rows()[0]!);
  await flush();
  const detail = find(view.container, "[data-detail-column]");
  assertEquals(
    [...detail.querySelectorAll("[data-question-text]")].map((item) =>
      item.textContent
    ),
    ["What should the summary cover?", "Question 2?"],
  );
  assertEquals(
    find(detail, "[data-answered-summary]").textContent,
    "Answered 2 questions: Only this week's numbers. · Merge them",
  );
  // 닫힌 묶음에는 고르는 카드가 없다.
  assertEquals(detail.querySelector("[data-question-card]"), null);
  click(rows()[1]!);
  await flush();
  const closed = find(view.container, "[data-detail-column]");
  assertEquals(
    find(closed, "[data-answered-summary]").textContent,
    "Cancelled",
  );
  assertEquals(
    find(closed, "[data-closed-reason]").textContent,
    "Not needed anymore.",
  );
  nothingSent(fake);
});

Deno.test("shell/desktop#R9: 역할·기간 filter는 목록만 거르고 맞는 것이 없으면 filter 때문이라고 말한다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1, { role: "lophn", createdAt: NOW - 2 * HOUR }),
      question(2, { role: "operator", createdAt: NOW - 3 * 24 * HOUR }),
      approval(3, { role: "app_engineer", createdAt: NOW - 40 * 24 * HOUR }),
    ],
  });
  using view = render(screen(fake));
  await flush();
  const filters = find(view.container, "[data-filters]");
  assertEquals(
    [...filters.querySelectorAll("label")].map((label) => label.textContent),
    ["Role", "Period"],
  );
  assertEquals(titles(view.container).length, 3);
  const [role, period] = filters.querySelectorAll("button");
  await choose(period!, 2);
  assertEquals(titles(view.container), [
    "Question from lophn",
    "Question from Operator",
  ]);
  await choose(role!, 2);
  assertEquals(titles(view.container), []);
  assertEquals(
    find(view.container, "[data-empty]").textContent,
    "Nothing matches these filters.",
  );
  nothingSent(fake);
});

/** 세션 없는 묶음이 있는 화면에서 첫 줄을 열어 둔다. */
async function openGroup(fake: ReturnType<typeof fakeRequests>) {
  const view = render(screen(fake));
  await flush();
  const row = view.container.querySelector(
    "[data-tab-panel] ul:not([data-counts]) li",
  ) as HTMLElement;
  click(find(row, "button"));
  await flush();
  return { view, detail: find(view.container, "[data-detail-column]") };
}

Deno.test("lophn-agent/questions#R2, R4 [I45]: 세션 없는 run의 묶음은 things-to-confirm에서 열어 선택만으로는 보내지 않고 Submit이 모든 답을 한 번에 보낸다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1, {
        role: "operator",
        questions: [
          groupQuestion(1, 1),
          groupQuestion(1, 2, {
            options: [
              { key: "yes", label: "Yes", action: false },
              { key: "no", label: "No", action: false },
            ],
            recommended: null,
          }),
        ],
      }),
    ],
  });
  using view = render(screen(fake));
  await flush();
  const item = view.container.querySelector(
    "[data-tab-panel] ul:not([data-counts]) li",
  ) as HTMLElement;
  assert(item.textContent?.includes("Not in a conversation"));
  assertEquals(
    view.container.querySelector("[data-detail-column] [data-question-card]"),
    null,
  );
  click(find(item, "button"));
  await flush();
  const detail = find(view.container, "[data-detail-column]");
  // 묶음 카드는 대화 안 카드와 같은 component다: 머리에 묻는 agent와 질문 수, 질문마다 선택지.
  assert(
    find(detail, "[data-question-card] header").textContent?.startsWith(
      "Operator is asking 2 questions",
    ),
  );
  assertEquals(detail.querySelectorAll("[role=radiogroup]").length, 2);
  assertEquals(
    find(detail, `[data-request-id='${groupId(1)}']`).getAttribute(
      "data-status",
    ),
    "pending",
  );
  // 글은 core가 둔 글을 읽어 그린다.
  assertEquals(fake.state.textReads.includes(groupId(1)), true);
  assert(detail.textContent?.includes("Which copy of the notes should stay?"));
  assert(detail.textContent?.includes("About: Keep both files"));
  // 선택만으로는 아무것도 보내지 않고 모든 질문에 답하기 전에는 Submit이 막혀 있다.
  click(
    find(detail, `[data-question='${questionId(1, 1)}'] [data-option=keep]`),
  );
  await flush();
  assertEquals(fake.state.answered, []);
  assertEquals(button(detail, "Submit").disabled, true);
  click(find(detail, `[data-question='${questionId(1, 2)}'] [data-option=no]`));
  await flush();
  assertEquals(fake.state.answered, []);
  assertEquals(button(detail, "Submit").disabled, false);
  click(button(detail, "Submit"));
  await flush();
  assertEquals(fake.state.answered, [{
    group: groupId(1),
    answers: [
      {
        question: questionId(1, 1),
        answer: { kind: "option", option_key: "keep" },
      },
      {
        question: questionId(1, 2),
        answer: { kind: "option", option_key: "no" },
      },
    ],
  }]);
  assertEquals(fake.state.deferred, []);
  assertEquals(fake.state.cancelled, []);
  // 접수된 뒤 현재 기록을 다시 읽어 접힌 요약으로 남고 카드는 닫힌다.
  assertEquals(
    find(view.container, "[data-detail-column] [data-answered-summary]")
      .textContent,
    "Answered 2 questions: Keep both files · No",
  );
  assertEquals(
    view.container.querySelector("[data-detail-column] [data-question-card]"),
    null,
  );
});

Deno.test("lophn-agent/questions#R3, R4 [I45]: 선택지 대신 자유 답을 쓰면 글을 값으로 보내고 비어 있으면 Submit이 막혀 있다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  click(find(detail, "[data-option-other]"));
  await flush();
  assertEquals(button(detail, "Submit").disabled, true);
  const input = find(detail, "[data-option-other] input") as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "Only this week's numbers.");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  click(button(detail, "Submit"));
  await flush();
  assertEquals(fake.state.answered, [{
    group: groupId(1),
    answers: [{
      question: questionId(1, 1),
      answer: { kind: "text", text: "Only this week's numbers." },
    }],
  }]);
});

Deno.test("lophn-agent/questions#R6, R8 [I45]: Skip은 묶음 전체를 답 없이 미루고 답을 보내지 않는다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  click(find(detail, "[data-option=keep]"));
  await flush();
  click(button(detail, "Skip"));
  await flush();
  assertEquals(fake.state.deferred, [groupId(1)]);
  assertEquals(fake.state.answered, []);
  assertEquals(fake.state.cancelled, []);
  assertEquals(
    find(view.container, "[data-detail-column] [data-answered-summary]")
      .textContent,
    "Skipped",
  );
});

Deno.test("lophn-agent/questions#R6, R8 [I45]: 취소는 이유를 받아 따로 보내고 이유가 비면 보내지 않는다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  click(find(detail, "[data-cancel-question]"));
  await flush();
  const confirm = find(detail, "[data-confirm-cancel]") as HTMLButtonElement;
  assertEquals(confirm.disabled, true);
  write(find(detail, "[data-cancel-reason]"), "   ");
  await flush();
  assertEquals(confirm.disabled, true);
  write(find(detail, "[data-cancel-reason]"), "No longer needed.");
  await flush();
  assertEquals(confirm.disabled, false);
  click(confirm);
  await flush();
  assertEquals(fake.state.cancelled, [{
    group: groupId(1),
    reason: "No longer needed.",
  }]);
  assertEquals(fake.state.answered, []);
  assertEquals(fake.state.deferred, []);
  const closed = find(view.container, "[data-detail-column]");
  assertEquals(
    find(closed, "[data-answered-summary]").textContent,
    "Cancelled",
  );
  assertEquals(
    find(closed, "[data-closed-reason]").textContent,
    "No longer needed.",
  );
});

Deno.test("lophn-agent/questions#R4 [I45]: 고정 action이 있는 선택지의 Submit은 답을 보내지 않고 confirmation window만 연다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1, {
        questions: [
          groupQuestion(1, 1, {
            options: [
              {
                key: "move",
                label: "Move it",
                action: true,
                command: "document.move",
              },
              { key: "stay", label: "Leave it", action: false },
            ],
            recommended: null,
          }),
        ],
      }),
    ],
  });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  click(find(detail, "[data-option=move]"));
  await flush();
  assertEquals(fake.state.reviewed, []);
  click(button(detail, "Submit"));
  await flush();
  assertEquals(fake.state.reviewed, [{
    kind: "question_option_action",
    question: questionId(1, 1),
    option_key: "move",
  }]);
  assertEquals(fake.state.answered, []);
  // 같은 묶음의 action 없는 선택지는 일반 답으로 간다.
  click(find(detail, "[data-option=stay]"));
  await flush();
  click(button(detail, "Submit"));
  await flush();
  assertEquals(fake.state.answered.length, 1);
  assertEquals(fake.state.reviewed.length, 1);
});

Deno.test("lophn-agent/questions#R4 [I45]: 보호 창을 열 수 없으면 그렇다고 말하고 다른 길로 답을 보내지 않는다", async () => {
  const fake = fakeRequests({
    reviewOpens: false,
    requests: [
      question(1, {
        questions: [
          groupQuestion(1, 1, {
            options: [{
              key: "move",
              label: "Move it",
              action: true,
              command: "document.move",
            }],
            recommended: null,
          }),
        ],
      }),
    ],
  });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  click(find(detail, "[data-option=move]"));
  await flush();
  click(button(detail, "Submit"));
  await flush();
  assertEquals(
    find(detail, "[data-problem]").getAttribute("data-problem"),
    "review-unavailable",
  );
  assertEquals(fake.state.answered, []);
});

Deno.test("lophn-agent/questions#R9 [I45]: 이미 닫혔거나 바뀐 묶음의 답은 새 결정으로 보이지 않고 최신 기록으로 맞춘다", async () => {
  const fake = fakeRequests({
    requests: [question(1)],
    replies: [{ ok: false, code: "conflict" }],
  });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  const reads = fake.state.reads;
  click(find(detail, "[data-option=keep]"));
  await flush();
  click(button(detail, "Submit"));
  await flush();
  assertEquals(
    find(view.container, "[data-detail-column] [data-problem]").textContent,
    "This changed since you opened it. Showing the latest.",
  );
  assert(fake.state.reads > reads);
});

Deno.test("lophn-agent/questions#R4 [I45]: 묶음 글을 읽지 못하면 그렇다고 말하고 카드를 그리지 않는다", async () => {
  const fake = fakeRequests({
    requests: [question(1)],
    texts: { [groupId(1)]: null },
  });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  assertEquals(
    find(detail, "[data-question-text=failed]").textContent,
    "Couldn't load this question's text.",
  );
  assertEquals(detail.querySelector("[data-question-card]"), null);
  nothingSent(fake);
});

Deno.test("lophn-agent/questions#R4, R7 [I45]: 기한이 있는 묶음은 카드에 남은 시간을 보인다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1, { expiresAt: new Date(NOW + 2 * HOUR).toISOString() }),
    ],
  });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  assertEquals(
    find(detail, "[data-question-expiry]").textContent,
    "Expires in 2h 0m",
  );
});

Deno.test("shell/desktop#R7 [I45]: 연결이 끊기면 묶음의 Submit과 Skip을 막고 고르는 것은 그대로 된다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { view, detail } = await openGroup(fake);
  using _view = view;
  fake.push({ state: "stale", confirmedAt: 1 });
  await flush();
  click(find(detail, "[data-option=keep]"));
  await flush();
  assertEquals(button(detail, "Submit").disabled, true);
  assertEquals(button(detail, "Skip").disabled, true);
  assertEquals(
    find(detail, "[data-option=keep]").getAttribute("aria-checked"),
    "true",
  );
  nothingSent(fake);
});

Deno.test("platform/notifications#R5, R6 [I45]: 읽음과 읽지 않음을 구별하고 명시한 읽음 표시만 읽음이며 답·승인이 아니다", async () => {
  const fake = fakeRequests({
    requests: [question(1)],
    notifications: [
      notification(1, "QuestionCreated", "10"),
      notification(2, "ProblemOpened", "20", "2026-10-06T08:00:00.000Z"),
      notification(3, "TicketCheckFailed", "30"),
    ],
  });
  using view = render(screen(fake, "notifications"));
  await flush();
  const rows = [...view.container.querySelectorAll("[data-notification]")];
  assertEquals(rows.map((row) => row.textContent), [
    "A task's check failedUnread",
    "An issue was reportedRead",
    "A question is waitingUnread",
  ]);
  assertEquals(
    rows.map((row) => row.hasAttribute("data-unread")),
    [true, false, true],
  );
  // 질문 notification을 누르면 그 질문을 연다. 읽음이 아니다.
  click(find(rows[2] as HTMLElement, "button"));
  await flush();
  assertEquals(
    find(view.container, "[data-detail-column] [data-request-id]")
      .getAttribute("data-request-id"),
    groupId(1),
  );
  nothingSent(fake);
  const mark = find(rows[2] as HTMLElement, "[data-mark-read]");
  assertEquals(mark.getAttribute("aria-label"), "Mark as read");
  assertEquals(mark.textContent, "");
  click(mark);
  await flush();
  assertEquals(fake.state.marked, [rows[2]!.getAttribute("data-notification")]);
  assertEquals(fake.state.answered, []);
  assertEquals(fake.state.reviewed, []);
  const after = view.container.querySelector(
    `[data-notification='${rows[2]!.getAttribute("data-notification")}']`,
  ) as HTMLElement;
  assertEquals(after.hasAttribute("data-unread"), false);
  assertEquals(after.querySelector("[data-mark-read]"), null);
});

Deno.test("shell/desktop#R9: 많은 요청도 종류나 개수로 버리지 않고 모두 목록에 있다", async () => {
  const requests = Array.from(
    { length: 120 },
    (_, index) => index % 3 === 0 ? approval(index + 1) : question(index + 1),
  );
  const fake = fakeRequests({ requests });
  using view = render(screen(fake));
  await flush();
  assertEquals(titles(view.container).length, 120);
  assertEquals(
    find(view.container, "[data-count=questions]").textContent,
    "80 questions",
  );
  assertEquals(
    find(view.container, "[data-count=decisions]").textContent,
    "40 decisions",
  );
});

Deno.test("shell/desktop#R7: 읽기에 실패하면 마지막 목록과 확인 시각을 두고 빈 결과로 보이지 않는다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const ticks = manualTicks();
  using view = render(
    <ThingsToConfirm
      deps={{
        source: fake.source,
        drafts: new RequestDrafts(),
        ticks: ticks.ticks,
        now: () => NOW,
      }}
    />,
  );
  await flush();
  fake.state.readsFail = true;
  ticks.tick();
  await flush();
  assertEquals(titles(view.container).length, 1);
  assertEquals(
    find(view.container, "[data-stale]").textContent,
    "Couldn't check for updates. Last checked now.",
  );
});

Deno.test("shell/desktop#R7: approval·notification을 읽지 못해도 질문은 보이고 결정 0건이나 빈 notification으로 말하지 않는다", async () => {
  const fake = fakeRequests({
    requests: [question(1), approval(2)],
    notifications: [notification(1, "QuestionCreated", "10")],
    approvalsFail: true,
    notificationsFail: true,
  });
  using view = render(screen(fake));
  await flush();
  assertEquals(titles(view.container), ["Question from lophn"]);
  assertEquals(
    find(view.container, "[data-count=decisions]").textContent,
    "Couldn't load decisions right now.",
  );
  pressTab(view.container, "Notifications");
  await flush();
  assertEquals(view.container.querySelector("[data-empty]"), null);
  assertEquals(
    find(view.container, "[data-unavailable=notifications]").textContent,
    "Couldn't load notifications right now.",
  );
});

Deno.test("shell/desktop#R7: approval을 읽지 못하면 질문이 없어도 기다리는 것이 없다고 말하지 않는다", async () => {
  const fake = fakeRequests({ requests: [], approvalsFail: true });
  using view = render(screen(fake));
  await flush();
  assertEquals(view.container.querySelector("[data-empty]"), null);
  assertEquals(
    find(view.container, "[data-count=questions]").textContent,
    "0 questions",
  );
});
