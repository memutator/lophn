// 실제 core 위의 things-to-confirm. question-core.ts가 temp LOPHN_HOME의 core에서 사람 세션의
// run으로 세션 있는 질문 묶음을, handoff로 받은 run(세션 없음)으로 세션 없는 질문 묶음을,
// coding agent로 approval request를 만든다. 이 화면은 세션 없는 묶음과 approval과 notification을
// 읽어 보인다(세션 있는 묶음은 대화 안 카드가 맡는다). 실제 provider는 부르지 않는다. 끝나면
// 띄운 core만 멈춘다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { render } from "../../../../../../packages/design/components/testing.ts";

import { RequestDrafts } from "./context.tsx";
import { coreRequestSource } from "./core-source.ts";
import { manualTicks } from "./testdata/fake-source.ts";
import { ThingsToConfirm } from "./things-to-confirm.tsx";
import { QUESTION_CORE, startRealCore } from "../../../testdata/real-core.ts";
import {
  SEED_APPROVAL,
  SEED_GROUP,
  SEED_HANDOFF_GROUP,
  SEED_HANDOFF_OPTIONS,
  SEED_HANDOFF_PROMPT,
  SEED_HANDOFF_QUESTION,
  SEED_HANDOFF_REASON,
} from "../../../testdata/question-seed.ts";

const WAIT_MS = 20_000;

