// Operator 붙이기·Repeating check·보고·멈춤과 회수 화면(shell#T54). 값은 가짜 통로가 기록한다.
import { act } from "react";
import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../../packages/design/components/testing.ts";

import { RolesScreen } from "../roles-screen.tsx";
import { ConversationProvider } from "../../../../conversation/dock-slot.tsx";
import { DraftStore } from "../../../../conversation/drafts.ts";
import {
  agentMessage,
  manualTicks,
  sessionId,
} from "../../../../conversation/testdata/fake-source.ts";
import { byText, find, flush, pressTab, typeInto } from "../../testdata/dom.ts";
import {
  APP,
  APR,
  ASG_NEW,
  ASG_OPERATOR,
  definition,
  DOC_NOTES,
  DOC_REPORT,
  fakeRoles,
  type FakeRolesData,
  PRJ,
  role,
  VER_NOTES,
  VER_REPORT,
  work,
} from "../testdata/fake-roles.ts";
import {
  OperatorEntry,
  type OperatorEntrySource,
} from "../../../../workspace/operator-entry.tsx";
import type { OperatorDraft } from "./source.ts";
import type { RoleRow } from "../source.ts";

const NOW = Date.parse("2026-10-06T09:00:00Z");
const PST_OP = "pst_01h455vb4pex5v6nkc6gd5fd03";
const HASH = "a".repeat(64);
const DAY = 24 * 60 * 60 * 1000;

const LOPHN = role();
const OPERATOR = role({
  id: ASG_OPERATOR,
  role: "operator",
  scope: { kind: "project", id: PRJ },
  preset: { id: PST_OP, revision: 2 },
  presetName: "Operator",
  outputs: [DOC_REPORT],
  operator: {
    schedule: { firstAt: "2026-10-07T00:00:00.000Z", everyMs: DAY },
    lastDueAt: "2026-10-06T00:00:00.000Z",
    outputs: [{ document: DOC_REPORT, content: "Changes since last time" }],
    readApps: [APP],
    readCommands: [{ app: APP, command: "list_items" }],
    pause: null,
  },
});

const catalog = () =>
  Promise.resolve({
    ok: true as const,
    value: {
      projects: [{ id: PRJ, title: "Home" }],
      apps: [{ id: APP, title: "Groceries" }],
      contexts: [],
    },
  });

function operatorData(): NonNullable<FakeRolesData["operator"]> {
  return {
    presets: [{
      id: PST_OP,
      revision: 2,
      hash: HASH,
      definition: definition({
        name: "Operator",
        role: "operator",
        context: [{ kind: "assignment_scope", target: null, section: null }],
      }),
    }],
    outputs: {
      [`project:${PRJ}`]: [
        { id: DOC_REPORT, title: "Weekly report", version: VER_REPORT },
        { id: DOC_NOTES, title: "Notes", version: VER_NOTES },
      ],
    },
    reads: {
      [APP]: [{ app: APP, command: "list_items", label: "List items" }],
    },
    versions: { [DOC_REPORT]: VER_REPORT },
    settled: ["waiting", "attached"],
  };
}

interface Opened {
  readonly reads: [string, string | null][];
  readonly confirms: number[];
}

