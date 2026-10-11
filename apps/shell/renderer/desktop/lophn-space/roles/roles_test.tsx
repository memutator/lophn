// roles 화면(shell#T30). 역할 목록·상세 탭·하는 일·만든 것·대화·작업 검토·Preset. 값은 가짜 통로가 기록한다.
import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../packages/design/components/testing.ts";

import { RolesScreen } from "./roles-screen.tsx";
import { ConversationProvider } from "../../../conversation/dock-slot.tsx";
import { DraftStore } from "../../../conversation/drafts.ts";
import {
  agentMessage,
  manualTicks,
  sessionId,
} from "../../../conversation/testdata/fake-source.ts";
import { byText, find, flush, pressTab, typeInto } from "../testdata/dom.ts";
import {
  APP,
  ASG_APP,
  ASG_LOPHN,
  ASG_OLD,
  ASG_OPERATOR,
  CHOICES,
  definition,
  fakeRoles,
  type FakeRolesData,
  PST_DEFAULT,
  PST_MINE,
  PVD,
  role,
  step,
  toolId,
  trace,
  work,
} from "./testdata/fake-roles.ts";
import type { ModelAttempt, UsageTotals } from "./source.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");
const LOPHN = role();
const CONTEXT = role({
  id: "asg_01h455vb4pex5v6nkc6gd5fd05",
  role: "context_engineer",
  presetName: "Context Engineer",
});
const ENGINEER = role({
  id: ASG_APP,
  role: "app_engineer",
  scope: { kind: "app", id: APP },
  presetName: "App Engineer",
});
const OLD = role({
  id: ASG_OLD,
  role: "app_engineer",
  state: "withdrawn",
  scope: { kind: "app", id: "app_01h455vb4pex5v6nkc6gd5fd09" },
});
const OPERATOR = role({
  id: ASG_OPERATOR,
  role: "operator",
  scope: { kind: "app", id: APP },
  outputs: ["doc_report"],
});

const catalog = () =>
  Promise.resolve({
    ok: true as const,
    value: {
      projects: [],
      apps: [{ id: APP, title: "Groceries" }],
    },
  });

interface Opened {
  readonly reads: [string, string | null][];
  readonly confirms: number[];
  readonly apps: string[];
  readonly drafts: DraftStore;
  readonly tick: () => void;
}

function screen(
  fake: ReturnType<typeof fakeRoles>,
  initialRole?: string,
): { element: ReturnType<typeof RolesScreenWith>; opened: Opened } {
  const opened: Opened = {
    reads: [],
    confirms: [],
    apps: [],
    drafts: new DraftStore(),
    tick: () => {},
  };
  const ticks = manualTicks();
  (opened as { tick: () => void }).tick = ticks.tick;
  return {
    opened,
    element: RolesScreenWith(fake, opened, ticks.ticks, initialRole),
  };
}

function RolesScreenWith(
  fake: ReturnType<typeof fakeRoles>,
  opened: Opened,
  ticks: (listener: () => void) => () => void,
  initialRole?: string,
) {
  return (
    <ConversationProvider
      deps={{
        source: fake.conversation(LOPHN).source,
        drafts: opened.drafts,
        ticks,
      }}
    >
      <RolesScreen
        source={fake.source}
        catalog={catalog}
        now={() => NOW}
        initialRole={initialRole}
        onRead={(document, version) => opened.reads.push([document, version])}
        onConfirm={() => opened.confirms.push(1)}
        onApp={(app) => opened.apps.push(app)}
      />
    </ConversationProvider>
  );
}

function base(over: FakeRolesData = {}): FakeRolesData {
  return {
    roles: [OPERATOR, OLD, ENGINEER, CONTEXT, LOPHN],
    ...over,
  };
}

function text(root: Element): string {
  return root.textContent ?? "";
}

function checkbox(root: ParentNode, label: string): HTMLElement {
  for (const item of root.querySelectorAll("label")) {
    if (item.textContent === label) {
      return item.parentElement!.querySelector(
        "[role=checkbox]",
      ) as HTMLElement;
    }
  }
  throw new Error(`no checkbox ${label}`);
}

function openRole(root: ParentNode, id: string) {
  click(find(root, `[data-role='${id}']`));
}

async function openWork(
  root: ParentNode,
  workId: string,
) {
  click(find(root, `[data-work='${workId}'] [data-action='review']`));
  await flush();
}

