// 실제 core 위의 질문 칸과 things-to-confirm. question-core.ts가 temp LOPHN_HOME의 core에서
// 사람 세션의 run을 시작하고 그 run의 agent로 글이 있는 질문을, coding agent로 approval
// request를 만든다. 칸은 ReadQuestionText로 글을 읽어 보이고, action 없는 답은 확인 handle
// 없이 AnswerQuestion으로 가서 질문이 닫힌다. 실제 provider는 부르지 않는다. 끝나면 띄운
// core만 멈춘다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../../packages/design/components/testing.ts";

import { QuestionStrip } from "./question-strip.tsx";
import {
  RequestDrafts,
  RequestsProvider,
} from "../../desktop/lophn-space/things-to-confirm/context.tsx";
import { coreRequestSource } from "../../desktop/lophn-space/things-to-confirm/core-source.ts";
import { manualTicks } from "../../desktop/lophn-space/things-to-confirm/testdata/fake-source.ts";
import { ThingsToConfirm } from "../../desktop/lophn-space/things-to-confirm/things-to-confirm.tsx";
import { QUESTION_CORE, startRealCore } from "../../testdata/real-core.ts";
import {
  SEED_APPROVAL,
  SEED_OPTIONS,
  SEED_PROMPT,
  SEED_QUESTION,
  SEED_REASON,
  SEED_SESSION,
  SEED_WHY,
} from "../../testdata/question-seed.ts";

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

Deno.test("lophn-agent/questions#R4, R6: 실제 core에서 agent run의 질문 글을 칸이 보이고 action 없는 답이 확인 handle 없이 접수돼 질문이 닫힌다", async () => {
  const core = await startRealCore({ entry: QUESTION_CORE });
  try {
    const source = coreRequestSource(core.source, undefined);
    const ticks = manualTicks();
    using view = render(
      <RequestsProvider
        deps={{ source, drafts: new RequestDrafts(), ticks: ticks.ticks }}
      >
        <QuestionStrip session={SEED_SESSION} offline={false} />
      </RequestsProvider>,
    );
    const root = view.container;
    await until(
      "질문 글",
      () => root.querySelector("[data-question-text='ready']") !== null,
    );
    assertEquals(
      find(root, "[data-request-id]").getAttribute("data-request-id"),
      SEED_QUESTION,
    );
    assertEquals(find(root, "[data-question-text]").textContent, SEED_PROMPT);
    assertEquals(find(root, "[data-question-reason]").textContent, SEED_REASON);
    for (const option of SEED_OPTIONS) {
      assertEquals(
        find(root, `[data-option=${option.key}] [data-option-description]`)
          .textContent,
        option.description,
      );
    }
    assert(find(root, "[data-recommendation]").textContent?.includes(SEED_WHY));
    assert(!root.textContent?.includes("can't be shown here yet"));

    click(find(root, "[data-option=both]"));
    await until(
      "고른 선택지",
      () =>
        find(root, "[data-option=both]").getAttribute("aria-checked") ===
          "true",
    );
    click(find(root, "[data-send-answer]"));
    // 접수되면 다시 읽어 칸에서 빠진다.
    await until(
      "칸이 비었다",
      () => root.querySelector("[data-question-strip]") === null,
    );
    assertEquals(root.querySelector("[data-problem]"), null);

    const read = await core.source.call({
      kind: "read",
      resource: "questions",
      method: "read",
      body: { question: SEED_QUESTION },
    });
    assert(read.ok, core.log());
    const question = (read.value as {
      question: { status: string; answer: unknown; closed_seq: string | null };
    }).question;
    assertEquals(question.status, "answered");
    assertEquals(question.answer, {
      kind: "option",
      option_key: "both",
      text_blob: null,
    });
    assert(question.closed_seq !== null);
  } finally {
    await core.stop();
  }
});

Deno.test("shell/desktop#R9: 실제 core에서 things-to-confirm은 approval과 notification 목록을 읽어 보인다", async () => {
  const core = await startRealCore({ entry: QUESTION_CORE });
  try {
    const source = coreRequestSource(core.source, undefined);
    // notification은 core 안 구독 루프가 approval 생성 뒤에 만든다. 생길 때까지 기다린다.
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const unread = await source.unread();
      assert(unread.ok, core.log());
      if (unread.value.length > 0) break;
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
      [["approval", SEED_APPROVAL], ["question", SEED_QUESTION]],
    );
    assertEquals(
      overview.value.notifications.map((row) => row.sourceEvent),
      ["ApprovalRequestCreated"],
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
      assertEquals(rows.length, 1);
      assert(rows[0]!.textContent?.includes("A decision is waiting"));
      assert(rows[0]!.hasAttribute("data-unread"));
      assertEquals(root.querySelector("[data-unavailable]"), null);
    }
  } finally {
    await core.stop();
  }
});
