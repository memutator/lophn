import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../../packages/design/components/testing.ts";

import { Dock } from "../dock.tsx";
import { DraftStore } from "../drafts.ts";
import {
  fakeSource as fakeConversation,
  manualTicks as conversationTicks,
} from "../testdata/fake-source.ts";
import { QuestionStrip } from "./question-strip.tsx";
import {
  RequestDrafts,
  RequestsProvider,
} from "../../desktop/lophn-space/things-to-confirm/context.tsx";
import {
  approval,
  approvalId,
  fakeRequests,
  manualTicks,
  question,
  questionId,
  questionText,
  sessionOf,
} from "../../desktop/lophn-space/things-to-confirm/testdata/fake-source.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found as HTMLElement;
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

function strip(
  fake: ReturnType<typeof fakeRequests>,
  options: { offline?: boolean; drafts?: RequestDrafts } = {},
) {
  const ticks = manualTicks();
  return {
    ticks,
    node: (
      <RequestsProvider
        deps={{
          source: fake.source,
          drafts: options.drafts ?? new RequestDrafts(),
          ticks: ticks.ticks,
          now: () => NOW,
        }}
      >
        <QuestionStrip
          session={sessionOf(1)}
          offline={options.offline ?? false}
        />
      </RequestsProvider>
    ),
  };
}

function nothingSent(fake: ReturnType<typeof fakeRequests>): void {
  assertEquals(fake.state.answered, []);
  assertEquals(fake.state.deferred, []);
  assertEquals(fake.state.cancelled, []);
  assertEquals(fake.state.reviewed, []);
  assertEquals(fake.state.marked, []);
}

Deno.test("shell/desktop#R6: 질문·approval 칸은 대화 입력 바로 위 하나이고 이 세션의 요청만 보인다", async () => {
  const requests = fakeRequests({
    requests: [
      question(1),
      question(2, { session: sessionOf(2) }),
      question(3, { session: null }),
    ],
  });
  const conversation = fakeConversation();
  using view = render(
    <RequestsProvider
      deps={{
        source: requests.source,
        drafts: new RequestDrafts(),
        ticks: manualTicks().ticks,
        now: () => NOW,
      }}
    >
      <Dock
        source={conversation.source}
        drafts={new DraftStore()}
        placement="docked"
        workPlace={{ kind: "global", id: null }}
        onClose={() => {}}
        ticks={conversationTicks().ticks}
        now={() => NOW}
      />
    </RequestsProvider>,
  );
  await flush();
  const strips = view.container.querySelectorAll("[data-question-strip]");
  assertEquals(strips.length, 1);
  const section = strips[0] as HTMLElement;
  // 칸 바로 다음이 대화 입력이다.
  const composer = find(view.container, "[data-composer-input]");
  const next = section.nextElementSibling as HTMLElement;
  assert(next.contains(composer), "the strip is not right above the composer");
  assertEquals(find(section, "[data-position]").textContent, "1 of 1");
  assertEquals(
    find(section, "[data-request-id]").getAttribute("data-request-id"),
    questionId(1),
  );
});

Deno.test("shell/desktop#R6: run을 멈춘 요청이 먼저 오고 앞뒤로 오가도 아무것도 보내지 않는다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1),
      approval(2),
      question(3, { blocking: true }),
    ],
  });
  const { node, ticks } = strip(fake);
  using view = render(node);
  await flush();
  const section = find(view.container, "[data-question-strip]");
  const shown = () =>
    find(section, "[data-request-id]").getAttribute("data-request-id");
  assertEquals(find(section, "[data-position]").textContent, "1 of 3");
  assertEquals(shown(), questionId(3));
  assert(section.querySelector("[data-blocking]"), "blocking is not marked");
  const previous = find(section, "[data-previous-request]");
  const next = find(section, "[data-next-request]");
  assertEquals(previous.getAttribute("aria-label"), "Previous request");
  assertEquals(previous.textContent, "");
  assertEquals((previous as HTMLButtonElement).disabled, true);
  click(next);
  await flush();
  assertEquals(shown(), questionId(1));
  assertEquals(find(section, "[data-position]").textContent, "2 of 3");
  click(next);
  await flush();
  assertEquals(shown(), approvalId(2));
  assertEquals((next as HTMLButtonElement).disabled, true);
  click(previous);
  click(previous);
  await flush();
  assertEquals(shown(), questionId(3));
  // 다시 읽어도 같은 요청을 계속 가리킨다.
  click(next);
  ticks.tick();
  await flush();
  assertEquals(shown(), questionId(1));
  nothingSent(fake);
});

