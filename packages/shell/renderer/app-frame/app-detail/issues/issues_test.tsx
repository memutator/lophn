import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { click, render } from "../../../../../design/components/testing.ts";

import {
  find,
  flush,
  typeInto,
} from "../../../desktop/lophn-space/testdata/dom.ts";
import { IssuesTab } from "./issues-tab.tsx";
import {
  APP,
  closedIssue,
  fakeIssues,
  type FakeIssuesOptions,
  FIXING_ISSUE,
  now,
  OPEN_ISSUE,
  PRB_CLOSED,
  PRB_FIXING,
  PRB_OPEN,
} from "./testdata/fake-source.ts";
import type { IssueView } from "./source.ts";

// 안쪽 개념 이름과 원시 값은 기본 화면 글에 없다. report·claim·snapshot은 그 이름으로 보이지 않는다.
const INTERNAL = [
  "prb_",
  "app_",
  "tkt_",
  "rel_",
  "vrf_",
  "rpt_",
  "snp_",
  "snapshot",
  "claim",
  "report",
  "release",
  "ledger",
  "basis_seq",
  "last_report",
];

function textOf(root: Element): string {
  return root.textContent ?? "";
}

function visibleText(root: Element): string {
  const shown = root.cloneNode(true) as Element;
  for (const folded of shown.querySelectorAll("details")) folded.remove();
  return textOf(shown);
}

function noInternal(root: Element): void {
  const text = visibleText(root).toLowerCase();
  for (const word of INTERNAL) {
    assert(!text.includes(word), `기본 화면 글에 ${word}가 있다`);
  }
}

async function open(options: FakeIssuesOptions = {}, problem?: string) {
  const fake = fakeIssues(options);
  const view = render(
    <IssuesTab
      app={APP}
      source={fake.source}
      now={now}
      initialProblem={problem ?? null}
    />,
  );
  await flush();
  return { fake, view };
}

const IMPACT: Record<string, string> = {
  [PRB_OPEN]: "Some bank files can't be read.",
  [PRB_FIXING]: "Your monthly totals don't add up.",
  [PRB_CLOSED]: "The app closes when you add a receipt.",
};

async function openIssue(view: { container: HTMLElement }, id: string) {
  const button = [...view.container.querySelectorAll("[data-issue-open]")]
    .find((row) => textOf(row) === IMPACT[id]);
  assert(button !== undefined, "no row for the issue");
  click(button);
  await flush();
}

Deno.test("shell/wording#R5, shell/wording#R9, flow app-broken: Issues 목록은 문제가 정한 영향 문장과 진행 이름을 그대로 보이고 안쪽 이름·ID가 없다", async () => {
  const { view } = await open();
  using _ = view;
  const rows = [...view.container.querySelectorAll("[data-issues-list] > li")];
  assertEquals(rows.map((row) => row.getAttribute("data-issue")), [
    "open",
    "fixing",
    "closed",
  ]);
  assertStringIncludes(textOf(rows[0]), "Some bank files can't be read.");
  assertStringIncludes(textOf(rows[0]), "Open");
  assertStringIncludes(textOf(rows[0]), "Ask for a repair.");
  assertStringIncludes(textOf(rows[1]), "Being fixed");
  assertStringIncludes(textOf(rows[2]), "Closed");
  noInternal(view.container);
});

Deno.test("shell/wording#R5: 문제가 없으면 없다고 하고 읽기에 실패하면 실패한 대상과 다시 읽기를 보인다", async () => {
  {
    const { view } = await open({ list: { ok: true, value: [] } });
    using _ = view;
    assertStringIncludes(
      textOf(find(view.container, "[data-issues-empty]")),
      "no issues",
    );
  }
  {
    const { view } = await open({ list: { ok: false, code: "unavailable" } });
    using _ = view;
    const error = find(view.container, "[data-state='error']");
    assertStringIncludes(textOf(error), "the issues");
    assert(error.querySelector("button") !== null);
  }
});

