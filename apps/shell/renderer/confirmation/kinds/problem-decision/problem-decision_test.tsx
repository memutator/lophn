import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  click,
  render,
  settle,
} from "../../../../../../packages/design/components/testing.ts";
import type {
  ConfirmationFrameApi,
  ConfirmationView,
  SubmitResult,
} from "../../frame/api.ts";
import { ConfirmationScreen } from "../../screen.tsx";
import { APPLY_PROBLEM_DECISION } from "./problem-decision.tsx";

const PRB = "prb_01arz3ndektsv4rrffq69g5fav";

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
          receipt: { kind: "event", seq: "12" },
          result: "applied",
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

function decision(
  choice: string,
  extra: Record<string, unknown> = {},
  decisions: string[] = [APPLY_PROBLEM_DECISION],
): ConfirmationView {
  return {
    displayId: "dsp_1",
    request: {
      kind: "owner_decision",
      concern: "problems/closing",
      decision: "problem_decision",
      targets: [PRB],
      input: { kind: "inline", value: {} },
      comparison: {},
    },
    view: {
      kind: "problem_decision",
      choice,
      symptom: "Some bank files can't be read.",
      seen: 3,
      version: 4,
      ...extra,
    },
    decisions,
  };
}

async function show(api: ConfirmationFrameApi) {
  const view = render(<ConfirmationScreen api={api} theme={{}} />);
  await settle();
  return view;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  assert(found !== null, `no ${selector}`);
  return found as HTMLElement;
}

Deno.test("shell/confirmation-window#R2, shell/wording#R9, flow verify-app-repair: 문제 결정 창은 결정을 문장으로 묻고 문제의 영향 문장을 그대로 보이며 내가 한 말이지 테스트 통과가 아니라고 영향 칸에서 말한다", async () => {
  const cases: [string, string, string][] = [
    ["fixed", "Mark this issue as fixed?", "isn't a test result"],
    [
      "not_fixed",
      "Say this issue is still not fixed?",
      "keeps this issue open",
    ],
    ["not_visible", "Say you can't see this issue now?", "isn't a fix"],
    ["dismiss", "Stop working on this issue?", "isn't marked as fixed"],
  ];
  for (const [choice, title, effect] of cases) {
    const { api } = fakeApi(decision(choice));
    using view = await show(api);
    assertEquals(find(view.container, "h1").textContent, title);
    assertEquals(
      find(view.container, "[data-focus=first]").textContent,
      "Some bank files can't be read.",
    );
    assertStringIncludes(
      find(view.container, "[data-section='effect']").textContent ?? "",
      effect,
    );
    // 기본 화면 글에 안쪽 이름·ID가 없다.
    const text = (view.container.textContent ?? "").toLowerCase();
    for (
      const word of ["prb_", "basis_seq", "last_report", "snapshot", "release"]
    ) {
      assert(!text.includes(word), `${choice}: ${word}`);
    }
  }
});

Deno.test("shell/confirmation-window#R4, platform/approvals#R9: 결정 버튼은 입력 없이 결정 이름 하나만 보내고 닫기는 결정이 아니다", async () => {
  {
    const { api, sent, cancelled } = fakeApi(decision("fixed"));
    using view = await show(api);
    click(find(view.container, "[data-decision]"));
    await settle();
    assertEquals(sent.length, 1);
    assertEquals(sent[0].decision, APPLY_PROBLEM_DECISION);
    // 선택·이유·기준은 handle에 묶여 있고 화면이 보낸 본문은 없다.
    assertEquals(sent[0].input, undefined);
    assertEquals(cancelled(), 0);
    assertStringIncludes(
      view.container.textContent ?? "",
      "Your answer is saved.",
    );
  }
  {
    const { api, sent, cancelled } = fakeApi(decision("fixed"));
    using view = await show(api);
    click(find(view.container, "[data-action='cancel']"));
    await settle();
    assertEquals(sent, []);
    assertEquals(cancelled(), 1);
  }
});

Deno.test("problems/closing#R8, shell/confirmation-window#R2: 더 다루지 않음은 사람이 쓴 한 줄 이유를 고정해 보이고 접수만 된 결과는 반영을 단정하지 않는다", async () => {
  const { api } = fakeApi(
    decision("dismiss", { note: "I don't use bank files anymore." }),
    {
      outcome: "decided",
      receipt: { kind: "event", seq: "13" },
      result: "accepted",
    },
  );
  using view = await show(api);
  const details = find(view.container, "details");
  assertStringIncludes(details.textContent ?? "", "Your reason");
  assertStringIncludes(
    details.textContent ?? "",
    "I don't use bank files anymore.",
  );
  assertStringIncludes(details.textContent ?? "", "Version 4");
  click(find(view.container, "[data-decision]"));
  await settle();
  const text = view.container.textContent ?? "";
  assertStringIncludes(text, "will update shortly");
  assert(!text.includes("saved"));
});

Deno.test("shell/confirmation-window#R5: 허용된 결정이 없거나 선택을 모르면 결정 버튼 없이 없다고 말한다", async () => {
  {
    const { api } = fakeApi(decision("fixed", {}, []));
    using view = await show(api);
    assertEquals(view.container.querySelector("[data-decision]"), null);
    assert(view.container.querySelector("[data-action='cancel']") !== null);
  }
  {
    const { api } = fakeApi(decision("mystery"));
    using view = await show(api);
    assertEquals(view.container.querySelector("[data-decision]"), null);
    assert(view.container.querySelector("[data-change='missing']") !== null);
  }
});
