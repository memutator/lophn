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

function scoped(
  preselect: "allow_once" | "allow_session" | "deny",
  sessionGrantable = true,
): ConfirmationView {
  return {
    ...approval,
    view: { ...approval.view, session_grantable: sessionGrantable, preselect },
  };
}

Deno.test("shell/desktop#R47, platform/approvals#R19 [agent-I42]: session 허락이 되는 request는 Allow once와 Allow for this session을 고를 수 있고 미리 고른 쪽이 먼저 눈에 띈다", async () => {
  const session = await show(fakeApi(scoped("allow_session")).api);
  const once = button(
    session,
    "[data-decision=grant_approval_request][data-scope=once]",
  );
  const forSession = button(
    session,
    "[data-decision=grant_approval_request][data-scope=session]",
  );
  assertEquals(once.textContent, "Allow once");
  assertEquals(forSession.textContent, "Allow for this session");
  assertEquals(forSession.getAttribute("data-preselected"), "true");
  assertEquals(once.getAttribute("data-preselected"), null);
  assertEquals(
    button(session, "[data-decision=reject_approval_request]").getAttribute(
      "data-preselected",
    ),
    null,
  );
  // 미리 골라도 첫 focus는 설명이고 결정은 누르기 전에 제출되지 않는다.
  assertEquals(document.activeElement?.getAttribute("data-focus"), "first");

  const preOnce = await show(fakeApi(scoped("allow_once")).api);
  assertEquals(
    button(preOnce, "[data-scope=once]").getAttribute("data-preselected"),
    "true",
  );
  assertEquals(
    button(preOnce, "[data-scope=session]").getAttribute("data-preselected"),
    null,
  );
});

Deno.test("shell/desktop#R47 [agent-I42]: Deny도 미리 고를 수 있고 어느 쪽이든 누르기 전에는 제출하지 않는다", async () => {
  const denying = fakeApi(scoped("deny"));
  const root = await show(denying.api);
  const reject = button(root, "[data-decision=reject_approval_request]");
  assertEquals(reject.getAttribute("data-preselected"), "true");
  assertEquals(
    button(root, "[data-scope=once]").getAttribute("data-preselected"),
    null,
  );
  assertEquals(
    button(root, "[data-scope=session]").getAttribute("data-preselected"),
    null,
  );
  assertEquals(denying.sent.length, 0);
});

Deno.test("platform/approvals#R19, shell/confirmation-window#R1 [agent-I42]: 고른 범위가 허락 제출에 실린다. once는 기본값이라 싣지 않고 거절에는 범위가 없다", async () => {
  const sessionSent = fakeApi(scoped("allow_once"));
  const forSession = await show(sessionSent.api);
  click(button(forSession, "[data-scope=session]"));
  await settle();
  assertEquals(sessionSent.sent, [{
    displayId: "dsp_1",
    decision: "grant_approval_request",
    input: { scope: "session" },
  }]);
  assert(forSession.textContent?.includes("It hasn't happened yet"));

  const onceSent = fakeApi(scoped("allow_session"));
  const once = await show(onceSent.api);
  click(button(once, "[data-scope=once]"));
  await settle();
  assertEquals(onceSent.sent, [{
    displayId: "dsp_1",
    decision: "grant_approval_request",
  }]);

  const rejectSent = fakeApi(scoped("allow_session"));
  const rejected = await show(rejectSent.api);
  click(button(rejected, "[data-decision=reject_approval_request]"));
  await settle();
  assertEquals(rejectSent.sent, [{
    displayId: "dsp_1",
    decision: "reject_approval_request",
  }]);
});