Deno.test("flow app-broken, problems/grouping#R12: 열린 문제 상세는 영향 한 문장·접수 수·지금 담당·필요한 사람 조치를 먼저 보이고 수리 주장이 없다고 말한다", async () => {
  const { view } = await open();
  using _ = view;
  await openIssue(view, PRB_OPEN);
  const detail = find(view.container, "[data-issue-detail]");
  assertEquals(
    textOf(find(detail, "[data-issue-impact]")),
    "Some bank files can't be read.",
  );
  assertStringIncludes(
    textOf(find(detail, "[data-issue-seen]")),
    "Seen 3 times",
  );
  const now = find(detail, "[data-issue-now]");
  assertStringIncludes(textOf(now), "Nobody yet");
  assertStringIncludes(
    textOf(find(now, "[data-issue-needed]")),
    "Ask the App Engineer to look at it.",
  );
  assertStringIncludes(
    textOf(find(detail, "[data-check='claim']")),
    "Nobody has said it's fixed.",
  );
  // 열린 문제는 닫힘 칸도 모은 자료 접기도 없다.
  assertEquals(detail.querySelector("[data-issue-closed]"), null);
  assertEquals(detail.querySelector("[data-issue-details]"), null);
  noInternal(view.container);
});

Deno.test("flow verify-app-repair, problems/tests#R5: 고쳤다는 주장·실제 테스트·내 확인·미확인은 서로 다른 줄이고 주장은 테스트 통과를 대신하지 않는다", async () => {
  const { view } = await open();
  using _ = view;
  await openIssue(view, PRB_FIXING);
  const detail = find(view.container, "[data-issue-detail]");
  const claim = find(detail, "[data-check='claim']");
  const tests = find(detail, "[data-check='tests']");
  const human = find(detail, "[data-check='human']");
  assertStringIncludes(textOf(claim), "The fix says it's done.");
  assertEquals(claim.getAttribute("data-claimed"), "true");
  // 주장이 있어도 실제 테스트는 실패로 따로 보인다.
  assertEquals(tests.getAttribute("data-test-state"), "fail");
  assertStringIncludes(textOf(tests), "One test failed");
  assertEquals(
    [...tests.querySelectorAll("[data-test-item]")].map((item) =>
      item.getAttribute("data-test-item")
    ),
    ["pass", "fail", "unconfirmed"],
  );
  assertStringIncludes(textOf(human), "haven't checked this yourself");
  assertEquals(human.getAttribute("data-checked"), "false");
  assert(claim !== tests && tests !== human);
  assertStringIncludes(
    textOf(find(detail, "[data-issue-check-failed]")),
    "last check didn't pass",
  );
  assertStringIncludes(
    textOf(find(detail, "[data-issue-now]")),
    "Two checks haven't run yet.",
  );
  noInternal(view.container);
});

Deno.test("flow verify-app-repair 4, problems/tests#R4 problems/tests#R5 problems/closing#R2: 통과·실패·판정 불가·미실행과 남은 확인이 서로 다른 줄이고 적용하지 않은 수리는 닫히지 않는다", async () => {
  const fixing: IssueView = {
    ...FIXING_ISSUE,
    result: {
      ...FIXING_ISSUE.result,
      recorded: [
        {
          kind: "reproduction",
          label: "Reproduction test passed",
          state: "pass",
          endedAt: "2026-10-07T08:00:00.000Z",
        },
        {
          kind: "reproduction",
          label: "Reproduction test failed",
          state: "fail",
          endedAt: "2026-10-07T08:01:00.000Z",
        },
        {
          kind: "reproduction",
          label: "Reproduction test finished without a confirmed result",
          state: "unconfirmed",
          endedAt: null,
        },
        {
          kind: "app_test",
          label: "App test has not run",
          state: "not_run",
          endedAt: null,
        },
      ],
      remaining: "The fixed version is not in use, so this stays open.",
    },
  };
  const { view } = await open({
    views: {
      [PRB_OPEN]: OPEN_ISSUE,
      [PRB_FIXING]: fixing,
      [PRB_CLOSED]: closedIssue("verified"),
    },
  });
  using _ = view;
  await openIssue(view, PRB_FIXING);
  const detail = find(view.container, "[data-issue-detail]");
  assertEquals(detail.getAttribute("data-issue-detail"), "fixing");
  assertEquals(detail.querySelector("[data-issue-closed]"), null);
  const recorded = [
    ...detail.querySelectorAll("[data-recorded-item]"),
  ];
  assertEquals(
    recorded.map((item) => item.getAttribute("data-recorded-item")),
    ["pass", "fail", "unconfirmed", "not_run"],
  );
  assertEquals(
    new Set(recorded.map((item) => item.textContent)).size,
    4,
  );
  assertEquals(
    recorded[0]?.querySelector("time")?.getAttribute("datetime"),
    "2026-10-07T08:00:00.000Z",
  );
  assertEquals(recorded[3]?.querySelector("time"), null);
  const remaining = find(detail, "[data-check='remaining']");
  assertStringIncludes(textOf(remaining), "not in use");
  assertStringIncludes(textOf(remaining), "stays open");
  assertEquals(
    find(detail, "[data-check='human']").getAttribute("data-checked"),
    "false",
  );
  assertEquals(
    find(detail, "[data-check='claim']").getAttribute("data-claimed"),
    "true",
  );
  noInternal(view.container);
});