Deno.test("shell/desktop#R4: 역할 목록은 다른 목록 화면과 같은 열 배치이고 lophn·Context Engineer·App Engineer·Operator 순에 회수된 담당이 아래에 온다", async () => {
  const fake = fakeRoles(base());
  const { element } = screen(fake);
  using view = render(element);
  await flush();
  assert(view.container.querySelector("[data-list-column]"));
  assert(view.container.querySelector("[data-detail-column]"));
  const rows = [...view.container.querySelectorAll("[data-role]")].map((row) =>
    row.getAttribute("data-role")
  );
  assertEquals(rows, [LOPHN.id, CONTEXT.id, ENGINEER.id, OPERATOR.id, OLD.id]);
  const titles = [...view.container.querySelectorAll("[data-role]")].map((
    row,
  ) => row.querySelector("span span")?.textContent);
  // 붙은 곳의 이름을 보이고 모르는(보관된) 곳은 역할 이름만이다.
  assertEquals(titles.slice(0, 5), [
    "lophn",
    "Context Engineer",
    "App Engineer · Groceries",
    "Operator · Groceries",
    "App Engineer",
  ]);
  assertEquals(
    find(view.container, `[data-role='${OLD.id}']`).getAttribute("data-state"),
    "withdrawn",
  );
});

Deno.test("shell/desktop#R4: 역할을 바꿔도 상세는 하는 일·만든 것·대화·Preset 탭이 같은 자리에 있다", async () => {
  const fake = fakeRoles(base());
  const { element } = screen(fake);
  using view = render(element);
  await flush();
  for (const id of [LOPHN.id, ENGINEER.id, OLD.id]) {
    openRole(view.container, id);
    await flush();
    const tabs = [...view.container.querySelectorAll("[role=tab]")].map((tab) =>
      tab.textContent
    );
    assertEquals(tabs, ["Work", "Made", "Conversation", "Preset"]);
  }
});

Deno.test("shell/desktop#R4: 회수된 담당은 지난 대화만 읽고 입력창이 없으며 멈춘 담당은 도크와 같이 요청을 남길 수 있다", async () => {
  const fake = fakeRoles(base());
  const { element } = screen(fake);
  const old = fake.conversation(OLD);
  old.state.sessions = [{ id: sessionId(1), state: "open", stateSeq: "10" }];
  old.state.messages = { [sessionId(1)]: [agentMessage(1)] };
  old.state.bodies = {
    [agentMessage(1).id]: [{ kind: "text", text: "Last week's answer" }],
  };
  using view = render(element);
  await flush();
  openRole(view.container, OLD.id);
  await flush();
  pressTab(byText(view.container, "Conversation"));
  await flush();
  assert(text(view.container).includes("Last week's answer"));
  assertEquals(view.container.querySelector("[data-composer]"), null);
  assert(
    text(view.container).includes(
      "This conversation has ended. You can read it but not reply.",
    ),
  );
  assert(
    text(view.container).includes("This role was removed."),
  );
});

Deno.test("shell/desktop#R4: 멈춘 담당의 대화에는 보존 안내와 입력창이 있고 다시 시작 단추가 역할을 이어 준다", async () => {
  const paused = role({
    id: ASG_APP,
    role: "app_engineer",
    state: "paused",
    scope: { kind: "app", id: APP },
  });
  const fake = fakeRoles({ roles: [paused] });
  const { element } = screen(fake);
  using view = render(element);
  await flush();
  openRole(view.container, paused.id);
  await flush();
  assert(find(view.container, "[data-action='resume']"));
  pressTab(byText(view.container, "Conversation"));
  await flush();
  assert(find(view.container, "[data-paused]"));
  assert(find(view.container, "[data-composer]"));
  click(find(view.container, "[data-action='resume']"));
  await flush();
  assertEquals(fake.calls.find((call) => call[0] === "resume"), [
    "resume",
    paused.id,
  ]);
});