Deno.test("lophn-agent/questions#R4: 선택지를 고르는 것만으로는 답이 아니고 명시한 보내기만 그 선택지를 답한다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  const options = view.container.querySelectorAll("[role=radio]");
  assertEquals(
    [...options].map((option) => option.textContent),
    [
      "Keep both filesAbout: Keep both filesRecommended",
      "Merge themAbout: Merge them",
    ],
  );
  const send = find(view.container, "[data-send-answer]") as HTMLButtonElement;
  assertEquals(send.getAttribute("aria-label"), "Send answer");
  assertEquals(send.disabled, true);
  click(options[1]!);
  await flush();
  assertEquals(options[1]!.getAttribute("aria-checked"), "true");
  nothingSent(fake);
  click(send);
  await flush();
  assertEquals(fake.state.answered, [{
    question: questionId(1),
    answer: { kind: "option", option: "merge" },
  }]);
  // 접수되면 칸에서 빠진다.
  assertEquals(view.container.querySelector("[data-question-strip]"), null);
});

Deno.test("lophn-agent/questions#R4: 칸은 질문 본문·이유·선택지 설명·추천 이유를 core가 둔 글로 보인다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  fake.state.texts[questionId(1)] = questionText(question(1), {
    prompt: "Which copy of <b>notes</b> should stay?",
    reason: "Both copies changed.\nThe newer one has numbers.",
    options: new Map([["keep", "Nothing is deleted."]]),
    recommendation: "Nothing is lost.",
  });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  const prompt = find(view.container, "[data-question-text]");
  assertEquals(prompt.getAttribute("data-question-text"), "ready");
  // agent가 쓴 글은 글자로만 그린다.
  assertEquals(prompt.textContent, "Which copy of <b>notes</b> should stay?");
  assertEquals(prompt.querySelector("b"), null);
  assertEquals(
    find(view.container, "[data-question-reason]").textContent,
    "Both copies changed.\nThe newer one has numbers.",
  );
  assertEquals(
    find(view.container, "[data-option=keep] [data-option-description]")
      .textContent,
    "Nothing is deleted.",
  );
  // 설명이 없는 선택지는 이름만 둔다.
  assertEquals(
    view.container.querySelector(
      "[data-option=merge] [data-option-description]",
    ),
    null,
  );
  assertEquals(
    find(view.container, "[data-recommendation]").textContent,
    "Why it's recommendedNothing is lost.",
  );
  assertEquals(
    view.container.textContent?.includes("can't be shown here yet"),
    false,
  );
  nothingSent(fake);
});

Deno.test("lophn-agent/questions#R4: 질문 글을 읽지 못하면 그렇다고 말하고 선택지 답은 그대로 보낼 수 있다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  fake.state.texts[questionId(1)] = null;
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  const prompt = find(view.container, "[data-question-text]");
  assertEquals(prompt.getAttribute("data-question-text"), "failed");
  assertEquals(prompt.textContent, "Couldn't load this question's text.");
  assertEquals(view.container.querySelector("[data-recommendation]"), null);
  click(find(view.container, "[data-option=keep]"));
  await flush();
  click(find(view.container, "[data-send-answer]"));
  await flush();
  assertEquals(fake.state.answered, [{
    question: questionId(1),
    answer: { kind: "option", option: "keep" },
  }]);
});

Deno.test("lophn-agent/questions#R3: 상한을 넘는 자유 답과 취소 이유는 보내지 않고 쓴 글을 그대로 둔다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  const long = "가".repeat(11_000); // 33,000 bytes
  write(find(view.container, "[data-own-answer]"), long);
  await flush();
  assertEquals(
    (find(view.container, "[data-send-answer]") as HTMLButtonElement).disabled,
    true,
  );
  assertEquals(
    find(view.container, "[data-too-long]").textContent,
    "This is too long to send. Shorten it.",
  );
  assertEquals(
    (find(view.container, "[data-own-answer]") as HTMLTextAreaElement).value,
    long,
  );
  click(find(view.container, "[data-cancel-question]"));
  await flush();
  write(find(view.container, "[data-cancel-reason]"), long);
  await flush();
  assertEquals(
    (find(view.container, "[data-confirm-cancel]") as HTMLButtonElement)
      .disabled,
    true,
  );
  nothingSent(fake);
});

Deno.test("lophn-agent/questions#R3: 선택지가 있어도 자유 답을 쓸 수 있고 쓰면 고른 선택지가 풀린다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  click(view.container.querySelectorAll("[role=radio]")[0]!);
  await flush();
  write(find(view.container, "[data-own-answer]"), "   ");
  await flush();
  const send = find(view.container, "[data-send-answer]") as HTMLButtonElement;
  assertEquals(send.disabled, true, "blank text is not an answer");
  write(find(view.container, "[data-own-answer]"), "Keep the newer one");
  await flush();
  assertEquals(
    view.container.querySelectorAll("[aria-checked=true]").length,
    0,
  );
  click(send);
  await flush();
  assertEquals(fake.state.answered, [{
    question: questionId(1),
    answer: { kind: "text", text: "Keep the newer one" },
  }]);
});