Deno.test("flow verify-app-repair, problems/closing#R13: 닫힌 문제는 닫힌 이유와 필요한 주의를 먼저 보이고 범위·근거는 Details we collected 아래에 접는다", async () => {
  const { view } = await open();
  using _ = view;
  await openIssue(view, PRB_CLOSED);
  const detail = find(view.container, "[data-issue-detail]");
  const closed = find(detail, "[data-issue-closed]");
  assertEquals(closed.getAttribute("data-issue-closed"), "verified");
  assertStringIncludes(textOf(closed), "Tests passed on the version in use.");
  assertStringIncludes(
    textOf(find(detail, "[data-issue-attention]")),
    "Tell us if it happens again.",
  );
  // 미확인 부분은 확인 줄에 따로 있다. 실제 테스트와 내 확인은 이 닫힘에서 서로 다르다.
  assertStringIncludes(
    textOf(find(detail, "[data-check='unconfirmed']")),
    "Adding many receipts at once wasn't tried.",
  );
  assertEquals(
    find(detail, "[data-check='human']").getAttribute("data-checked"),
    "false",
  );
  const folded = find(detail, "[data-issue-details]");
  assertEquals(folded.tagName, "DETAILS");
  assertEquals(
    textOf(find(folded, "summary")),
    "Details we collected",
  );
  assertStringIncludes(textOf(folded), "Adding one receipt worked.");
  assertStringIncludes(textOf(folded), "Version 4");
  assertStringIncludes(textOf(folded), "Receipt test passed.");
  // 기본 화면 글에는 접은 자료가 없다.
  assert(!visibleText(detail).includes("Adding one receipt worked."));
  noInternal(view.container);
});

Deno.test("flow verify-app-repair, problems/tests#R5, problems/closing#R9: 내가 확인함으로 닫힌 문제는 내 확인만 참이고 실제 테스트는 그대로 미실행이다", async () => {
  const { view } = await open({
    views: { [PRB_CLOSED]: closedIssue("user_confirmed") },
  }, PRB_CLOSED);
  using _ = view;
  const detail = find(view.container, "[data-issue-detail]");
  assertEquals(
    find(detail, "[data-issue-closed]").getAttribute("data-issue-closed"),
    "user_confirmed",
  );
  const human = find(detail, "[data-check='human']");
  assertEquals(human.getAttribute("data-checked"), "true");
  assertStringIncludes(textOf(human), "You checked this yourself.");
  assertEquals(
    find(detail, "[data-check='tests']").getAttribute("data-test-state"),
    "not_run",
  );
});

Deno.test("shell/confirmation-window, flow app-broken: 결정 단추는 확인 창을 열 문제와 선택만 보내고 이 화면이 결정을 받지 않는다", async () => {
  const { fake, view } = await open();
  using _ = view;
  await openIssue(view, PRB_OPEN);
  for (const choice of ["fixed", "not_fixed", "not_visible"]) {
    click(find(view.container, `[data-issue-choice='${choice}']`));
    await flush();
  }
  assertEquals(fake.decisions, [
    { problem: PRB_OPEN, choice: "fixed", note: null },
    { problem: PRB_OPEN, choice: "not_fixed", note: null },
    { problem: PRB_OPEN, choice: "not_visible", note: null },
  ]);
  assertStringIncludes(
    textOf(find(view.container, "[data-issue-waiting]")),
    "confirmation window",
  );
});