Deno.test("shell/desktop#R5: 하는 일은 In progress, Waiting, Stopped, Done 순이고 다시 시작은 앞선 일이 멈춘 뒤 확인을 기다리는 일에만 다시 시키기는 멈춘 요청에만 따로 있다", async () => {
  const stopped = work(1, {
    state: "finished",
    outcome: { kind: "failed", reason: "model_error" },
  });
  const done = work(2);
  const running = work(3, {
    state: "running",
    outcome: null,
    finishedAt: null,
  });
  const waitingUser = work(4, {
    state: "waiting_user",
    outcome: null,
    finishedAt: null,
  });
  const next = work(5, {
    state: "accepted",
    outcome: null,
    startedAt: null,
    finishedAt: null,
    requestMessage: "msg_01h455vb4pex5v6nkc6gd5f005",
    after: { id: stopped.id, stateSeq: stopped.stateSeq, stopped: true },
  });
  const fake = fakeRoles(base({
    works: { [LOPHN.id]: [done, stopped, running, waitingUser, next] },
    requests: { [stopped.id]: "Tidy my notes" },
  }));
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  const groups = [...view.container.querySelectorAll("[data-work-group]")].map((
    group,
  ) => group.getAttribute("data-work-group"));
  assertEquals(groups, ["in-progress", "waiting", "stopped", "done"]);
  const heads = [...view.container.querySelectorAll("[data-work-group] h3")]
    .map((
      head,
    ) => head.firstChild?.textContent);
  assertEquals(heads, ["In progress", "Waiting", "Stopped", "Done"]);
  // 앞선 일이 멈춘 뒤 사람의 확인을 기다리는 일은 Waiting에서 다시 시작만 있다.
  const waiting = find(view.container, "[data-work-group='waiting']");
  assertEquals(
    waiting.querySelector(
      `[data-work='${next.id}'] [data-action='restart']`,
    ) !==
      null,
    true,
  );
  assertEquals(
    waiting.querySelector(`[data-work='${next.id}'] [data-action='ask-again']`),
    null,
  );
  // 멈춘 요청에는 다시 시키기만 있고 다시 시작은 없다.
  const stoppedItem = find(view.container, `[data-work='${stopped.id}']`);
  assert(stoppedItem.querySelector("[data-action='ask-again']"));
  assertEquals(stoppedItem.querySelector("[data-action='restart']"), null);
  // 끝난 일은 어느 쪽도 없고, 진행 중인 일은 멈추기가 있다.
  const doneItem = find(view.container, `[data-work='${done.id}']`);
  assertEquals(doneItem.querySelector("[data-action='restart']"), null);
  assertEquals(doneItem.querySelector("[data-action='ask-again']"), null);
  assert(
    find(view.container, `[data-work='${running.id}'] [data-action='stop']`),
  );
  // 기다리는 답이 있는 일은 확인할 것으로 간다.
  click(
    find(
      view.container,
      `[data-work='${waitingUser.id}'] [data-action='answer']`,
    ),
  );
  click(
    find(view.container, `[data-work='${next.id}'] [data-action='restart']`),
  );
  await flush();
  assertEquals(fake.calls.find((call) => call[0] === "restart"), [
    "restart",
    next.id,
  ]);
});

Deno.test("shell/desktop#R5: 다시 시키기는 처음 요청의 글을 대화 입력칸에 채워 대화 탭으로 가고 보내는 것은 사람이다", async () => {
  const stopped = work(1, {
    outcome: { kind: "stopped", reason: "user_stopped" },
  });
  const fake = fakeRoles(base({
    works: { [LOPHN.id]: [stopped] },
    requests: { [stopped.id]: "Tidy my notes" },
  }));
  const { element, opened } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  click(
    find(
      view.container,
      `[data-work='${stopped.id}'] [data-action='ask-again']`,
    ),
  );
  await flush();
  assertEquals(opened.drafts.draft(stopped.session!).text, "Tidy my notes");
  assertEquals(opened.drafts.selected(), stopped.session);
  assertEquals(
    find(view.container, "[role=tab][aria-selected=true]").textContent,
    "Conversation",
  );
  // 입력칸에 채웠을 뿐 아무것도 보내지 않았다.
  assertEquals(fake.conversation(LOPHN).state.sent.length, 0);
});

Deno.test("shell/desktop#R3: 만든 것이 4개 이상이면 첫 3개와 남은 개수를 보이고 나머지도 모두 열 수 있다", async () => {
  const made = [1, 2, 3, 4, 5].map((n) => ({
    document: `doc_0${n}`,
    version: null,
    work: null,
  }));
  const fake = fakeRoles(base({
    made: { [LOPHN.id]: made },
    titles: Object.fromEntries(
      made.map((item, index) => [item.document, `Note ${index + 1}`]),
    ),
  }));
  const { element, opened } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  pressTab(byText(view.container, "Made"));
  await flush();
  assertEquals(view.container.querySelectorAll("[data-result]").length, 3);
  assertEquals(
    find(view.container, "[data-more-results]").getAttribute(
      "data-more-results",
    ),
    "2",
  );
  click(find(view.container, "[data-more-results]"));
  await flush();
  assertEquals(view.container.querySelectorAll("[data-result]").length, 5);
  click(find(view.container, "[data-result='doc_05']"));
  assertEquals(opened.reads, [["doc_05", null]]);
});

Deno.test("shell/desktop#R3: 만든 것이 없으면 비었음 안내와 대화로 가는 행동 하나만 둔다", async () => {
  const fake = fakeRoles(base());
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  pressTab(byText(view.container, "Made"));
  await flush();
  assert(text(view.container).includes("Nothing made yet."));
  click(byText(view.container, "Open conversation"));
  await flush();
  assertEquals(
    find(view.container, "[role=tab][aria-selected=true]").textContent,
    "Conversation",
  );
});