Deno.test("lophn-agent/questions#R6: 미루기와 취소는 답이 아닌 따로 닫는 요청이고 취소는 이유를 받는다", async () => {
  const fake = fakeRequests({ requests: [question(1), question(2)] });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  const later = find(view.container, "[data-later]");
  assertEquals(later.getAttribute("aria-label"), "Answer later");
  click(later);
  await flush();
  assertEquals(fake.state.deferred, [questionId(1)]);
  assertEquals(fake.state.answered, []);
  click(find(view.container, "[data-cancel-question]"));
  await flush();
  const confirm = find(
    view.container,
    "[data-confirm-cancel]",
  ) as HTMLButtonElement;
  assertEquals(confirm.disabled, true);
  write(find(view.container, "[data-cancel-reason]"), "Not needed anymore");
  await flush();
  click(confirm);
  await flush();
  assertEquals(fake.state.cancelled, [{
    question: questionId(2),
    reason: "Not needed anymore",
  }]);
  assertEquals(fake.state.answered, []);
});

Deno.test("shell/desktop#R6: action 있는 선택지와 approval은 [Review]로 confirmation window를 열 뿐 답이나 승인을 보내지 않는다", async () => {
  const fake = fakeRequests({
    requests: [
      question(1, {
        options: [
          { key: "move", label: "Move it to Notes", action: true },
          { key: "stay", label: "Leave it", action: false },
        ],
        recommended: "move",
      }),
      approval(2),
    ],
  });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  const move = find(view.container, "[data-option=move]");
  assert(move.querySelector("[data-opens-review]"));
  click(move);
  await flush();
  assertEquals(view.container.querySelector("[data-send-answer]"), null);
  const review = find(view.container, "[data-review]");
  assertEquals(review.getAttribute("aria-label"), "Review");
  assertEquals(review.textContent, "");
  click(review);
  await flush();
  assertEquals(fake.state.reviewed, [{
    kind: "question_option_action",
    question: questionId(1),
    option_key: "move",
  }]);
  assertEquals(fake.state.answered, []);
  click(find(view.container, "[data-next-request]"));
  await flush();
  click(find(view.container, "[data-review]"));
  await flush();
  assertEquals(fake.state.reviewed[1], {
    kind: "approval_request",
    approval: approvalId(2),
  });
  assertEquals(fake.state.answered, []);
});

Deno.test("shell/desktop#R6: 이 창에서 보호 창을 열 수 없으면 그렇다고 말하고 다른 길로 결정을 보내지 않는다", async () => {
  const fake = fakeRequests({ requests: [approval(1)], reviewOpens: false });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  click(find(view.container, "[data-review]"));
  await flush();
  assertEquals(
    find(view.container, "[data-problem]").textContent,
    "The review window can't open here yet.",
  );
  assertEquals(fake.state.answered, []);
});

Deno.test("shell/desktop#R8: 고른 답과 쓰던 글은 칸을 오가도 남는다", async () => {
  const fake = fakeRequests({ requests: [question(1), question(2)] });
  const drafts = new RequestDrafts();
  const { node } = strip(fake, { drafts });
  using view = render(node);
  await flush();
  click(find(view.container, "[data-option=merge]"));
  await flush();
  click(find(view.container, "[data-next-request]"));
  await flush();
  write(find(view.container, "[data-own-answer]"), "Second answer");
  await flush();
  click(find(view.container, "[data-previous-request]"));
  await flush();
  assertEquals(
    find(view.container, "[data-option=merge]").getAttribute("aria-checked"),
    "true",
  );
  click(find(view.container, "[data-next-request]"));
  await flush();
  assertEquals(
    (find(view.container, "[data-own-answer]") as HTMLTextAreaElement).value,
    "Second answer",
  );
  nothingSent(fake);
});

Deno.test("shell/desktop#R7: 끊기면 칸을 그대로 두고 보내기를 막는다", async () => {
  const fake = fakeRequests({ requests: [question(1)] });
  const { node } = strip(fake, { offline: true });
  using view = render(node);
  await flush();
  click(find(view.container, "[data-option=keep]"));
  await flush();
  assertEquals(
    (find(view.container, "[data-send-answer]") as HTMLButtonElement).disabled,
    true,
  );
  assertEquals(
    (find(view.container, "[data-later]") as HTMLButtonElement).disabled,
    true,
  );
});

Deno.test("lophn-agent/questions#R9: 이미 닫혔거나 바뀐 질문의 답은 새 결정으로 보이지 않고 최신 기록으로 맞춘다", async () => {
  const fake = fakeRequests({
    requests: [question(1)],
    replies: [{ ok: false, code: "conflict" }],
  });
  const { node } = strip(fake);
  using view = render(node);
  await flush();
  const reads = fake.state.reads;
  click(find(view.container, "[data-option=keep]"));
  await flush();
  click(find(view.container, "[data-send-answer]"));
  await flush();
  assertEquals(
    find(view.container, "[data-problem]").textContent,
    "This changed since you opened it. Showing the latest.",
  );
  assert(fake.state.reads > reads, "the strip did not read the latest");
});
