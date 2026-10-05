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
  manualTicks,
  notification,
  question,
  questionId,
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

Deno.test("shell/desktop#R9: 기다리는 것은 종류별 개수와 다음 행동, 지난 일은 최신순 링크이고 읽는 것만으로 아무것도 보내지 않는다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1),
      approval(2),
      question(3, { blocking: true, role: "operator" }),
      question(4, {
        status: "answered",
        closedSeq: "41",
        answer: { kind: "option", option: "keep" },
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
    questionId(3),
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
    find(view.container, "[data-detail-column] [data-answer]").textContent,
    "You chose Keep both files.",
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

Deno.test("shell/desktop#R6: 세션 없는 요청도 things-to-confirm에서 열어 답한다", async () => {
  const fake = fakeRequests({
    requests: [question(1, { session: null, role: "operator" })],
  });
  using view = render(screen(fake));
  await flush();
  const row = view.container.querySelector(
    "[data-tab-panel] ul:not([data-counts]) li",
  ) as HTMLElement;
  assert(row.textContent?.includes("Not in a conversation"));
  click(find(row, "button"));
  await flush();
  const detail = find(view.container, "[data-detail-column]");
  click(find(detail, "[data-option=keep]"));
  await flush();
  assertEquals(fake.state.answered, []);
  click(find(detail, "[data-send-answer]"));
  await flush();
  assertEquals(fake.state.answered, [{
    question: questionId(1),
    answer: { kind: "option", option: "keep" },
  }]);
});

Deno.test("platform/notifications#R5, R6: 읽음과 읽지 않음을 구별하고 명시한 읽음 표시만 읽음이며 답·승인이 아니다", async () => {
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
    questionId(1),
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
