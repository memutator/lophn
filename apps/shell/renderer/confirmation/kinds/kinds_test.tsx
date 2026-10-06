import { assert, assertEquals } from "@std/assert";
import { act } from "react";

import {
  click,
  render,
  settle,
} from "../../../../../packages/design/components/testing.ts";
import type {
  ConfirmationFrameApi,
  ConfirmationView,
  SubmitResult,
} from "../frame/api.ts";
import { ConfirmationScreen } from "../screen.tsx";

const APR = "apr_01arz3ndektsv4rrffq69g5fav";
const QST = "qst_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const DOC_B = "doc_01arz3ndektsv4rrffq69g5faw";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const RVT = "rvt_01arz3ndektsv4rrffq69g5fav";
const HASH = "b".repeat(64);

type Sent = Parameters<ConfirmationFrameApi["submit"]>[0];

function fakeApi(view: ConfirmationView, result?: SubmitResult) {
  const sent: Sent[] = [];
  let cancelled = 0;
  const api: ConfirmationFrameApi = {
    getDisplay: () => Promise.resolve(view),
    submit: (input) => {
      sent.push(input);
      return Promise.resolve(
        result ?? {
          outcome: "decided",
          receipt: { kind: "entity", id: APR },
          result: "accepted",
        },
      );
    },
    cancel: () => {
      cancelled += 1;
      return Promise.resolve({ outcome: "dismissed" });
    },
  };
  return { api, sent, cancelled: () => cancelled };
}

async function show(api: ConfirmationFrameApi) {
  const view = render(<ConfirmationScreen api={api} theme={{}} />);
  await settle();
  return view.container;
}

