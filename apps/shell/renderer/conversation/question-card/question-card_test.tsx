// 질문 묶음 카드와 답한 요약(agent-I25). props와 fake만으로 그린다. 보이는 말·순서·role·data-*·
// callback과 그 인자를 단언하고 CSS는 단언하지 않는다.
//
// 약속한 hook:
// - 카드 [data-question-card], 질문 [role=radiogroup][data-question=<질문 id>]
// - 선택지 [role=radio][data-option=<key>] (aria-checked), Other [role=radio][data-option-other]
//   안의 입력칸(aria-label "Type your own answer: <prompt>")
// - 추천 표시 [data-recommended](텍스트 "(Recommended)"), 추천 이유 [data-recommendation]
// - 넘김 [data-question-progress]("1 of 4"), 버튼 이름 Back·Next·Skip·Submit
// - 기한 [data-question-expiry], 카드 머리의 Details 단추(aria-expanded)와 이유 [data-question-reason]
// - 요약 [data-answered-summary][data-status=<상태>]
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  one,
  press,
  render,
} from "../../../../../packages/design/components/testing.ts";

import { AnsweredSummary } from "./answered-summary.tsx";
import { QuestionCard } from "./question-card.tsx";
import type { GroupAnswer, QuestionGroupView } from "./model.ts";
import {
  expiringGroup,
  NOW,
  numberedGroup,
  QUESTION_PLACE,
  QUESTION_REGRESSIONS,
  REPORT_ANSWERS,
  REPORT_GROUP,
} from "../testdata/question-card.ts";
import { questionContract } from "../testdata/question-contract.ts";

function text(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) =>
    text(candidate) === name || candidate.getAttribute("aria-label") === name
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

function option(root: ParentNode, question: string, key: string): HTMLElement {
  return one(root, `[data-question="${question}"] [data-option="${key}"]`);
}

function checked(root: ParentNode): string[] {
  return [...root.querySelectorAll("[role=radio][aria-checked=true]")].map(
    (element) =>
      element.getAttribute("data-option") ??
        (element.hasAttribute("data-option-other") ? "other" : "?"),
  );
}

