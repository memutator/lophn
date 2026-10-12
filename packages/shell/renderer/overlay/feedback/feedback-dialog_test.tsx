import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
  settle,
  unmountSettled,
} from "../../../../design/components/testing.ts";
import { t } from "@lophn/wording";

import {
  FEEDBACK_PROBLEM_MESSAGE,
  type FeedbackAccepted,
  type FeedbackPreview,
  type FeedbackSelection,
  type LophnOverlayFeedback,
} from "../../../ipc/feedback.ts";
import { FeedbackDialog } from "./feedback-dialog.tsx";

const HASH = "ab".repeat(32);
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const PROBLEM = "prb_01j9zzzzzzzzzzzzzzzzzzzzzz";
const REPORT = "rpt_01j9zzzzzzzzzzzzzzzzzzzzzz";

function fakeApi() {
  const listeners = new Set<(preview: FeedbackPreview) => void>();
  const calls: unknown[][] = [];
  let reply: () => Promise<FeedbackAccepted> = () =>
    Promise.resolve({ report: REPORT, problem: PROBLEM });
  const api: LophnOverlayFeedback = {
    submitFeedback(draftRef, text, selection: FeedbackSelection) {
      calls.push(["submit", draftRef, text, selection]);
      return reply();
    },
    cancelFeedback(draftRef) {
      calls.push(["cancel", draftRef]);
      return Promise.resolve();
    },
    openFeedbackIssue(draftRef) {
      calls.push(["issue", draftRef]);
      return Promise.resolve();
    },
    subscribePreview(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    api,
    calls,
    reply(next: () => Promise<FeedbackAccepted>) {
      reply = next;
    },
    async preview(value: Partial<FeedbackPreview>) {
      act(() => {
        for (const listener of listeners) {
          listener({
            draftRef: "draft-1",
            text: null,
            screen: HASH,
            screen_missing_reason: null,
            screenshot: null,
            screenshot_png: null,
            screenshot_block: "pending",
            screen_summary: { name: "Orders", path: "/orders/index.html" },
            ...value,
          });
        }
      });
      await settle();
    },
  };
}

function mount(api: LophnOverlayFeedback) {
  const host = document.createElement("section");
  document.body.append(host);
  const view = render(
    <FeedbackDialog
      draftRef="draft-1"
      api={api}
      host={host}
      clipboard={{ writeText: () => Promise.resolve() }}
    />,
  );
  return {
    host,
    find(selector: string): HTMLElement {
      const found = host.querySelector(selector);
      if (!found) throw new Error(`no element for ${selector}`);
      return found as HTMLElement;
    },
    async done() {
      await unmountSettled(view);
      host.remove();
    },
  };
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

async function press(element: HTMLElement): Promise<void> {
  click(element);
  await settle();
}

Deno.test("problems/feedback#R6: 캡처한 PNG를 가리지 않고 그대로 보이고 screenshot은 기본 꺼짐이라 사람이 켠 때만 보낸다", async () => {
  const fake = fakeApi();
  const dialog = mount(fake.api);
  await fake.preview({
    screenshot: HASH,
    screenshot_png: PNG,
    screenshot_block: null,
  });
  const image = dialog.find("[data-feedback=screenshot-preview]");
  assertEquals(image.getAttribute("src"), PNG);
  const shot = dialog.find("[data-feedback=screenshot] [role=checkbox]");
  assertEquals(shot.getAttribute("aria-checked"), "false");
  // 화면 상태는 이름과 위치만 미리 보이고 기본으로 보낸다.
  assert(dialog.host.textContent?.includes("/orders/index.html"));
  write(dialog.find("textarea"), "Totals are wrong.");
  await press(dialog.find("[data-feedback=send]"));
  assertEquals(fake.calls[0], [
    "submit",
    "draft-1",
    "Totals are wrong.",
    { screen: true, screenshot: false },
  ]);
  await dialog.done();

  const chosen = fakeApi();
  const second = mount(chosen.api);
  await chosen.preview({
    screenshot: HASH,
    screenshot_png: PNG,
    screenshot_block: null,
  });
  await press(second.find("[data-feedback=screenshot] [role=checkbox]"));
  await press(second.find("[data-feedback=screen] [role=checkbox]"));
  write(second.find("textarea"), "Totals are wrong.");
  await press(second.find("[data-feedback=send]"));
  assertEquals(chosen.calls[0]?.[3], { screen: false, screenshot: true });
  await second.done();
});

Deno.test("problems/feedback#R5, R10: 이미지가 없으면 그 이유를 보이고 고를 수 없으며 글만 보낼 수 있다", async () => {
  for (
    const [block, key] of [
      ["pending", "report-problem.notice.capturing"],
      ["hidden", "report-problem.notice.screenshot-hidden"],
      ["protected_window", "report-problem.notice.screenshot-protected"],
      ["capture_failed", "report-problem.notice.screenshot-failed"],
    ] as const
  ) {
    const fake = fakeApi();
    const dialog = mount(fake.api);
    await fake.preview({ screenshot_block: block });
    const reason = dialog.find("[data-feedback=screenshot-reason]");
    assertEquals(reason.textContent, t(key));
    const shot = dialog.find("[data-feedback=screenshot] [role=checkbox]");
    assert(shot.hasAttribute("disabled"), block);
    assertEquals(
      dialog.host.querySelector("[data-feedback=screenshot-preview]"),
      null,
    );
    write(dialog.find("textarea"), "The page froze.");
    await press(dialog.find("[data-feedback=send]"));
    assertEquals(fake.calls[0]?.[3], { screen: true, screenshot: false });
    await dialog.done();
  }
});

Deno.test("problems/feedback#R11, shell/wording#R8: 접수 실패는 완료 표시 없이 이유와 복사할 글을 남기고 접수 대기·완료를 구별한다", async () => {
  const fake = fakeApi();
  let resolve: (value: FeedbackAccepted) => void = () => {};
  fake.reply(() => Promise.reject(new Error("unavailable")));
  const dialog = mount(fake.api);
  await fake.preview({ screenshot_block: "capture_failed" });
  // 빈 글은 보낼 수 없다.
  assert(dialog.find("[data-feedback=send]").hasAttribute("disabled"));
  write(dialog.find("textarea"), "Saving does nothing.");
  await press(dialog.find("[data-feedback=send]"));
  const failed = dialog.find("[data-feedback=failed]");
  assert(failed.textContent?.includes(t("report-problem.error.unreachable")));
  assertEquals(
    dialog.host.querySelector("[data-feedback=received]"),
    null,
  );
  assertEquals(
    (dialog.find("textarea") as HTMLTextAreaElement).value,
    "Saving does nothing.",
  );
  assert(failed.querySelector("button"), "copy button is missing");
  // 다시 보내면 접수 대기를 보이고, 접수되면 완료와 problems 문구를 보인다.
  fake.reply(() => new Promise((done) => resolve = done));
  click(dialog.find("[data-feedback=send]"));
  await settle();
  assertEquals(
    dialog.find("[data-feedback-phase]").dataset.feedbackPhase,
    "sending",
  );
  assert(dialog.host.textContent?.includes(t("report-problem.status.sending")));
  await act(async () => {
    resolve({ report: REPORT, problem: PROBLEM });
    await Promise.resolve();
  });
  await settle();
  const received = dialog.find("[data-feedback=received]");
  assert(received.textContent?.includes(t("report-problem.status.received")));
  assert(received.textContent?.includes(FEEDBACK_PROBLEM_MESSAGE));
  // 안내에는 ID·code·원문 오류가 없다.
  for (const raw of [REPORT, PROBLEM, "draft-1", "unavailable"]) {
    assert(!dialog.host.textContent?.includes(raw), raw);
  }
  await dialog.done();
});

Deno.test("shell#T53: Issues에서 고른 문제로 연 보고는 기존 문제에 덧붙는다고 말한다", async () => {
  const fake = fakeApi();
  const view = mount(fake.api);
  await fake.preview({ existing_issue: true });
  assertEquals(
    view.find("[data-feedback=existing-issue]").textContent,
    t("report-problem.notice.existing-issue"),
  );
});

Deno.test("problems/feedback#R12, R13: 기존 문제 선택 여부를 보이고 취소는 저장하지 않으며 접수 뒤 묶인 Issue로 간다", async () => {
  const cancelled = fakeApi();
  const first = mount(cancelled.api);
  await cancelled.preview({});
  assertEquals(
    first.find("[data-feedback=existing-issue]").textContent,
    t("report-problem.notice.new-issue"),
  );
  write(first.find("textarea"), "Not sent.");
  await press(
    [...first.host.querySelectorAll("button")].find((button) =>
      button.textContent === t("common.button.cancel")
    )!,
  );
  assertEquals(cancelled.calls, [["cancel", "draft-1"]]);
  await first.done();

  const fake = fakeApi();
  const dialog = mount(fake.api);
  await fake.preview({});
  write(dialog.find("textarea"), "Wrong total.");
  await press(dialog.find("[data-feedback=send]"));
  await press(dialog.find("[data-feedback=view-issue]"));
  assertEquals(fake.calls.at(-1), ["issue", "draft-1"]);
  await dialog.done();
});