const FINISHED = work(1);

function reviewData(over: FakeRolesData = {}): FakeRolesData {
  return base({
    works: { [LOPHN.id]: [FINISHED] },
    requests: { [FINISHED.id]: "Tidy my notes" },
    results: {
      [FINISHED.id]: [{
        document: "doc_1",
        version: "ver_1",
        work: FINISHED.id,
      }],
    },
    titles: { doc_1: "Tidy notes" },
    ...over,
  });
}

Deno.test("lophn-agent/observability#R20: 작업 검토의 기본은 대상·결과·다음 행동뿐이고 시각·역할·근거는 상세를 펼친 뒤에만 읽는다", async () => {
  const fake = fakeRoles(reviewData({
    traces: {
      [FINISHED.id]: trace(FINISHED.id, {
        handoffs: [{ sender: "run_x", receiver: FINISHED.id }],
      }),
    },
    bodies: {
      [`run_basis:${FINISHED.id}`]: {
        value: {
          preset: { id: PST_DEFAULT, revision: 3 },
          models: {
            judgment: { model_name: "claude-a" },
            organizing: { model_name: "claude-small" },
          },
        },
        truncated: false,
      },
    },
  }));
  const { element, opened } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  await openWork(view.container, FINISHED.id);
  assertEquals(
    find(view.container, "[data-review-target]").textContent,
    "Tidy my notes",
  );
  assertEquals(
    find(view.container, "[data-review-reason]").textContent,
    "It answered and finished.",
  );
  // 실제로 만든 문서만 결과로 보이고 다음 행동은 되돌리기 하나다.
  assertEquals(
    find(view.container, "[data-result]").getAttribute("data-result"),
    "doc_1@ver_1",
  );
  assert(find(view.container, "[data-review-basic] [data-action='undo']"));
  // 기본에는 상세가 없고 근거 본문도 읽지 않았다.
  assertEquals(view.container.querySelector("[data-review-details]"), null);
  assertEquals(fake.calls.filter((call) => call[0] === "body").length, 0);
  click(find(view.container, "[data-disclose-toggle='details']"));
  await flush();
  const details = find(view.container, "[data-review-details]");
  assert(find(details, "[data-started]").textContent!.includes("Oct 6"));
  assert(find(details, "[data-finished]"));
  assertEquals(
    find(details, "[data-done-by]").textContent,
    "lophn · handed over by another role",
  );
  assertEquals(
    find(details, "[data-basis='ready']").textContent,
    "Preset version 3 · For decisions: claude-a · For summaries: claude-small",
  );
  assert(find(details, "[data-affected]").textContent!.includes("1 document"));
  assert(find(details, "[data-judgment]"));
  // 되돌리기는 확인 창이 받는다.
  click(find(view.container, "[data-review-basic] [data-action='undo']"));
  await flush();
  assertEquals(fake.calls.find((call) => call[0] === "undo"), [
    "undo",
    FINISHED.id,
  ]);
  assert(find(view.container, "[data-undo='opened']"));
  assertEquals(opened.reads.length, 0);
});

Deno.test("lophn-agent/observability#R20: 근거 본문이나 요청이 없으면 없다는 사실을 말하고 읽을 수 있는 범위를 보이며 종료 확인 전의 일은 성공으로 그리지 않는다", async () => {
  const running = work(2, {
    state: "running",
    outcome: null,
    finishedAt: null,
    requestMessage: null,
    origin: "schedule",
  });
  const fake = fakeRoles(base({
    works: { [LOPHN.id]: [running] },
    traces: {
      [running.id]: trace(running.id, {
        state: "running",
        outcome: null,
        finishedAt: null,
        missing: [{
          kind: "source",
          reference: "end_not_confirmed",
          reason: "end_not_confirmed",
        }],
        tools: {
          steps: 2,
          succeeded: 1,
          failed: [],
          denied: [],
          notExecuted: [],
          uncertain: [],
          unfinished: [toolId(2)],
          external: [],
        },
      }),
    },
  }));
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  await openWork(view.container, running.id);
  assertEquals(
    find(view.container, "[data-review-target]").textContent,
    "Repeating check",
  );
  assert(find(view.container, "[data-review-unconfirmed]"));
  assertEquals(view.container.querySelector("[data-review-reason]"), null);
  assertEquals(view.container.querySelector("[data-review-no-results]"), null);
  click(find(view.container, "[data-disclose-toggle='details']"));
  await flush();
  // 근거 본문을 못 읽으면 지어내지 않고 없다고 말한다.
  assert(find(view.container, "[data-basis='absent']"));
  assertEquals(
    find(view.container, "[data-readable]").textContent,
    "You can read 2 tool steps, 0 model calls, and 2 messages of this work.",
  );
  assert(find(view.container, "[data-missing]"));
});