Deno.test("problems/closing#R8, shell/confirmation-window: 더 다루지 않음은 공백 아닌 한 줄 이유를 받은 뒤에만 확인 창으로 간다", async () => {
  const { fake, view } = await open();
  using _ = view;
  await openIssue(view, PRB_OPEN);
  const dismiss = () => find(view.container, "[data-issue-choice='dismiss']");
  click(dismiss());
  await flush();
  assertEquals(fake.decisions, []);
  const reason = find(
    view.container,
    "[data-issue-reason]",
  ) as HTMLInputElement;
  assertEquals((dismiss() as HTMLButtonElement).disabled, true);
  typeInto(reason, "   ");
  assertEquals((dismiss() as HTMLButtonElement).disabled, true);
  typeInto(reason, "  I don't use bank files anymore.  ");
  assertEquals((dismiss() as HTMLButtonElement).disabled, false);
  click(dismiss());
  await flush();
  assertEquals(fake.decisions, [{
    problem: PRB_OPEN,
    choice: "dismiss",
    note: "I don't use bank files anymore.",
  }]);
});

Deno.test("problems/closing#R6, shell/confirmation-window: 쓰는 Version을 모르면 고쳐짐·안 보임을 막고 이유를 말하며 닫힌 문제는 다시 열기만 둔다", async () => {
  {
    const { fake, view } = await open({
      views: {
        [PRB_OPEN]: {
          ...OPEN_ISSUE,
          basis: { versionKnown: false, observationKnown: false },
        },
      },
    }, PRB_OPEN);
    using _ = view;
    const disabled = (choice: string) =>
      (find(
        view.container,
        `[data-issue-choice='${choice}']`,
      ) as HTMLButtonElement)
        .disabled;
    assertEquals(disabled("fixed"), true);
    assertEquals(disabled("not_visible"), true);
    assertEquals(disabled("not_fixed"), false);
    assertEquals(disabled("dismiss"), false);
    assertStringIncludes(
      textOf(find(view.container, "[data-issue-blocked]")),
      "which version was in use",
    );
    click(find(view.container, "[data-issue-choice='fixed']"));
    await flush();
    assertEquals(fake.decisions, []);
  }
  {
    const { view } = await open({
      views: { [PRB_CLOSED]: closedIssue("verified") },
    }, PRB_CLOSED);
    using _ = view;
    assertEquals(
      [...view.container.querySelectorAll("[data-issue-choice]")].map((item) =>
        item.getAttribute("data-issue-choice")
      ),
      ["not_fixed"],
    );
  }
});

Deno.test("problems/feedback#R5, flow app-broken: 직접 해 봤지만 안 됩니다는 그 문제를 고른 채 새 feedback을 연다", async () => {
  const { fake, view } = await open({}, PRB_FIXING);
  using _ = view;
  click(find(view.container, "[data-issue-tried]"));
  await flush();
  assertEquals(fake.again, [{ app: APP, problem: PRB_FIXING }]);
  assertEquals(fake.decisions, []);
});

Deno.test("shell/wording#R10: 결정 창이나 feedback을 열지 못하면 사람이 겪는 영향과 다시 해 볼 수 있다는 안내를 보인다", async () => {
  {
    const { view } = await open(
      { decide: { ok: false, code: "unavailable" } },
      PRB_OPEN,
    );
    using _ = view;
    click(find(view.container, "[data-issue-choice='not_fixed']"));
    await flush();
    assertEquals(
      find(view.container, "[data-issue-failed]").getAttribute(
        "data-issue-failed",
      ),
      "decision",
    );
    assertEquals(view.container.querySelector("[data-issue-waiting]"), null);
  }
  {
    const { view } = await open({
      reportAgain: { ok: false, code: "unavailable" },
    }, PRB_OPEN);
    using _ = view;
    click(find(view.container, "[data-issue-tried]"));
    await flush();
    assertEquals(
      find(view.container, "[data-issue-failed]").getAttribute(
        "data-issue-failed",
      ),
      "tried",
    );
  }
});

Deno.test("problems/feedback#R13: 접수된 문제로 열면 목록을 거치지 않고 그 문제 상세를 읽고 뒤로 가면 목록이다", async () => {
  const { fake, view } = await open({}, PRB_FIXING);
  using _ = view;
  assertEquals(fake.reads, [PRB_FIXING]);
  assertEquals(
    textOf(find(view.container, "[data-issue-impact]")),
    FIXING_ISSUE.impact,
  );
  click(find(view.container, "[data-issue-back]"));
  await flush();
  assertEquals(
    view.container.querySelectorAll("[data-issues-list] > li").length,
    3,
  );
});