function other(root: ParentNode, question: string): HTMLInputElement {
  return one(
    root,
    `[data-question="${question}"] [data-option-other] input`,
  ) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

interface Calls {
  submitted: (readonly GroupAnswer[])[];
  skipped: number;
}

function renderCard(group: QuestionGroupView) {
  const calls: Calls = { submitted: [], skipped: 0 };
  const view = render(
    <QuestionCard
      group={group}
      now={NOW}
      onSubmit={(answers) => calls.submitted.push(answers)}
      onSkip={() => calls.skipped += 1}
    />,
  );
  return { view, calls, card: one(view.container, "[data-question-card]") };
}

Deno.test("shell/desktop#R46 [agent-I25]: 질문 둘은 한 카드에 모두 펼치고 agent 이름·선택지 설명·번호·Other·Skip·Submit과 일이 멈춘다는 말을 보인다", () => {
  const { view, card } = renderCard(REPORT_GROUP);
  using _ = view;
  assertEquals(
    view.container.querySelectorAll("[data-question-card]").length,
    1,
  );
  const prompts = [...card.querySelectorAll("[role=radiogroup]")].map((group) =>
    group.getAttribute("aria-label")
  );
  assertEquals(prompts, [QUESTION_PLACE.prompt, QUESTION_REGRESSIONS.prompt]);
  assert(text(card).includes("Context Engineer is asking 2 questions"));
  assertEquals(card.querySelector("[data-question-progress]"), null);
  // 선택지 설명과 번호 키 표시(Other는 선택지 다음 번호).
  assert(
    text(option(card, QUESTION_PLACE.id, "eval")).includes(
      "inside the eval folder",
    ),
  );
  assertEquals(
    [...card.querySelectorAll(`[data-question="${QUESTION_PLACE.id}"] kbd kbd`)]
      .map(text),
    ["1", "2", "3", "4"],
  );
  assertEquals(card.querySelectorAll("[data-option-other]").length, 2);
  assert(text(card).includes("Work is paused until you answer"));
  button(card, "Skip");
  button(card, "Submit");
});

Deno.test("lophn-agent/questions#R3 [agent-I25]: 추천은 선택지 하나의 (Recommended)와 이유로 보이고 자동 선택하지 않으며 Submit은 막혀 있다", () => {
  const { view, card } = renderCard(REPORT_GROUP);
  using _ = view;
  const marks = [...card.querySelectorAll("[data-recommended]")];
  assertEquals(marks.map(text), ["(Recommended)", "(Recommended)"]);
  assertEquals(
    marks.map((mark) =>
      mark.closest("[data-option]")?.getAttribute("data-option")
    ),
    ["reports", "yes"],
  );
  assertEquals(
    [...card.querySelectorAll("[data-recommendation]")].map(text),
    [
      QUESTION_PLACE.recommendation!.explanation,
      QUESTION_REGRESSIONS.recommendation!.explanation,
    ],
  );
  assertEquals(checked(card), []);
  assertEquals(button(card, "Submit").disabled, true);
});

Deno.test("shell/desktop#R46 [agent-I25]: 질문 셋은 한 카드에 모두 펼치고 넷은 1 of 4로 하나씩 넘긴다", () => {
  {
    const { view, card } = renderCard(numberedGroup(3));
    using _ = view;
    assertEquals(card.querySelectorAll("[role=radiogroup]").length, 3);
    assertEquals(card.querySelector("[data-question-progress]"), null);
  }
  const { view, card } = renderCard(numberedGroup(4));
  using _ = view;
  const shown = () =>
    [...card.querySelectorAll("[role=radiogroup]")].map((group) =>
      group.getAttribute("aria-label")
    );
  assertEquals(text(one(card, "[data-question-progress]")), "1 of 4");
  assertEquals(shown(), ["Question 1?"]);
  click(button(card, "Next"));
  assertEquals(text(one(card, "[data-question-progress]")), "2 of 4");
  assertEquals(shown(), ["Question 2?"]);
  click(button(card, "Back"));
  assertEquals(shown(), ["Question 1?"]);
});

Deno.test("shell/desktop#R46 [agent-I25]: 넘기며 한 답은 되돌아와도 남고 마지막 질문에서 Submit이 네 답을 질문 순서대로 한 번에 보낸다", () => {
  const group = numberedGroup(4);
  const { view, calls, card } = renderCard(group);
  using _ = view;
  press(card, "1");
  assertEquals(checked(card), ["a"]);
  click(button(card, "Next"));
  assertEquals(checked(card), []);
  click(button(card, "Back"));
  assertEquals(checked(card), ["a"]);
  click(button(card, "Next"));
  press(card, "2");
  click(button(card, "Next"));
  press(card, "3");
  click(button(card, "Next"));
  assertEquals(button(card, "Submit").disabled, true);
  press(card, "1");
  assertEquals(button(card, "Submit").disabled, false);
  click(button(card, "Submit"));
  assertEquals(calls.submitted, [[
    {
      question: group.questions[0].id,
      answer: { kind: "option", option_key: "a" },
    },
    {
      question: group.questions[1].id,
      answer: { kind: "option", option_key: "b" },
    },
    {
      question: group.questions[2].id,
      answer: { kind: "option", option_key: "c" },
    },
    {
      question: group.questions[3].id,
      answer: { kind: "option", option_key: "a" },
    },
  ]]);
});

Deno.test("shell/desktop#R46 [agent-I25]: 번호 키는 누른 자리가 속한 질문(없으면 첫 미답 질문)의 선택지를 고르고 선택지 수 다음 번호는 Other를 고르며 Other 입력칸 안의 숫자는 고르지 않는다", () => {
  const { view, card } = renderCard(REPORT_GROUP);
  using _ = view;
  press(card, "2");
  assertEquals(checked(card), ["eval"]);
  // 첫 질문이 답해졌으므로 자리 없는 번호 키는 첫 미답인 둘째 질문에 간다.
  press(card, "1");
  assertEquals(checked(card), ["eval", "yes"]);
  // 둘째 질문 안에서 누르면 그 질문이다. 선택지가 둘이라 3번이 Other다.
  press(option(card, QUESTION_REGRESSIONS.id, "yes"), "3");
  assertEquals(checked(card), ["eval", "other"]);
  press(option(card, QUESTION_PLACE.id, "eval"), "1");
  assertEquals(checked(card), ["reports", "other"]);
  // Other 입력칸에 쓰는 숫자는 번호 키가 아니다.
  press(other(card, QUESTION_REGRESSIONS.id), "1");
  assertEquals(checked(card), ["reports", "other"]);
});

Deno.test("lophn-agent/questions#R4 [agent-I25]: 선택만으로는 보내지 않고 모든 질문에 답해야 Submit이 되며 그때 답 전부를 질문 순서대로 한 번에 보낸다", async () => {
  const { view, calls, card } = renderCard(REPORT_GROUP);
  using _ = view;
  click(option(card, QUESTION_PLACE.id, "reports"));
  assertEquals(calls.submitted, []);
  assertEquals(button(card, "Submit").disabled, true);
  click(button(card, "Submit"));
  assertEquals(calls.submitted, []);
  click(option(card, QUESTION_REGRESSIONS.id, "no"));
  assertEquals(button(card, "Submit").disabled, false);
  click(button(card, "Submit"));
  const expected: GroupAnswer[] = [
    {
      question: QUESTION_PLACE.id,
      answer: { kind: "option", option_key: "reports" },
    },
    {
      question: QUESTION_REGRESSIONS.id,
      answer: { kind: "option", option_key: "no" },
    },
  ];
  assertEquals(calls.submitted, [expected]);
  assertEquals(calls.skipped, 0);
  // 넘기는 값이 AnswerQuestionGroup 입력의 answers 칸과 같은 모양이다.
  const contract = await questionContract();
  assert(
    contract.answerQuestionGroupInputSchema.safeParse({
      group: REPORT_GROUP.id,
      created_seq: 1,
      answers: calls.submitted[0],
    }).success,
  );
});

Deno.test("lophn-agent/questions#R3 [agent-I25]: Other에 쓴 글은 자유 답으로 가고 빈 글은 답이 아니며 Other 입력칸에 초점을 두면 그 질문의 Other가 골라진다", () => {
  const { view, calls, card } = renderCard(REPORT_GROUP);
  using _ = view;
  click(option(card, QUESTION_PLACE.id, "ask"));
  const input = other(card, QUESTION_REGRESSIONS.id);
  act(() => input.focus());
  assertEquals(checked(card), ["ask", "other"]);
  // 글이 비어 있으면 Other는 답이 아니다.
  assertEquals(button(card, "Submit").disabled, true);
  type(input, "   ");
  assertEquals(button(card, "Submit").disabled, true);
  type(input, "Only the top three");
  assertEquals(button(card, "Submit").disabled, false);
  click(button(card, "Submit"));
  assertEquals(calls.submitted, [[
    {
      question: QUESTION_PLACE.id,
      answer: { kind: "option", option_key: "ask" },
    },
    {
      question: QUESTION_REGRESSIONS.id,
      answer: { kind: "text", text: "Only the top three" },
    },
  ]]);
});

Deno.test("lophn-agent/questions#R6 [agent-I25]: Skip은 묶음을 미룰 뿐 답을 보내지 않는다", () => {
  const { view, calls, card } = renderCard(REPORT_GROUP);
  using _ = view;
  click(option(card, QUESTION_PLACE.id, "reports"));
  click(button(card, "Skip"));
  assertEquals(calls.skipped, 1);
  assertEquals(calls.submitted, []);
});

Deno.test("shell/desktop#R46 [agent-I25]: disabled이면 Skip과 Submit이 막힌다", () => {
  const calls: Calls = { submitted: [], skipped: 0 };
  using view = render(
    <QuestionCard
      group={REPORT_GROUP}
      now={NOW}
      disabled
      onSubmit={(answers) => calls.submitted.push(answers)}
      onSkip={() => calls.skipped += 1}
    />,
  );
  const card = one(view.container, "[data-question-card]");
  assertEquals(button(card, "Skip").disabled, true);
  assertEquals(button(card, "Submit").disabled, true);
});

Deno.test("shell/desktop#R46 [agent-I25]: 답한 요약은 Answered 2 questions: 뒤에 질문 순서대로 고른 선택지 이름이나 쓴 글을 한 줄로 보인다", () => {
  using view = render(
    <AnsweredSummary
      group={REPORT_GROUP}
      status="answered"
      answers={REPORT_ANSWERS}
    />,
  );
  const summary = one(view.container, "[data-answered-summary]");
  assertEquals(text(summary), "Answered 2 questions: docs/reports/ · Yes");
  view.rerender(
    <AnsweredSummary
      group={REPORT_GROUP}
      status="answered"
      answers={[
        REPORT_ANSWERS[0],
        {
          question: QUESTION_REGRESSIONS.id,
          answer: { kind: "text", text: "Only the top three" },
        },
      ]}
    />,
  );
  assertEquals(
    text(one(view.container, "[data-answered-summary]")),
    "Answered 2 questions: docs/reports/ · Only the top three",
  );
});

Deno.test("shell/desktop#R46 [agent-I25]: 질문이 하나면 요약은 Answered 1 question:이다", () => {
  const group: QuestionGroupView = {
    ...REPORT_GROUP,
    questions: [QUESTION_PLACE],
  };
  using view = render(
    <AnsweredSummary
      group={group}
      status="answered"
      answers={[REPORT_ANSWERS[0]]}
    />,
  );
  assertEquals(
    text(one(view.container, "[data-answered-summary]")),
    "Answered 1 question: docs/reports/",
  );
});

function details(card: ParentNode): HTMLButtonElement {
  return button(card, "Details");
}

Deno.test("lophn-agent/questions#R4 [agent-I25]: 기한이 있으면 기본 화면에 남은 시간을 보이고 없으면 보이지 않는다", () => {
  const hours = renderCard(expiringGroup(2 * 3_600_000 + 5 * 60_000));
  using _hours = hours.view;
  assertEquals(
    text(one(hours.card, "[data-question-expiry]")),
    "Expires in 2h 5m",
  );
  const minutes = renderCard(expiringGroup(45 * 60_000));
  using _minutes = minutes.view;
  assertEquals(
    text(one(minutes.card, "[data-question-expiry]")),
    "Expires in 45m",
  );
  const none = renderCard(REPORT_GROUP);
  using _none = none.view;
  assertEquals(none.card.querySelector("[data-question-expiry]"), null);
});

Deno.test("lophn-agent/questions#R4 [agent-I25]: 자세한 이유는 기본 화면에 없고 카드 머리의 Details를 펼치면 보인다", () => {
  const { view, card } = renderCard(REPORT_GROUP);
  using _ = view;
  assertEquals(details(card).getAttribute("aria-expanded"), "false");
  assertEquals(card.querySelector("[data-question-reason]"), null);
  assert(!text(card).includes(QUESTION_PLACE.reason));
  click(details(card));
  assertEquals(details(card).getAttribute("aria-expanded"), "true");
  assertEquals(
    [...card.querySelectorAll("[data-question-reason]")].map(text),
    [QUESTION_PLACE.reason, QUESTION_REGRESSIONS.reason],
  );
  click(details(card));
  assertEquals(card.querySelector("[data-question-reason]"), null);
});

Deno.test("lophn-agent/questions#R4 [agent-I25]: 하나씩 넘기는 카드는 보이는 질문의 이유만 Details로 보인다", () => {
  const group = numberedGroup(4);
  const { view, card } = renderCard(group);
  using _ = view;
  click(details(card));
  assertEquals(
    [...card.querySelectorAll("[data-question-reason]")].map(text),
    ["Reason 1"],
  );
  click(button(card, "Next"));
  assertEquals(
    [...card.querySelectorAll("[data-question-reason]")].map(text),
    ["Reason 2"],
  );
});

Deno.test("lophn-agent/questions#R10 [agent-I25]: 요약은 답 접수와 적용 상태를 다른 말로 보인다", () => {
  const group: QuestionGroupView = {
    ...REPORT_GROUP,
    questions: [QUESTION_PLACE],
  };
  const answers = [REPORT_ANSWERS[0]];
  const view = render(
    <AnsweredSummary group={group} status="answered" answers={answers} />,
  );
  using _ = view;
  const shown = () => {
    const summary = one(view.container, "[data-answered-summary]");
    return [summary.getAttribute("data-status"), text(summary)];
  };
  const expected = {
    answered: "Answered 1 question: docs/reports/",
    applying: "Applying: docs/reports/",
    applied: "Applied: docs/reports/",
    apply_failed: "Couldn't apply: docs/reports/",
  } as const;
  for (const [status, line] of Object.entries(expected)) {
    view.rerender(
      <AnsweredSummary
        group={group}
        status={status as keyof typeof expected}
        answers={answers}
      />,
    );
    assertEquals(shown(), [status, line]);
  }
});

Deno.test("lophn-agent/questions#R8 [agent-I25]: 답 없이 닫힌 묶음의 요약은 Skipped·Expired·Cancelled이고 답을 보이지 않는다", () => {
  const view = render(
    <AnsweredSummary group={REPORT_GROUP} status="skipped" answers={[]} />,
  );
  using _ = view;
  const expected = {
    skipped: "Skipped",
    expired: "Expired",
    cancelled: "Cancelled",
  } as const;
  for (const [status, line] of Object.entries(expected)) {
    view.rerender(
      <AnsweredSummary
        group={REPORT_GROUP}
        status={status as keyof typeof expected}
        answers={[]}
      />,
    );
    const summary = one(view.container, "[data-answered-summary]");
    assertEquals(summary.getAttribute("data-status"), status);
    assertEquals(text(summary), line);
  }
});