Deno.test("lophn-agent/observability#R21: 도구 활동은 단계 수로 접어도 실패가 요약에 남고 펼치면 시작 순서로 대상·한 일·상태가 보이며 이름·입력·결과는 한 번 더 펼쳐야 읽는다", async () => {
  const steps = [
    ...Array.from({ length: 10 }, (_, index) => step(index + 1)),
    step(11, {
      effect: "external",
      outcome: "failure",
      code: "timeout",
      decision: {
        kind: "ask",
        reason: "It sends data outside.",
        byPerson: true,
      },
    }),
  ];
  const fake = fakeRoles(reviewData({
    traces: {
      [FINISHED.id]: trace(FINISHED.id, {
        tools: {
          steps: 11,
          succeeded: 10,
          failed: [toolId(11)],
          denied: [],
          notExecuted: [],
          uncertain: [],
          unfinished: [],
          external: [toolId(11)],
        },
      }),
    },
    steps: { [FINISHED.id]: steps },
    bodies: {
      [`tool_call_input:${toolId(1)}`]: {
        value: { title: "Notes" },
        truncated: false,
      },
      [`tool_call_output:${toolId(1)}`]: {
        value: { summary: "Wrote one." },
        truncated: false,
      },
    },
  }));
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  await openWork(view.container, FINISHED.id);
  click(find(view.container, "[data-disclose-toggle='details']"));
  await flush();
  // 접힌 요약: 단계 수와 성공 수, 그리고 실패 1단계가 보인다. 끝났다는 사실만으로 성공이라 하지 않는다.
  const folded = find(view.container, "[data-tools]");
  assert(folded.textContent!.includes("11 steps, 10 done"));
  assertEquals(
    find(folded, "[data-problem-chip='failed']").textContent,
    "1 failed",
  );
  assertEquals(view.container.querySelector("[data-step]"), null);
  click(find(view.container, "[data-disclose-toggle='tools']"));
  await flush();
  const listed = [...view.container.querySelectorAll("[data-step]")];
  assertEquals(listed.length, 11);
  assertEquals(listed[0]!.getAttribute("data-step"), toolId(1));
  assert(text(listed[0]!).includes("Changed · A document"));
  assert(text(listed[0]!).includes("Done"));
  assert(text(listed[10]!).includes("Used an outside tool"));
  assert(text(listed[10]!).includes("Failed"));
  // 이름·입력·원문 결과는 단계마다 한 번 더 펼쳐야 읽고 그때 본문을 읽는다.
  assertEquals(view.container.querySelector("[data-tool-name]"), null);
  assertEquals(
    fake.calls.filter((call) => call[0] === "body" && call[1] !== "run_basis")
      .length,
    0,
  );
  click(find(view.container, `[data-disclose-toggle='step-${toolId(1)}']`));
  await flush();
  assertEquals(
    find(view.container, "[data-tool-name]").textContent,
    "document.create",
  );
  const bodies = [...view.container.querySelectorAll("[data-body='ready']")]
    .map((
      item,
    ) => item.textContent);
  assert(bodies[0]!.includes("Notes"));
  assert(bodies[1]!.includes("Wrote one."));
  // 판단은 요약(이유 한 줄)으로만 보이고 사람이 허락한 것과 자동 확인이 구별된다.
  click(find(view.container, `[data-disclose-toggle='step-${toolId(11)}']`));
  await flush();
  const failedStep = find(view.container, `[data-step='${toolId(11)}']`);
  assert(text(failedStep).includes("You approved it"));
  assert(text(failedStep).includes("It sends data outside."));
  // 저장된 본문이 없는 단계는 없다고 말한다.
  assert(text(failedStep).includes("No saved copy of this."));
});

Deno.test("lophn-agent/observability#R22: 판단은 요약 글과 이유로만 보이고 model의 내부 사고를 보여 달라는 자리가 없다", async () => {
  const fake = fakeRoles(reviewData());
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  await openWork(view.container, FINISHED.id);
  click(find(view.container, "[data-disclose-toggle='details']"));
  await flush();
  assertEquals(
    find(view.container, "[data-judgment]").textContent,
    "lophn shows a short summary of why it decided, not its internal reasoning.",
  );
  // 열 수 있는 본문은 근거·도구 입력·도구 결과뿐이다. model 응답 본문은 읽지 않는다.
  for (const call of fake.calls.filter((item) => item[0] === "body")) {
    assert(call[1] === "run_basis" || String(call[1]).startsWith("tool_call_"));
  }
});