Deno.test("platform/approvals#R20, platform/approvals#R18 [agent-I42]: session 허락이 아닌 request는 once만 있고 어떤 request에도 Always가 없다", async () => {
  for (const view of [scoped("allow_session", false), approval]) {
    const root = await show(fakeApi(view).api);
    assertEquals(root.querySelector("[data-scope=session]"), null);
    const once = button(
      root,
      "[data-decision=grant_approval_request]",
    );
    assertEquals(once.textContent, "Allow once");
    assertEquals(root.textContent?.includes("for this session"), false);
    assertEquals(/always/i.test(root.textContent ?? ""), false);
  }
  const root = await show(fakeApi(scoped("allow_session")).api);
  assertEquals(/always/i.test(root.textContent ?? ""), false);
  assertEquals(root.querySelector("[data-scope=always]"), null);
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

Deno.test("lophn-agent/revert#R11: revert 창은 앱 단계의 실패·응답 유실·미시작 이유를 고정 코드로 문장으로 말한다", async () => {
  const base = revertView(false, []);
  const view = {
    ...base,
    view: {
      ...base.view,
      groups: ["app_failed", "app_uncertain", "app_not_started"].map((
        reason,
        ordinal,
      ) => ({
        ordinal,
        owner: "apps/invocations",
        target: null,
        capability: "irreversible" as const,
        reason,
        change: "app",
        included: false,
      })),
    },
  } satisfies ConfirmationView;
  const root = await show(fakeApi(view).api);
  const lines = [...root.querySelectorAll("[data-capability]")].map((group) =>
    group.textContent
  );
  assert(lines[0]?.includes("The app couldn't undo this change."));
  assert(lines[1]?.includes("its answer never arrived"));
  assert(lines[2]?.includes("an earlier step didn't finish"));
});

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

const account: ConfirmationView = {
  ...secret,
  displayId: "dsp_5",
  request: {
    kind: "secret_input",
    owner: "pvd_01h455vb4pex5v6nkc6gd5fd01",
    purpose: "provider_credential",
  },
  view: {
    kind: "secret",
    purpose: "provider_credential",
    name: "Work key",
    provider: "Claude",
    configured: false,
    entry: "replace",
  },
  decisions: ["ChangeProviderCredentials"],
};

Deno.test("lophn-agent/harness/provider#R6, platform/secrets#R2: 계정 교체는 새 key를 보호 입력칸으로만 받고 삭제는 입력칸 없이 그 계정을 새 일에서 막는다", async () => {
  const value = "sk-new-key-correct-horse-9";
  const replaced = fakeApi(account, {
    outcome: "decided",
    secret_ref: "Work key",
    stored: "stored",
  });
  const root = await show(replaced.api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Replace the key for Work key?",
  );
  const input = button(root, "[data-secret=input]") as HTMLInputElement;
  assertEquals(input.type, "password");
  assert(root.textContent?.includes("New key"));
  const replace = button(root, "[data-decision=ChangeProviderCredentials]");
  assertEquals(replace.textContent, "Replace");
  assertEquals((replace as HTMLButtonElement).disabled, true);
  type(input, value);
  click(button(root, "[data-decision=ChangeProviderCredentials]"));
  await settle();
  assertEquals(replaced.sent, [{
    displayId: "dsp_5",
    decision: "ChangeProviderCredentials",
    input: { value },
  }]);
  assert(root.textContent?.includes("Work key is saved."));
  assertEquals(root.innerHTML.includes(value), false);

  const removed = fakeApi(
    { ...account, view: { ...account.view, entry: "revoke" } },
    { outcome: "decided", secret_ref: "Work key", stored: "revoked" },
  );
  const gone = await show(removed.api);
  assertEquals(gone.querySelector("h1")?.textContent, "Remove Work key?");
  assertEquals(gone.querySelector("input"), null);
  const remove = button(gone, "[data-decision=ChangeProviderCredentials]");
  assertEquals(remove.textContent, "Remove");
  assertEquals((remove as HTMLButtonElement).disabled, false);
  click(remove);
  await settle();
  // 보낼 값이 없다. 결정 이름만 간다.
  assertEquals(removed.sent, [{
    displayId: "dsp_5",
    decision: "ChangeProviderCredentials",
  }]);
  // 막은 것만 말한다. 값을 지웠다고 하지 않는다.
  assert(gone.textContent?.includes("Work key won't be used for new work."));
  assertEquals(gone.textContent?.includes("deleted"), false);
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
