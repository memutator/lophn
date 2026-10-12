// 실제 core 위의 things-to-confirm. question-core.ts가 temp LOPHN_HOME의 core에서 사람 세션의
// run을 시작하고 그 run의 agent로 질문 묶음을, coding agent로 approval request를 만든다.
// 이 화면은 approval과 notification 목록을 읽어 보인다(질문 묶음은 대화 안 카드가 맡는다).
// 실제 provider는 부르지 않는다. 끝나면 띄운 core만 멈춘다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { render } from "../../../../../../packages/design/components/testing.ts";

import { RequestDrafts } from "./context.tsx";
import { coreRequestSource } from "./core-source.ts";
import { manualTicks } from "./testdata/fake-source.ts";
import { ThingsToConfirm } from "./things-to-confirm.tsx";
import { QUESTION_CORE, startRealCore } from "../../../testdata/real-core.ts";
import { SEED_APPROVAL } from "../../../testdata/question-seed.ts";

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
      [["approval", SEED_APPROVAL]],
    );
    assertEquals(
      overview.value.notifications.map((row) => row.sourceEvent),
      ["QuestionCreated", "ApprovalRequestCreated"],
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
      assertEquals(rows.length, 2);
      // 화면 목록은 최신 알림이 먼저다.
      assert(rows[0]!.textContent?.includes("A decision is waiting"));
      assert(rows[1]!.textContent?.includes("A question is waiting"));
      assert(rows[0]!.hasAttribute("data-unread"));
      assert(rows[1]!.hasAttribute("data-unread"));
      assertEquals(root.querySelector("[data-unavailable]"), null);
    }
  } finally {
    await core.stop();
  }
});