function attempt(n: number, over: Partial<ModelAttempt> = {}): ModelAttempt {
  return {
    id: `mcl_01h455vb4pex5v6nkc6gd5fd0${n}`,
    order: n,
    model: "claude-a",
    outcome: "complete",
    startedAt: "2026-10-06T08:00:00.000Z",
    durationMs: 1200,
    usage: { input: 1200, output: 80, cacheRead: 300, cacheWrite: null },
    cost: { kind: "reported", amount: "0.0123", currency: "USD" },
    billing: "api",
    ...over,
  };
}

Deno.test("lophn-agent/harness/usage#R7: 호출별 사용량은 실제 청구·추정·구독 포함·무료·모름을 구별하고 보고되지 않은 금액과 사용량은 0이 아니라 모름이다", async () => {
  const totals: UsageTotals = {
    calls: 5,
    costs: [
      { kind: "reported", amount: "0.0123", currency: "USD", calls: 1 },
      { kind: "unknown", amount: null, currency: null, calls: 2 },
    ],
    complete: false,
  };
  const fake = fakeRoles(reviewData({
    attempts: {
      [FINISHED.id]: [
        attempt(1),
        attempt(2, {
          cost: { kind: "estimated", amount: "0.5", currency: "USD" },
          billing: "api",
        }),
        attempt(3, {
          cost: { kind: "subscription", amount: null, currency: null },
          billing: "subscription",
        }),
        attempt(4, { cost: { kind: "free", amount: "0", currency: "USD" } }),
        attempt(5, {
          outcome: "failed",
          usage: {
            input: null,
            output: null,
            cacheRead: null,
            cacheWrite: null,
          },
          cost: { kind: "unknown", amount: null, currency: null },
          billing: "unknown",
        }),
      ],
    },
    usage: { [FINISHED.id]: totals },
  }));
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  await openWork(view.container, FINISHED.id);
  click(find(view.container, "[data-disclose-toggle='details']"));
  await flush();
  click(find(view.container, "[data-disclose-toggle='usage']"));
  await flush();
  const costs = [...view.container.querySelectorAll("[data-call] [data-cost]")]
    .map(
      (item) => [item.getAttribute("data-cost"), item.textContent],
    );
  assertEquals(costs, [
    ["billed", "Billed 0.0123 USD"],
    ["estimated", "About 0.5 USD, estimated"],
    ["subscription", "Included in your subscription"],
    ["free", "Free"],
    ["unknown", "Cost unknown"],
  ]);
  const calls = [...view.container.querySelectorAll("[data-call]")];
  assert(text(calls[0]!).includes("In 1,200"));
  assert(text(calls[0]!).includes("Cache read 300"));
  assert(!text(calls[0]!).includes("Cache write"));
  // 보고되지 않은 사용량은 0이 아니다.
  assert(text(calls[4]!).includes("Usage wasn't reported."));
  assert(!text(calls[4]!).includes("In 0"));
  assert(text(calls[4]!).includes("Failed"));
  const total = find(view.container, "[data-usage-total]");
  assert(text(total).includes("5 calls in total"));
  assert(text(total).includes("Cost unknown · 2 calls"));
  assert(find(total, "[data-usage-incomplete]"));
});

Deno.test("lophn-agent/observability#R16: export는 기본으로 내용 종류를 하나도 고르지 않은 메타데이터뿐이고 export마다 고른 종류만 보낸다", async () => {
  const fake = fakeRoles(reviewData());
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  await openWork(view.container, FINISHED.id);
  click(find(view.container, "[data-disclose-toggle='details']"));
  await flush();
  click(find(view.container, "[data-disclose-toggle='export']"));
  await flush();
  const boxes = [
    ...view.container.querySelectorAll(
      "[data-disclose='export'] [role=checkbox]",
    ),
  ];
  assertEquals(boxes.length, 5);
  assert(boxes.every((box) => box.getAttribute("aria-checked") === "false"));
  click(find(view.container, "[data-action='export']"));
  await flush();
  click(checkbox(view.container, "Tool results"));
  click(checkbox(view.container, "Messages"));
  click(find(view.container, "[data-action='export']"));
  await flush();
  const sent = fake.calls.filter((call) => call[0] === "export");
  assertEquals(sent[0], ["export", FINISHED.id, []]);
  assertEquals(sent[1], ["export", FINISHED.id, ["message", "tool_output"]]);
  assertEquals(
    find(view.container, "[data-export='done']").textContent,
    "Exported 3 records.",
  );
});