async function until(label: string, check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`기다림 초과: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found as HTMLElement;
}

Deno.test("shell/desktop#R9 [I45]: 실제 core에서 things-to-confirm은 세션 없는 묶음과 approval과 notification 목록을 읽어 보인다", async () => {
  const core = await startRealCore({ entry: QUESTION_CORE });
  try {
    const source = coreRequestSource(core.source, undefined);
    // notification은 core 안 구독 루프가 approval 생성 뒤에 만든다. 생길 때까지 기다린다.
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const unread = await source.unread();
      assert(unread.ok, core.log());
      if (unread.value.length >= 3) break;
      if (Date.now() > deadline) throw new Error("notification이 오지 않았다");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const overview = await source.overview();
    assert(overview.ok, core.log());
    assertEquals(overview.value.approvalsRead, true);
    assertEquals(overview.value.notificationsRead, true);
    assertEquals(
      overview.value.requests.map((request) => [request.kind, request.id])
        .sort(),
      [["approval", SEED_APPROVAL], ["question", SEED_HANDOFF_GROUP]],
    );
    // 세션 있는 run의 묶음(SEED_GROUP)은 이 화면 목록에 없다.
    assertEquals(
      overview.value.requests.some((request) => request.id === SEED_GROUP),
      false,
    );
    assertEquals(
      overview.value.notifications.map((row) => row.sourceEvent),
      ["QuestionCreated", "QuestionCreated", "ApprovalRequestCreated"],
    );

    const screen = (initialTab: "waiting" | "notifications") => (
      <ThingsToConfirm
        deps={{
          source,
          drafts: new RequestDrafts(),
          ticks: manualTicks().ticks,
        }}
        initialTab={initialTab}
      />
    );
    {
      using view = render(screen("waiting"));
      const root = view.container;
      await until(
        "개수",
        () => root.querySelector("[data-count=decisions]") !== null,
      );
      assertEquals(
        find(root, "[data-count=decisions]").textContent,
        "1 decision",
      );
      assertEquals(
        find(root, "[data-count=questions]").textContent,
        "1 question",
      );
      assert(!root.textContent?.includes("Couldn't load decisions"));
    }
    {
      using view = render(screen("notifications"));
      const root = view.container;
      await until(
        "notification 목록",
        () => root.querySelector("[data-notifications]") !== null,
      );
      const rows = root.querySelectorAll("[data-notification]");
      assertEquals(rows.length, 3);
      // 화면 목록은 최신 알림이 먼저다.
      assert(rows[0]!.textContent?.includes("A decision is waiting"));
      assert(rows[1]!.textContent?.includes("A question is waiting"));
      assert(rows[2]!.textContent?.includes("A question is waiting"));
      assert(rows.every((row) => row.hasAttribute("data-unread")));
      // 세션 없는 묶음의 알림은 그 묶음을 연다. 세션 있는 묶음의 알림은 열 대상이 없다.
      assertEquals(
        (find(rows[1] as HTMLElement, "button") as HTMLButtonElement).disabled,
        false,
      );
      assertEquals(
        (find(rows[2] as HTMLElement, "button") as HTMLButtonElement).disabled,
        true,
      );
      assertEquals(root.querySelector("[data-unavailable]"), null);
    }
  } finally {
    await core.stop();
  }
});

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((item) =>
    item.textContent === label
  );
  if (!found) throw new Error(`no button ${label}`);
  return found as HTMLButtonElement;
}

Deno.test("lophn-agent/questions#R2 [I45]: 실제 core에서 세션 없는 run의 묶음을 things-to-confirm에서 답한다", async () => {
  const core = await startRealCore({ entry: QUESTION_CORE });
  try {
    const source = coreRequestSource(core.source, undefined);
    const readGroup = async (group: string) => {
      const read = await core.source.call({
        kind: "read",
        resource: "questions",
        method: "read",
        body: { group },
      });
      assert(read.ok, core.log());
      return (read.value as {
        group: {
          status: string;
          session: string | null;
          questions: {
            id: string;
            answer: { kind: string; option_key: string } | null;
          }[];
        };
      }).group;
    };
    // 심은 묶음은 세션 없는 run의 것이다.
    const before = await readGroup(SEED_HANDOFF_GROUP);
    assertEquals(before.status, "pending");
    assertEquals(before.session, null);

    using view = render(
      <ThingsToConfirm
        deps={{
          source,
          drafts: new RequestDrafts(),
          ticks: manualTicks().ticks,
        }}
      />,
    );
    const root = view.container;
    await until(
      "묶음 줄",
      () =>
        root.querySelector(
          "[data-tab-panel] ul:not([data-counts]) li > button",
        ) !==
          null,
    );
    // 세션 있는 묶음은 이 목록에 없고 세션 없는 묶음 하나만 있다.
    assertEquals(
      root.querySelectorAll("[data-tab-panel] ul:not([data-counts]) li").length,
      1,
    );
    act(() => {
      (find(root, "[data-tab-panel] ul:not([data-counts]) li > button"))
        .click();
    });
    await until(
      "묶음 카드",
      () =>
        root.querySelector("[data-detail-column] [data-question-card]") !==
          null,
    );
    const detail = find(root, "[data-detail-column]");
    assertEquals(
      find(detail, `[data-request-id='${SEED_HANDOFF_GROUP}']`).getAttribute(
        "data-status",
      ),
      "pending",
    );
    assert(detail.textContent?.includes(SEED_HANDOFF_PROMPT));
    assert(detail.textContent?.includes(SEED_HANDOFF_OPTIONS[0].description));
    // 상세의 이유는 Details를 펼쳐야 보인다.
    assertEquals(detail.textContent?.includes(SEED_HANDOFF_REASON), false);

    // 선택만으로는 core에 답이 생기지 않는다.
    act(() => {
      find(detail, `[data-option=${SEED_HANDOFF_OPTIONS[1].key}]`).click();
    });
    assertEquals((await readGroup(SEED_HANDOFF_GROUP)).status, "pending");

    act(() => {
      button(detail, "Submit").click();
    });
    await until(
      "답 접수",
      () =>
        root.querySelector("[data-detail-column] [data-answered-summary]") !==
          null,
    );
    assertEquals(
      find(root, "[data-detail-column] [data-answered-summary]").textContent,
      `Answered 1 question: ${SEED_HANDOFF_OPTIONS[1].label}`,
    );

    const after = await readGroup(SEED_HANDOFF_GROUP);
    assertEquals(after.status, "answered");
    assertEquals(after.questions.length, 1);
    assertEquals(after.questions[0]!.id, SEED_HANDOFF_QUESTION);
    assertEquals(after.questions[0]!.answer?.kind, "option");
    assertEquals(
      after.questions[0]!.answer?.option_key,
      SEED_HANDOFF_OPTIONS[1].key,
    );
    // 세션 있는 run의 묶음에는 손대지 않는다.
    assertEquals((await readGroup(SEED_GROUP)).status, "pending");
  } finally {
    await core.stop();
  }
});