function mount(
  fake: ReturnType<typeof fakeRoles>,
  over: {
    initialRole?: string;
    initialAttach?: { kind: "project"; id: string };
  } = {},
) {
  const opened: Opened = { reads: [], confirms: [] };
  const ticks = manualTicks();
  const element = (
    <ConversationProvider
      deps={{
        source: fake.conversation(LOPHN).source,
        drafts: new DraftStore(),
        ticks: ticks.ticks,
      }}
    >
      <RolesScreen
        source={fake.source}
        catalog={catalog}
        now={() => NOW}
        pollMs={60_000}
        initialRole={over.initialRole}
        initialAttach={over.initialAttach}
        onRead={(document, version) => opened.reads.push([document, version])}
        onConfirm={() => opened.confirms.push(1)}
      />
    </ConversationProvider>
  );
  return { element, opened };
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

function typeArea(area: Element, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function text(root: Element): string {
  return root.textContent ?? "";
}

function draftOf(fake: ReturnType<typeof fakeRoles>): OperatorDraft {
  const call = fake.calls.find((item) => item[0] === "propose");
  assert(call !== undefined, "propose was not called");
  return call[1] as OperatorDraft;
}

async function fillAttach(root: Element) {
  click(find(root, "[data-action='attach']"));
  await flush();
  click(find(root, `[data-choice='scope:project:${PRJ}']`));
  await flush();
  click(checkbox(root, "Weekly report"));
  typeArea(
    find(root, `[data-attach-output='${DOC_REPORT}'] textarea`),
    "What changed this week",
  );
  click(checkbox(root, "Groceries"));
  await flush();
  click(checkbox(root, "List items"));
  click(find(root, "[data-choice='every:week']"));
  typeInto(find(root, "[data-attach-first]"), "2026-10-08T09:00");
  await flush();
}

Deno.test("lophn-agent/assignments#R4: Operator는 project에 붙이고 Preset·읽을 자료·보고할 문서·Repeating check를 정한 구성 전체가 보호 확인으로 넘어가며 승인 전에는 붙지 않는다", async () => {
  const fake = fakeRoles({
    roles: [LOPHN],
    operator: operatorData(),
  });
  const { element } = mount(fake);
  using view = render(element);
  await flush();
  await fillAttach(view.container);
  // 고를 수 있는 것은 Preset의 context, 보고로 쓸 수 있는 기존 문서, 읽게 할 앱 명령뿐이다.
  assert(find(view.container, "[data-attach-context]").textContent!.includes(
    "What this role is attached to",
  ));
  click(find(view.container, "[data-action='attach-review']"));
  await flush();
  const draft = draftOf(fake);
  assertEquals(draft.change, null);
  assertEquals(draft.scope, { kind: "project", id: PRJ });
  assertEquals(draft.preset.id, PST_OP);
  assertEquals(draft.preset.hash, HASH);
  assertEquals(draft.outputs, [{
    document: DOC_REPORT,
    content: "What changed this week",
    version: VER_REPORT,
  }]);
  assertEquals(draft.reads, [{ app: APP, command: "list_items" }]);
  assertEquals(draft.period, {
    firstAt: new Date("2026-10-08T09:00").toISOString(),
    everyMs: 7 * DAY,
  });
  // 창에서 결정하는 동안은 붙지 않았다. 결정을 기다린다고 말하고 구성 화면은 닫힌다.
  assert(find(view.container, "[data-attach='waiting']"));
  assert(
    text(view.container).includes(
      "Review the details in the window that opened. Nothing starts until you approve.",
    ),
  );
  assertEquals(view.container.querySelector("[data-attach='edit']"), null);
});

Deno.test("lophn-agent/assignments#R4: 허락되면 붙은 Operator가 목록에 서고 거절되면 아무것도 바뀌지 않았다고 말하며 허락 뒤 적용이 막히면 실패로 말한다", async () => {
  // 허락.
  const accepted = fakeRoles({ roles: [LOPHN], operator: operatorData() });
  const first = mount(accepted);
  {
    using view = render(first.element);
    await flush();
    await fillAttach(view.container);
    click(find(view.container, "[data-action='attach-review']"));
    await flush();
    accepted.data.roles = [
      LOPHN,
      role({
        id: ASG_NEW,
        role: "operator",
        scope: { kind: "project", id: PRJ },
        outputs: [DOC_REPORT],
      }),
    ];
    click(find(view.container, "[data-action='attach-check']"));
    await flush();
    assertEquals(view.container.querySelector("[data-attach]"), null);
    assert(find(view.container, `[data-role-detail='${ASG_NEW}']`));
  }
  // 거절·취소·만료.
  const declined = fakeRoles({
    roles: [LOPHN],
    operator: { ...operatorData(), settled: ["declined"] },
  });
  {
    using view = render(mount(declined).element);
    await flush();
    await fillAttach(view.container);
    click(find(view.container, "[data-action='attach-review']"));
    await flush();
    assert(find(view.container, "[data-attach='declined']"));
    assert(text(view.container).includes("Not attached. Nothing changed."));
  }
  // 허락했지만 적용이 막혔다.
  const failed = fakeRoles({
    roles: [LOPHN],
    operator: { ...operatorData(), settleFails: "conflict" },
  });
  {
    using view = render(mount(failed).element);
    await flush();
    await fillAttach(view.container);
    click(find(view.container, "[data-action='attach-review']"));
    await flush();
    assert(find(view.container, "[data-attach='failed']"));
    assert(
      text(view.container).includes(
        "You approved it, but it couldn't be applied. Nothing changed.",
      ),
    );
  }
});

Deno.test("lophn-agent/assignments#R6: 같은 project에 Operator를 여럿 붙일 수 있고 보고할 문서는 고르고 남길 판단 항목을 적어야 검토할 수 있다", async () => {
  // 이미 Operator가 하나 붙은 project에 두 번째를 붙인다. 새로 붙이는 것이라 바꾸는 대상이 없다.
  const fake = fakeRoles({
    roles: [LOPHN, OPERATOR],
    operator: operatorData(),
  });
  const { element } = mount(fake, {
    initialAttach: { kind: "project", id: PRJ },
  });
  using view = render(element);
  await flush();
  // 붙일 곳이 정해져 열렸다.
  assert(find(view.container, "[data-attach-fixed]").textContent === "Home");
  const review = find(view.container, "[data-action='attach-review']");
  assertEquals(review.hasAttribute("disabled"), true);
  click(checkbox(view.container, "Notes"));
  // 문서만 골라서는 안 된다. 남길 판단 항목이 있어야 한다.
  assertEquals(review.hasAttribute("disabled"), true);
  typeArea(
    find(view.container, `[data-attach-output='${DOC_NOTES}'] textarea`),
    "Open questions",
  );
  await flush();
  assertEquals(review.hasAttribute("disabled"), false);
  click(review);
  await flush();
  const draft = draftOf(fake);
  assertEquals(draft.change, null);
  assertEquals(draft.scope, { kind: "project", id: PRJ });
  assertEquals(draft.outputs.map((item) => item.document), [DOC_NOTES]);
});

Deno.test("lophn-agent/scheduling#R7: 처음 시각이 지금보다 앞이면 보호 확인으로 넘기지 않고 알리며 문서가 없는 곳은 보고할 곳이 없다고 말한다", async () => {
  const fake = fakeRoles({
    roles: [LOPHN],
    operator: { ...operatorData(), outputs: {} },
  });
  const { element } = mount(fake, {
    initialAttach: { kind: "project", id: PRJ },
  });
  using view = render(element);
  await flush();
  assert(
    text(view.container).includes(
      "No document here can take reports yet. A report goes into a document that already has a saved version.",
    ),
  );
  // 문서가 있는 곳에서 지난 시각을 고르면 막힌다.
  const withDocuments = fakeRoles({ roles: [LOPHN], operator: operatorData() });
  using second = render(
    mount(withDocuments, { initialAttach: { kind: "project", id: PRJ } })
      .element,
  );
  await flush();
  click(checkbox(second.container, "Weekly report"));
  typeArea(
    find(second.container, `[data-attach-output='${DOC_REPORT}'] textarea`),
    "Changes",
  );
  typeInto(find(second.container, "[data-attach-first]"), "2026-10-01T00:00");
  await flush();
  click(find(second.container, "[data-action='attach-review']"));
  await flush();
  assert(
    text(second.container).includes(
      "Pick a first check that is later than now.",
    ),
  );
  assertEquals(
    withDocuments.calls.find((call) => call[0] === "propose"),
    undefined,
  );
});

Deno.test("platform/approvals#R5: 보호 확인 창을 열지 못하면 승인 요청이 남지 않았다고 말하고 기다림으로 넘어가지 않는다", async () => {
  const fake = fakeRoles({
    roles: [LOPHN],
    operator: { ...operatorData(), proposeFails: "unavailable" },
  });
  const { element } = mount(fake, {
    initialAttach: { kind: "project", id: PRJ },
  });
  using view = render(element);
  await flush();
  click(checkbox(view.container, "Weekly report"));
  typeArea(
    find(view.container, `[data-attach-output='${DOC_REPORT}'] textarea`),
    "Changes",
  );
  await flush();
  click(find(view.container, "[data-action='attach-review']"));
  await flush();
  assert(find(view.container, "[data-attach-problem='open']"));
  assertEquals(view.container.querySelector("[data-attach='waiting']"), null);
  assertEquals(fake.calls.find((call) => call[0] === "settle"), undefined);
});

Deno.test("shell/desktop#R5: 붙은 Operator는 Repeating check·보고할 문서·읽는 앱을 보이고 멈춤은 바로 되며 다시 시작은 따로 있다", async () => {
  const fake = fakeRoles({
    roles: [LOPHN, OPERATOR],
    titles: { [DOC_REPORT]: "Weekly report" },
  });
  const { element } = mount(fake, { initialRole: OPERATOR.id });
  using view = render(element);
  await flush();
  const panel = find(view.container, `[data-operator-panel='${OPERATOR.id}']`);
  assert(text(find(panel, "[data-operator-every]")).startsWith("Every day"));
  assert(
    text(find(panel, "[data-operator-outputs]")).includes("Weekly report"),
  );
  assert(text(find(panel, "[data-operator-reads]")).includes("May read 1 app"));
  assertEquals(
    find(panel, "[data-operator-last]").textContent!.startsWith(
      "Last check was due",
    ),
    true,
  );
  click(find(panel, "[data-action='pause']"));
  await flush();
  assertEquals(fake.calls.find((call) => call[0] === "pause"), [
    "pause",
    OPERATOR.id,
  ]);
});

Deno.test("shell/desktop#R5: 멈춘 Operator는 멈춘 이유에 맞는 안내와 다시 시작을 보이고 멈춤 단추는 없다", async () => {
  const paused = (
    kind:
      | "user"
      | "consecutive_failures"
      | "scope_archived"
      | "output_archived",
  ): RoleRow => ({
    ...OPERATOR,
    state: "paused",
    operator: {
      ...OPERATOR.operator!,
      pause: { kind, detail: "x" },
    },
  });
  for (
    const [kind, sentence] of [
      ["user", "You paused it. Nothing repeats until you resume it."],
      [
        "consecutive_failures",
        "It paused itself after three checks in a row failed.",
      ],
      [
        "scope_archived",
        "It paused because the project or app it watches was archived.",
      ],
      [
        "output_archived",
        "It paused because a document it reports to was archived.",
      ],
    ] as const
  ) {
    const fake = fakeRoles({ roles: [paused(kind)] });
    using view = render(mount(fake, { initialRole: OPERATOR.id }).element);
    await flush();
    assert(
      text(find(view.container, `[data-operator-pause='${kind}']`)).startsWith(
        sentence,
      ),
    );
    assert(find(view.container, "[data-action='resume']"));
    assertEquals(view.container.querySelector("[data-action='pause']"), null);
  }
});

Deno.test("shell/desktop#R4: 회수는 한 번 더 묻고 지키면 아무것도 바뀌지 않으며 회수하면 그 Operator의 멈춤·회수 행동이 사라진다", async () => {
  const fake = fakeRoles({ roles: [LOPHN, OPERATOR] });
  const { element } = mount(fake, { initialRole: OPERATOR.id });
  using view = render(element);
  await flush();
  click(find(view.container, "[data-action='withdraw']"));
  assert(find(view.container, "[data-withdraw-ask]"));
  click(find(view.container, "[data-action='withdraw-keep']"));
  assertEquals(fake.calls.some((call) => call[0] === "withdraw"), false);
  click(find(view.container, "[data-action='withdraw']"));
  // 회수하면 목록을 다시 읽고 회수된 담당이 된다.
  fake.data.roles = [LOPHN, { ...OPERATOR, state: "withdrawn" }];
  click(find(view.container, "[data-action='withdraw-confirm']"));
  await flush();
  assertEquals(
    fake.calls.find((call) => call[0] === "withdraw"),
    ["withdraw", OPERATOR.id],
  );
  assertEquals(view.container.querySelector("[data-action='pause']"), null);
  assertEquals(view.container.querySelector("[data-action='withdraw']"), null);
  assert(text(view.container).includes("This role was removed."));
});

Deno.test("shell/desktop#R4: 회수된 Operator는 지난 대화만 읽고 입력창이 없으며 만든 것은 문서로 열린다", async () => {
  const withdrawn: RoleRow = { ...OPERATOR, state: "withdrawn" };
  const fake = fakeRoles({
    roles: [withdrawn],
    made: {
      [withdrawn.id]: [{
        document: DOC_REPORT,
        version: VER_REPORT,
        work: null,
      }],
    },
    titles: { [DOC_REPORT]: "Weekly report" },
  });
  const talk = fake.conversation(withdrawn);
  talk.state.sessions = [{ id: sessionId(1), state: "open", stateSeq: "10" }];
  talk.state.messages = { [sessionId(1)]: [agentMessage(1)] };
  talk.state.bodies = {
    [agentMessage(1).id]: [{ kind: "text", text: "Last Monday's report" }],
  };
  const { element, opened } = mount(fake, { initialRole: withdrawn.id });
  using view = render(element);
  await flush();
  assert(text(view.container).includes("This role was removed."));
  pressTab(byText(view.container, "Conversation"));
  await flush();
  assert(text(view.container).includes("Last Monday's report"));
  assertEquals(view.container.querySelector("[data-composer]"), null);
  // 보고는 만든 것에서 문서로 연다.
  pressTab(byText(view.container, "Made"));
  await flush();
  click(find(view.container, `[data-result^='${DOC_REPORT}']`));
  assertEquals(opened.reads, [[DOC_REPORT, VER_REPORT]]);
});

Deno.test("lophn-agent/scheduling#R5: 사람의 답을 기다리느라 건너뛴 회차는 그 사실과 확인할 것으로 가는 길을 보이고 단순히 이전 확인이 안 끝나 건너뛴 것과 구별한다", async () => {
  const fake = fakeRoles({
    roles: [OPERATOR],
    operator: {
      skipped: {
        [OPERATOR.id]: [
          { dueAt: "2026-10-06T00:00:00.000Z", waitingForAnswer: true },
          { dueAt: "2026-10-05T00:00:00.000Z", waitingForAnswer: false },
        ],
      },
    },
    works: {
      [OPERATOR.id]: [
        work(1, {
          state: "waiting_user",
          outcome: null,
          finishedAt: null,
          origin: "schedule",
          requestMessage: null,
        }),
      ],
    },
  });
  const { element, opened } = mount(fake, { initialRole: OPERATOR.id });
  using view = render(element);
  await flush();
  const rows = [...view.container.querySelectorAll("[data-skipped]")];
  assertEquals(rows.map((row) => row.getAttribute("data-skipped")), [
    "waiting",
    "busy",
  ]);
  assert(text(rows[0]!).includes("skipped while waiting for your answer"));
  assert(
    text(rows[1]!).includes("skipped because the last check hadn't finished"),
  );
  // 답이 필요한 질문만 things-to-confirm으로 간다. 지난 회차 줄에서도 같은 곳으로 간다.
  click(find(rows[0]!, "[data-action='answer']"));
  assertEquals(rows[1]!.querySelector("[data-action='answer']"), null);
  click(
    find(view.container, "[data-work-group='waiting'] [data-action='answer']"),
  );
  assertEquals(opened.confirms.length, 2);
  // 정기 회차가 만든 일은 Repeating check로 구별된다.
  assert(
    text(find(view.container, "[data-work-group='waiting']")).includes(
      "Repeating check",
    ),
  );
});

Deno.test("lophn-agent/assignments#R5: Operator의 Preset은 가장 새 판을 같은 구성(문서·읽는 앱·주기)과 함께 보호 승인으로만 바꾸고 거절하면 그대로다", async () => {
  const entry = {
    id: PST_OP,
    revision: 3,
    hash: "b".repeat(64),
    definition: definition({ name: "Operator", role: "operator" as const }),
  };
  const fake = fakeRoles({
    roles: [OPERATOR],
    presets: { operator: [entry] },
    operator: { ...operatorData(), settled: ["waiting", "attached"] },
  });
  const { element } = mount(fake, { initialRole: OPERATOR.id });
  using view = render(element);
  await flush();
  pressTab(byText(view.container, "Preset"));
  await flush();
  click(find(view.container, "[data-action='apply']"));
  await flush();
  const draft = draftOf(fake);
  assertEquals(draft.change?.id, OPERATOR.id);
  assertEquals(draft.preset.revision, 3);
  assertEquals(draft.preset.hash, "b".repeat(64));
  // 붙은 곳·보고할 문서(검토한 지금 판)·읽는 앱·주기는 그대로 묶인다.
  assertEquals(draft.scope, { kind: "project", id: PRJ });
  assertEquals(draft.outputs, [{
    document: DOC_REPORT,
    content: "Changes since last time",
    version: VER_REPORT,
  }]);
  assertEquals(draft.reads, [{ app: APP, command: "list_items" }]);
  assertEquals(draft.period, OPERATOR.operator!.schedule);
  assert(find(view.container, `[data-approval-wait='${APR}']`));
  click(find(view.container, "[data-action='attach-check']"));
  await flush();
  assert(
    text(view.container).includes(
      "Approved and switched. The next check uses this version.",
    ),
  );
  // 이 화면은 Preset을 직접 바꾸지 않는다.
  assertEquals(
    fake.calls.find((call) => call[0] === "apply-preset"),
    undefined,
  );
});

Deno.test("shell/desktop#R4: 작업대는 이 프로젝트에 붙은 Operator 수를 알려 주고 붙이기와 붙은 것 보기로 roles 화면을 연다", async () => {
  const asked: string[] = [];
  const opened: string[] = [];
  const source = (count: number): OperatorEntrySource => ({
    operators(project) {
      asked.push(project);
      return Promise.resolve({
        ok: true,
        value: Array.from({ length: count }, (_, index) => ({
          id: `asg_0${index}`,
          state: "enabled" as const,
        })),
      });
    },
  });
  using none = render(
    <OperatorEntry
      project={PRJ}
      source={source(0)}
      onAttach={(project) => opened.push(`attach:${project}`)}
      onOpen={(id) => opened.push(`open:${id}`)}
    />,
  );
  await flush();
  assert(
    text(none.container).includes("No Operator repeats a check here yet"),
  );
  assertEquals(
    none.container.querySelector("[data-action='see-operators']"),
    null,
  );
  click(find(none.container, "[data-action='attach-operator']"));
  using two = render(
    <OperatorEntry
      project={PRJ}
      source={source(2)}
      onAttach={(project) => opened.push(`attach:${project}`)}
      onOpen={(id) => opened.push(`open:${id}`)}
    />,
  );
  await flush();
  assert(text(two.container).includes("2 Operators repeat checks here"));
  click(find(two.container, "[data-action='see-operators']"));
  assertEquals(opened, [`attach:${PRJ}`, "open:asg_00"]);
  assertEquals(asked, [PRJ, PRJ]);
});