Deno.test("lophn-agent/observability#R17: 못 보낸 기록이 있으면 보낸 수와 못 보낸 수를 따로 보이고 취소와 실패는 성공으로 보이지 않는다", async () => {
  for (
    const [exported, expected] of [
      [{ ok: true as const, value: { sent: 2, notSent: 1 } }, "partial"],
      [{ ok: true as const, value: null }, "cancelled"],
      [{ ok: false as const, code: "unavailable" }, "failed"],
    ] as const
  ) {
    const fake = fakeRoles(reviewData({ exported }));
    const { element } = screen(fake, LOPHN.id);
    using view = render(element);
    await flush();
    await openWork(view.container, FINISHED.id);
    click(find(view.container, "[data-disclose-toggle='details']"));
    await flush();
    click(find(view.container, "[data-disclose-toggle='export']"));
    await flush();
    click(find(view.container, "[data-action='export']"));
    await flush();
    const shown = find(view.container, "[data-export]");
    if (expected === "partial") {
      assertEquals(shown.getAttribute("data-export"), "done");
      assertEquals(
        shown.textContent,
        "Exported 2 records. 1 record couldn't be exported.",
      );
    } else {
      assertEquals(shown.getAttribute("data-export"), expected);
    }
    assert(!text(view.container).includes("Exported 0"));
  }
});

function presetsOf() {
  return {
    lophn: [
      { id: PST_DEFAULT, revision: 1, definition: definition() },
      {
        id: PST_MINE,
        revision: 3,
        definition: definition({ name: "Mine", origin: "user" }),
      },
    ],
  };
}

Deno.test("lophn-agent/presets#R11: Preset은 기본과 사람이 고친 판을 보이고 쓰는 판은 명시 적용으로만 바뀌며 내부 구성은 펼친 자리에만 있다", async () => {
  const fake = fakeRoles(base({ presets: presetsOf() }));
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  pressTab(byText(view.container, "Preset"));
  await flush();
  const entries = [...view.container.querySelectorAll("[data-preset]")];
  assertEquals(entries.map((item) => item.getAttribute("data-origin")), [
    "product",
    "user",
  ]);
  const fixed = find(view.container, `[data-preset='${PST_DEFAULT}']`);
  assert(find(fixed, "[data-in-use]"));
  assertEquals(fixed.querySelector("[data-action='apply']"), null);
  // 내부 구성(prompt·capability)은 펼치기 전에는 없다.
  assertEquals(text(view.container).includes("Prompt"), false);
  const mine = find(view.container, `[data-preset='${PST_MINE}']`);
  assert(text(mine).includes("Version 3"));
  assertEquals(
    fake.calls.filter((call) => call[0] === "apply-preset").length,
    0,
  );
  click(find(mine, "[data-disclose-toggle^='inside-']"));
  assert(text(mine).includes("Prompt"));
  assert(text(mine).includes("documents, document.create"));
  click(find(mine, "[data-action='apply']"));
  await flush();
  assertEquals(fake.calls.find((call) => call[0] === "apply-preset"), [
    "apply-preset",
    LOPHN.id,
    PST_MINE,
    3,
  ]);
  assert(find(view.container, "[data-preset-notice='applied']"));
});

Deno.test("lophn-agent/presets#R12: 이전 판도 고를 수 있고 Operator의 Preset은 보호 승인으로만 바뀐다", async () => {
  const fake = fakeRoles(base({
    presets: {
      ...presetsOf(),
      operator: [{
        id: PST_MINE,
        revision: 1,
        definition: definition({ origin: "user", role: "operator" }),
      }],
    },
  }));
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  pressTab(byText(view.container, "Preset"));
  await flush();
  const mine = find(view.container, `[data-preset='${PST_MINE}']`);
  click(find(mine, "[data-disclose-toggle^='earlier-']"));
  assert(text(mine).includes("Version 2"));
  click(find(mine, "[data-action='apply-earlier']"));
  await flush();
  assertEquals(
    fake.calls.find((call) => call[0] === "apply-preset")?.slice(2),
    [
      PST_MINE,
      2,
    ],
  );
  // Operator는 보호된 승인으로만 바뀐다. 이전 판은 승인이 묶을 판 hash를 몰라 고르지 못한다.
  openRole(view.container, OPERATOR.id);
  await flush();
  pressTab(byText(view.container, "Preset"));
  await flush();
  assert(
    text(view.container).includes(
      "Switching an Operator's Preset asks for your approval in a protected window.",
    ),
  );
  assertEquals(
    view.container.querySelector("[data-action='apply-earlier']"),
    null,
  );
});