function button(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  assert(found !== null, `no ${selector}`);
  return found as HTMLElement;
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const approval: ConfirmationView = {
  displayId: "dsp_1",
  request: {
    kind: "approval_request",
    approval: APR,
    created_seq: "12",
    binding_hash: HASH,
  },
  view: {
    kind: "approval",
    requester: "Writer",
    concern: "documents/addressing",
    command: "document.rename",
    targets: [DOC],
    input: { kind: "inline", value: { name: "plan.md" } },
    comparison: { base_revision: "7" },
    reason: "The file name no longer matches its title.",
    changes: "Rename notes/a.md to notes/plan.md.",
    external: null,
    reversible: true,
    reversibility: "Rename it back from the document menu.",
    expires_at: null,
  },
  state: "ready",
  decisions: [
    "grant_approval_request",
    "reject_approval_request",
    "cancel_approval_request",
  ],
  second: false,
};

Deno.test("shell/confirmation-window#R2, platform/approvals#R1: approval 창은 결정을 문장으로 묻고 정확한 동작·대상·입력과 영향·되돌릴 범위를 순서대로 보인다", async () => {
  const { api } = fakeApi(approval);
  const root = await show(api);
  assertEquals(root.querySelector("h1")?.textContent, "Allow this action?");
  const subject = button(root, "[data-section=subject]");
  assert(subject.textContent?.includes("Rename notes/a.md to notes/plan.md."));
  const exact = button(subject, "[data-exact=action]");
  assert(exact.textContent?.includes("documents/addressing"));
  assert(exact.textContent?.includes("document.rename"));
  assert(exact.textContent?.includes(DOC));
  assert(exact.textContent?.includes('"name": "plan.md"'));
  assert(exact.textContent?.includes('"base_revision": "7"'));
  assertEquals(
    button(root, "[data-section=effect]").textContent?.includes(
      "Nothing outside lophn is affected.",
    ),
    true,
  );
  assert(
    button(root, "[data-section=revert]").textContent?.includes(
      "Rename it back from the document menu.",
    ),
  );
  // 이유·요청자는 Details에 접혀 있다.
  const details = button(root, "[data-section=details]") as HTMLDetailsElement;
  assertEquals(details.open, false);
  assert(details.textContent?.includes("Writer"));
  // 첫 focus는 결정 버튼이 아니라 설명이다.
  assertEquals(document.activeElement?.getAttribute("data-focus"), "first");
});

Deno.test("platform/approvals#R9, platform/approvals#R13, platform/approvals#R14: 허락·거절·명시 취소는 서로 다른 버튼이고 닫기는 결정이 아니며 허락은 접수로만 말한다", async () => {
  const closing = fakeApi(approval);
  const closed = await show(closing.api);
  click(button(closed, "[data-action=cancel]"));
  assertEquals(closing.sent.length, 0);
  assertEquals(closing.cancelled(), 1);

  const rejecting = fakeApi(approval);
  const root = await show(rejecting.api);
  type(
    root.querySelector("textarea") as HTMLTextAreaElement,
    "Not this file.",
  );
  click(button(root, "[data-decision=reject_approval_request]"));
  await settle();
  assertEquals(rejecting.sent, [{
    displayId: "dsp_1",
    decision: "reject_approval_request",
    input: { reason: "Not this file." },
  }]);
  assert(root.textContent?.includes("You rejected this. Nothing will happen."));

  const granting = fakeApi(approval);
  const granted = await show(granting.api);
  click(button(granted, "[data-decision=grant_approval_request]"));
  await settle();
  assertEquals(granting.sent[0]?.decision, "grant_approval_request");
  assertEquals(granting.sent[0]?.input, undefined);
  // 허락 저장은 완료가 아니다.
  assert(granted.textContent?.includes("It hasn't happened yet"));
  assertEquals(granted.querySelector("[data-decision]"), null);

  const cancelling = fakeApi(approval);
  const withdrawn = await show(cancelling.api);
  click(button(withdrawn, "[data-decision=cancel_approval_request]"));
  await settle();
  assertEquals(cancelling.sent[0]?.decision, "cancel_approval_request");
  assert(withdrawn.textContent?.includes("You cancelled this request."));
});

const optionAction: ConfirmationView = {
  displayId: "dsp_2",
  request: {
    kind: "question_option_action",
    question: QST,
    option_key: "move",
    created_seq: "20",
    binding_hash: HASH,
  },
  view: {
    kind: "option_action",
    prompt: "Where should this note go?",
    reason: "It has not changed for a year.",
    label: "Move to archive",
    description: "Move the note into the archive folder.",
    recommended: true,
    concern: "documents/addressing",
    command: "document.move",
    targets: [DOC],
    input: { kind: "inline", value: { place: "archive/" } },
    comparison: { base_revision: "3" },
    expires_at: null,
  },
  state: "ready",
  decisions: ["AnswerQuestionAction"],
  second: false,
};

Deno.test("shell/confirmation-window#R2, lophn-agent/questions#R13: option action은 고르기 전에 concern·command·대상·정확한 입력·비교 기준·영향을 그대로 보인다", async () => {
  const { api, sent } = fakeApi(optionAction);
  const root = await show(api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Choose Move to archive?",
  );
  const exact = button(root, "[data-exact=action]");
  for (
    const text of [
      "documents/addressing",
      "document.move",
      DOC,
      '"place": "archive/"',
      '"base_revision": "3"',
    ]
  ) assert(exact.textContent?.includes(text), text);
  assert(
    button(root, "[data-section=effect]").textContent?.includes(
      "lophn makes exactly the change shown here.",
    ),
  );
  assertEquals(sent.length, 0);
  click(button(root, "[data-decision=AnswerQuestionAction]"));
  await settle();
  assertEquals(sent, [{
    displayId: "dsp_2",
    decision: "AnswerQuestionAction",
  }]);
  assert(root.textContent?.includes("Your answer is saved."));
});

function revertView(allowPartial: boolean, decisions: string[]) {
  return {
    displayId: "dsp_3",
    request: {
      kind: "owner_decision",
      concern: "lophn-agent/revert",
      decision: "RevertRun",
      targets: [RUN],
      input: {
        kind: "inline",
        value: {
          id: RVT,
          run: RUN,
          allow_partial: allowPartial,
          preview_hash: HASH,
        },
      },
      comparison: { preview_hash: HASH },
    },
    view: {
      kind: "revert",
      allow_partial: allowPartial,
      groups: [
        {
          ordinal: 0,
          owner: "documents/versions",
          target: DOC,
          capability: "reversible",
          reason: null,
          change: "restore",
          included: true,
        },
        {
          ordinal: 1,
          owner: "documents/versions",
          target: DOC_B,
          capability: "conflict",
          reason: "later_change",
          change: "document",
          included: false,
        },
        {
          ordinal: 2,
          owner: "lophn-agent/questions",
          target: null,
          capability: "retained",
          reason: "audit_fact",
          change: null,
          included: false,
        },
      ],
    },
    state: "ready",
    decisions,
    second: allowPartial,
  } satisfies ConfirmationView;
}

Deno.test("lophn-agent/revert#R3, lophn-agent/revert#R7: revert 창은 복원 가능·불가·충돌·남을 영향을 보이고 안전하지 않은 부분은 2차 확인 뒤에만 빼고 적용한다", async () => {
  const { api, sent } = fakeApi(
    revertView(true, ["RevertRun"]),
    {
      outcome: "decided",
      receipt: { kind: "entity", id: RVT },
      result: "partial",
    },
  );
  const root = await show(api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Undo the changes from this work?",
  );
  const groups = [...root.querySelectorAll("[data-capability]")];
  assertEquals(
    groups.map((group) => [
      group.getAttribute("data-capability"),
      group.getAttribute("data-included"),
    ]),
    [["reversible", "true"], ["conflict", "false"], ["retained", "false"]],
  );
  assert(groups[0]!.textContent?.includes("Will be undone"));
  assert(groups[1]!.textContent?.includes("It changed again after this work."));
  assert(groups[2]!.textContent?.includes("This is a record of what happened"));
  assert(
    button(root, "[data-section=effect]").textContent?.includes(
      "Only the changes marked Will be undone are undone.",
    ),
  );
  // 첫 누름은 남을 영향을 다시 보이는 단계로 갈 뿐 제출하지 않는다.
  click(button(root, "[data-decision=RevertRun]"));
  await settle();
  assertEquals(sent.length, 0);
  assertEquals(root.querySelector("h1")?.textContent, "Some changes will stay");
  assertEquals(
    [...root.querySelectorAll("[data-capability]")].map((group) =>
      group.getAttribute("data-capability")
    ),
    ["conflict", "retained"],
  );
  click(button(root, "[data-step=second]"));
  await settle();
  assertEquals(sent, [{
    displayId: "dsp_3",
    decision: "RevertRun",
    confirmedSecond: true,
  }]);
  assert(root.textContent?.includes("Some changes were undone."));

  const nothing = fakeApi(revertView(false, []));
  const none = await show(nothing.api);
  assertEquals(none.querySelector("[data-decision]"), null);
  assert(none.textContent?.includes("Nothing listed here can be undone."));
});

const secret: ConfirmationView = {
  displayId: "dsp_4",
  request: {
    kind: "secret_input",
    owner: "weather.key",
    purpose: "app_secret",
  },
  view: {
    kind: "secret",
    purpose: "app_secret",
    name: "weather.key",
    configured: false,
    entry: "value",
  },
  state: "ready",
  decisions: ["SetSecret"],
  second: false,
};

Deno.test("platform/secrets#R2, shell/confirmation-window#R6: secret 입력은 보호 입력칸이고 값은 제출 한 번에만 가며 화면에는 안전 이름과 저장 결과만 남는다", async () => {
  const value = "correct-horse-battery-staple-9";
  const { api, sent } = fakeApi(secret, {
    outcome: "decided",
    secret_ref: "weather.key",
    stored: "stored",
  });
  const root = await show(api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Save a value for weather.key?",
  );
  const input = button(root, "[data-secret=input]") as HTMLInputElement;
  assertEquals(input.type, "password");
  assertEquals(input.getAttribute("autocomplete"), "off");
  const save = button(root, "[data-decision=SetSecret]") as HTMLButtonElement;
  assertEquals(save.disabled, true);
  type(input, value);
  click(button(root, "[data-decision=SetSecret]"));
  await settle();
  assertEquals(sent, [{
    displayId: "dsp_4",
    decision: "SetSecret",
    input: { value },
  }]);
  assert(root.textContent?.includes("weather.key is saved."));
  assertEquals(root.innerHTML.includes(value), false);
  assertEquals(root.querySelector("input"), null);

  const code = fakeApi({
    ...secret,
    view: { ...secret.view, entry: "code", name: "ChatGPT" },
    decisions: ["RegisterProviderCredential"],
  });
  const pasted = await show(code.api);
  assertEquals(pasted.querySelector("h1")?.textContent, "Finish signing in?");
  assert(pasted.textContent?.includes("Code or final address"));
});

Deno.test("shell/confirmation-window#R5: 대상이 바뀌거나 만료되면 옛 결정 버튼 없이 이유와 최신 내용 열기만 남는다", async () => {
  const { api, sent } = fakeApi({ ...approval, state: "stale", decisions: [] });
  const root = await show(api);
  assertEquals(root.querySelector("[data-decision]"), null);
  assert(root.querySelector("[data-action=refresh]") !== null);
  assert(root.textContent?.includes("This request changed."));
  const expired = await show(
    fakeApi({ ...approval, state: "expired", decisions: [] }).api,
  );
  assertEquals(expired.querySelector("[data-decision]"), null);
  assert(expired.textContent?.includes("This confirmation expired."));
  assertEquals(sent.length, 0);
});