Deno.test("lophn-agent/presets#R7: 기본 Preset은 사본으로 저장하고 계정 순서·model·skill·MCP 개별 tool을 고른 새 판을 저장해도 쓰는 판은 바뀌지 않는다", async () => {
  const fake = fakeRoles(base({ presets: presetsOf(), choices: CHOICES }));
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  pressTab(byText(view.container, "Preset"));
  await flush();
  click(
    find(view.container, `[data-preset='${PST_DEFAULT}'] [data-action='edit']`),
  );
  await flush();
  assert(find(view.container, "[data-preset-editor]"));
  assert(text(view.container).includes("This is the default Preset."));
  // 이름·계정 순서·skill·MCP server와 개별 tool을 고른다.
  const name = find(view.container, "[data-preset-editor] input");
  assertEquals((name as HTMLInputElement).value, "lophn (copy)");
  typeInto(name, "Careful lophn");
  const decisions = find(view.container, "[data-editor='model-decisions']");
  click(find(decisions, "[data-action='account-add'][data-key='spare']"));
  click(find(decisions, "[data-account='spare'] [data-action='account-up']"));
  const orderOf = () =>
    [...decisions.querySelectorAll("[data-account]")].map((item) =>
      item.getAttribute("data-account")
    );
  assertEquals(orderOf(), ["spare", "main"]);
  const skillInput = find(view.container, "[data-editor='skills'] input");
  typeInto(skillInput, "pdf-tools");
  click(find(view.container, "[data-action='add-skill']"));
  click(checkbox(view.container, "files"));
  click(checkbox(view.container, "read_file"));
  click(find(view.container, "[data-action='save-preset']"));
  await flush();
  const saved = fake.calls.find((call) => call[0] === "save-preset")!;
  assertEquals(saved[1], PST_DEFAULT);
  const edited = saved[2] as ReturnType<typeof definition>;
  assertEquals(edited.name, "Careful lophn");
  assertEquals(edited.decisions?.accounts, ["spare", "main"]);
  assertEquals(edited.decisions?.provider, PVD);
  assertEquals(edited.skills, ["pdf-tools"]);
  assertEquals(edited.servers, ["files"]);
  assertEquals(edited.tools, [{ server: "files", tool: "read_file" }]);
  // 저장은 새 판일 뿐이고 쓰는 판을 바꾸는 적용은 사람이 따로 한다.
  assertEquals(
    fake.calls.filter((call) => call[0] === "apply-preset").length,
    0,
  );
  assert(
    find(view.container, "[data-preset-notice='saved']").textContent!.includes(
      "version 1",
    ),
  );
});

Deno.test("lophn-agent/presets#R12: 사람이 만든 Preset은 같은 Preset의 다음 판으로 저장하고 열어 둔 사이 바뀌었으면 덮지 않고 알린다", async () => {
  const fake = fakeRoles(
    base({ presets: presetsOf(), choices: CHOICES, saveFails: "conflict" }),
  );
  const { element } = screen(fake, LOPHN.id);
  using view = render(element);
  await flush();
  pressTab(byText(view.container, "Preset"));
  await flush();
  click(
    find(view.container, `[data-preset='${PST_MINE}'] [data-action='edit']`),
  );
  await flush();
  // 바꾸기 전에는 저장할 수 없다.
  assertEquals(
    find(view.container, "[data-action='save-preset']").hasAttribute(
      "disabled",
    ),
    true,
  );
  click(
    find(view.container, "[data-action='add-context'][data-kind='work_place']"),
  );
  assertEquals(
    find(view.container, "[data-action='save-preset']").hasAttribute(
      "disabled",
    ),
    false,
  );
  click(find(view.container, "[data-action='save-preset']"));
  await flush();
  assertEquals(
    fake.calls.find((call) => call[0] === "save-preset")?.[1],
    PST_MINE,
  );
  assert(
    text(find(view.container, "[data-editor-problem='changed']")).includes(
      "changed since you opened it",
    ),
  );
  assert(find(view.container, "[data-preset-editor]"));
});

Deno.test("shell/desktop#R4: 역할을 읽지 못하면 오류와 다시 시도를 보이고 다시 시도하면 목록이 선다", async () => {
  const data = base({ readsFail: true });
  const fake = fakeRoles(data);
  const { element } = screen(fake);
  using view = render(element);
  await flush();
  assert(text(view.container).includes("Couldn't load the roles."));
  assertEquals(view.container.querySelectorAll("[data-role]").length, 0);
  data.readsFail = false;
  click(byText(view.container, "Reload"));
  await flush();
  assertEquals(view.container.querySelectorAll("[data-role]").length, 5);
  assertEquals(ASG_LOPHN, LOPHN.id);
});
