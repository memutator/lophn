import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../../../packages/design/components/testing.ts";

import {
  find,
  flush,
  typeInto,
} from "../../../desktop/lophn-space/testdata/dom.ts";
import { TasksTab } from "./tasks-tab.tsx";
import type { TuiSession } from "./source.ts";
import {
  APP,
  CAC_DESK,
  detail,
  fakeTasks,
  type FakeTasksOptions,
  now,
  PRJ,
  STARTABLE,
  TKT_CANCELLED,
  TKT_CONFIRMED,
  TKT_FAILED,
  TKT_PREPARING,
  TKT_READY,
  TKT_REPORTED,
  TKT_WORKING,
} from "./testdata/fake-source.ts";

// 안쪽 이름·ID는 기본 화면 글에 없다. 펼친 자리(details)는 빼고 본다(coding-agent/tickets#R27).
const INTERNAL = [
  "tkt_",
  "app_",
  "cac_",
  "prj_",
  "ticket",
  "claim",
  "snapshot",
  "ledger",
  "needs_confirmation",
  "in_progress",
  "check_failed",
  "waiting_input",
  "folder_ref",
];

function visibleText(root: Element): string {
  const shown = root.cloneNode(true) as Element;
  for (const folded of shown.querySelectorAll("details")) folded.remove();
  return shown.textContent ?? "";
}

function noInternal(root: Element): void {
  const text = visibleText(root).toLowerCase();
  for (const word of INTERNAL) {
    assert(!text.includes(word), `기본 화면 글에 ${word}가 있다`);
  }
}

function textOf(root: Element): string {
  return root.textContent ?? "";
}

interface OpenOptions extends FakeTasksOptions {
  initialTask?: string | null;
  initialCreate?: boolean;
  copied?: string[];
  copyFails?: boolean;
}

async function open(options: OpenOptions = {}) {
  const fake = fakeTasks(options);
  const copied = options.copied ?? [];
  const view = render(
    <TasksTab
      app={APP}
      source={fake.source}
      now={now}
      initialTask={options.initialTask ?? null}
      initialCreate={options.initialCreate ?? false}
      clipboard={{
        writeText: (text) => {
          if (options.copyFails) return Promise.reject(new Error("denied"));
          copied.push(text);
          return Promise.resolve();
        },
      }}
    />,
  );
  await flush();
  return { fake, view, copied };
}

function typeIntoArea(area: Element, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

Deno.test("coding-agent#T27, shell/wording#R4: 목록은 화면 상태 일곱 값과 다음 행동을 en 문구로 바꿔 보이고 안쪽 값·ID가 없다", async () => {
  const { view } = await open();
  using _ = view;
  const rows = [...view.container.querySelectorAll("[data-tasks-list] > li")];
  assertEquals(rows.map((item) => item.getAttribute("data-task")), [
    "ready",
    "needs_confirmation",
    "in_progress",
    "reported",
    "confirmed",
    "check_failed",
    "cancelled",
  ]);
  const states = [
    "Ready",
    "Getting ready",
    "In progress",
    "Reported",
    "Confirmed",
    "Check failed",
    "Cancelled",
  ];
  rows.forEach((item, index) =>
    assertStringIncludes(textOf(item), states[index]!)
  );
  // 다음 행동은 정확히 하나이고 할 일이 없는 상태(작업 중·취소)에는 없다.
  const nexts = rows.map((item) =>
    item.querySelector("[data-task-next]")?.getAttribute("data-task-next") ??
      null
  );
  assertEquals(nexts, [
    "start",
    "needs_confirmation",
    null,
    "waiting_for_approval",
    "check_result",
    "start",
    null,
  ]);
  assertStringIncludes(textOf(rows[0]!), "Ready to start");
  assertStringIncludes(textOf(rows[1]!), "Needs your decisions");
  assertStringIncludes(textOf(rows[3]!), "Waiting for approval");
  assertStringIncludes(textOf(rows[4]!), "Look at the result");
  noInternal(view.container);
});

Deno.test("shell/wording#R10: 일이 없으면 없다고 하고 읽기에 실패하면 실패한 대상과 다시 읽기를 보인다", async () => {
  {
    const { view } = await open({ list: { ok: true, value: [] } });
    using _ = view;
    assertStringIncludes(
      textOf(find(view.container, "[data-tasks-empty]")),
      "No tasks for this app yet",
    );
  }
  {
    const { view } = await open({ list: { ok: false, code: "unavailable" } });
    using _ = view;
    const error = find(view.container, "[data-state='error']");
    assertStringIncludes(textOf(error), "your tasks");
    assert(error.querySelector("button") !== null);
  }
});

Deno.test("flow start-coding-agent 1·2: 준비된 Task의 [Start]는 하나뿐인 harness·연결·폴더를 미리 고르고 확인 창 없이 정확한 값을 보낸다", async () => {
  const { fake, view } = await open({ initialTask: TKT_READY });
  using _ = view;
  const detailEl = find(view.container, "[data-task-detail]");
  assertEquals(detailEl.getAttribute("data-task-detail"), "ready");
  assertStringIncludes(
    textOf(find(detailEl, "[data-task-title]")),
    "Add a receipt filter",
  );
  assertStringIncludes(
    textOf(find(detailEl, "[data-task-request]")),
    "filter receipts by month",
  );
  // 고를 것이 하나뿐이면 고르는 단추를 보이지 않고 무엇으로 열리는지만 말한다.
  assertEquals(view.container.querySelector("[data-start-choice]"), null);
  assertStringIncludes(
    textOf(find(detailEl, "[data-start-with]")),
    "Opens Claude Code in /work/notes.",
  );
  const start = find(detailEl, "[data-action='start']") as HTMLButtonElement;
  assert(!start.disabled);
  click(start);
  await flush();
  assertEquals(fake.calls.start, [{
    ticket: TKT_READY,
    revision: "12",
    connection: CAC_DESK,
    harness: "claude",
    profile: null,
    project: PRJ,
    folderRef: `${PRJ}_0`,
  }]);
  assertStringIncludes(
    textOf(find(view.container, "[data-start-result='started']")),
    "Opened in a terminal on this computer",
  );
  // 시작 접수는 Task가 작업 중이라는 말이 아니다. 같은 클릭을 다시 보내지 못한다.
  assert(
    (find(view.container, "[data-action='start']") as HTMLButtonElement)
      .disabled,
  );
  assertEquals(fake.calls.start.length, 1);
  noInternal(view.container);
});

Deno.test("flow start-coding-agent 2: 등록된 project 폴더가 여럿이면 폴더를 고른 뒤에만 시작할 수 있고 고른 폴더를 보낸다", async () => {
  const folders = [
    {
      project: PRJ,
      project_name: "Notes",
      folder_ref: `${PRJ}_0`,
      path: "/work/notes",
    },
    {
      project: PRJ,
      project_name: "Notes",
      folder_ref: `${PRJ}_1`,
      path: "/work/notes-b",
    },
  ];
  const { fake, view } = await open({
    initialTask: TKT_READY,
    choices: { ok: true, value: { ...STARTABLE, folders } },
  });
  using _ = view;
  const start = () =>
    find(view.container, "[data-action='start']") as HTMLButtonElement;
  assert(start().disabled, "폴더를 고르기 전에는 누를 수 없다");
  const group = find(view.container, "[data-start-choice='folder']");
  const options = [...group.querySelectorAll("[data-start-option]")];
  assertEquals(options.map(textOf), [
    "Notes: /work/notes",
    "Notes: /work/notes-b",
  ]);
  click(options[1]!);
  await flush();
  assert(!start().disabled);
  assertStringIncludes(
    textOf(find(view.container, "[data-start-with]")),
    "/work/notes-b",
  );
  click(start());
  await flush();
  assertEquals(fake.calls.start[0]?.folderRef, `${PRJ}_1`);
  assertEquals(fake.calls.start.length, 1);
});

Deno.test("flow start-coding-agent 1: harness나 연결이 여럿이면 고르게 하고 고르기 전에는 시작하지 않는다", async () => {
  const { fake, view } = await open({
    initialTask: TKT_READY,
    choices: {
      ok: true,
      value: {
        harnesses: [
          { id: "claude", profile: null },
          { id: "codex", profile: "work" },
        ],
        connections: [
          { id: CAC_DESK, label: "Desk Claude" },
          { id: "cac_01h455vb4pex5v6nkc6gd5fd09", label: "Budget only" },
        ],
        folders: STARTABLE.folders,
      },
    },
  });
  using _ = view;
  const start = () =>
    find(view.container, "[data-action='start']") as HTMLButtonElement;
  assert(start().disabled);
  const harnesses = [
    ...find(view.container, "[data-start-choice='harness']")
      .querySelectorAll("[data-start-option]"),
  ];
  assertEquals(harnesses.map(textOf), ["Claude Code", "Codex"]);
  click(harnesses[1]!);
  await flush();
  // harness만 고르면 아직 연결이 비어 있다.
  assert(start().disabled);
  const connections = [
    ...find(view.container, "[data-start-choice='connection']")
      .querySelectorAll("[data-start-option]"),
  ];
  assertEquals(connections.map(textOf), ["Desk Claude", "Budget only"]);
  click(connections[1]!);
  await flush();
  click(start());
  await flush();
  assertEquals(fake.calls.start.length, 1);
  assertEquals(fake.calls.start[0]?.harness, "codex");
  assertEquals(fake.calls.start[0]?.profile, "work");
  assertEquals(
    fake.calls.start[0]?.connection,
    "cac_01h455vb4pex5v6nkc6gd5fd09",
  );
});

Deno.test("flow start-coding-agent 다른 갈래: 감지된 harness·연결·등록 폴더가 없으면 시작 대신 무엇을 먼저 할지 말한다", async () => {
  const cases: [Partial<typeof STARTABLE>, string, string][] = [
    [{ harnesses: [] }, "harness", "No coding agent was found"],
    [{ connections: [] }, "connection", "Connect a coding agent in Settings"],
    [{ folders: [] }, "folder", "Add a project folder first"],
  ];
  for (const [patch, kind, text] of cases) {
    const { fake, view } = await open({
      initialTask: TKT_READY,
      choices: { ok: true, value: { ...STARTABLE, ...patch } },
    });
    using _ = view;
    assertStringIncludes(
      textOf(find(view.container, `[data-start-missing='${kind}']`)),
      text,
    );
    assertEquals(view.container.querySelector("[data-action='start']"), null);
    assertEquals(fake.calls.start, []);
  }
});

Deno.test("flow start-coding-agent 다른 갈래: 시작하지 못하면 이유 한 문장만 보이고 다른 harness·폴더로 바꿔 다시 보내지 않는다", async () => {
  const reasons: [string, string][] = [
    ["folder_changed", "isn't registered anymore"],
    ["ticket_changed", "This task changed after you opened it"],
    ["connection_unavailable", "connection can't be used right now"],
    ["plan_refused", "isn't ready for it"],
    ["host_refused", "terminal didn't open"],
    ["something_else", "Couldn't start the coding agent"],
  ];
  for (const [reason, text] of reasons) {
    const { fake, view } = await open({
      initialTask: TKT_READY,
      start: { ok: true, value: { ok: false, reason, ownTerminal: false } },
    });
    using _ = view;
    click(find(view.container, "[data-action='start']"));
    await flush();
    assertStringIncludes(
      textOf(find(view.container, "[data-start-result='refused']")),
      text,
    );
    assertEquals(fake.calls.start.length, 1);
    assertEquals(
      view.container.querySelector("[data-start-result='started']"),
      null,
    );
    // 다시 눌러 새로 시작할 수 있다. 자동 재시도는 없다.
    assert(
      !(find(view.container, "[data-action='start']") as HTMLButtonElement)
        .disabled,
    );
  }
  const own = await open({
    initialTask: TKT_READY,
    start: {
      ok: true,
      value: { ok: false, reason: "plan_refused", ownTerminal: true },
    },
  });
  using _own = own.view;
  click(find(own.view.container, "[data-action='start']"));
  await flush();
  assertStringIncludes(
    textOf(find(own.view.container, "[data-start-result='refused']")),
    "Use your own terminal instead",
  );
  const lost = await open({
    initialTask: TKT_READY,
    start: { ok: false, code: "unavailable" },
  });
  using _lost = lost.view;
  click(find(lost.view.container, "[data-action='start']"));
  await flush();
  assert(
    lost.view.container.querySelector("[data-start-result='failed']") !== null,
  );
});

Deno.test("flow start-coding-agent 자기 터미널, coding-agent/sessions#R8: 복사할 요청 문장은 펼친 자리에 있고 복사하면 그 문장 그대로 clipboard에 간다", async () => {
  const { view, copied } = await open({ initialTask: TKT_READY });
  using _ = view;
  const own = find(view.container, "[data-section='own-terminal']");
  const sentence = textOf(find(own, "[data-request-sentence]"));
  assertStringIncludes(sentence, TKT_READY);
  assertStringIncludes(sentence, "Let me filter receipts by month.");
  // 기본 화면 글에는 문장이 없다.
  assert(!visibleText(view.container).includes(TKT_READY));
  assertStringIncludes(textOf(own), "doesn't open it or keep track of it");
  click(find(own, "[data-action='copy-request']"));
  await flush();
  assertEquals(copied, [sentence]);
  assertEquals(
    textOf(find(own, "[data-copy-result='copied']")),
    "Copied.",
  );
});

Deno.test("shell/wording#R10: 복사하지 못하면 실패를 알리고 성공했다고 하지 않는다", async () => {
  const { view } = await open({ initialTask: TKT_READY, copyFails: true });
  using _ = view;
  click(find(view.container, "[data-action='copy-request']"));
  await flush();
  assert(view.container.querySelector("[data-copy-result='failed']") !== null);
  assertEquals(
    view.container.querySelector("[data-copy-result='copied']"),
    null,
  );
});

function session(over: Partial<TuiSession>): TuiSession {
  return {
    ticket: TKT_WORKING,
    tui: "working",
    promptDelivery: "delivered",
    ...over,
  };
}

Deno.test("coding-agent/sessions#R6, R9, shell/terminal#R12: TUI 상태 여섯 값과 첫 prompt 전달 결과는 Task 상태와 따로 보이고 모르는 것은 모른다고 한다", async () => {
  const states: [TuiSession["tui"], string][] = [
    ["starting", "Starting"],
    ["ready", "Ready for input"],
    ["working", "Working"],
    ["waiting_input", "Waiting for you"],
    ["ended", "Ended"],
    ["unknown", "Status unknown"],
  ];
  for (const [tui, label] of states) {
    const { view } = await open({
      initialTask: TKT_WORKING,
      sessions: { ok: true, value: [session({ tui })] },
    });
    using _ = view;
    const section = find(view.container, "[data-section='tui']");
    assertEquals(section.getAttribute("data-tui"), tui);
    assertStringIncludes(textOf(section), label);
    assertStringIncludes(textOf(section), "separate from the task's status");
    // Task 상태는 TUI와 상관없이 그 줄에 따로 있다.
    assertStringIncludes(
      textOf(find(view.container, "[data-task-detail]")),
      "In progress",
    );
    noInternal(view.container);
  }
  const prompts: [TuiSession["promptDelivery"], string | null][] = [
    ["none", null],
    ["pending", "Sending the first message"],
    ["delivered", "first message reached"],
    ["not_delivered", "didn't reach"],
    ["unknown", "couldn't confirm"],
  ];
  for (const [promptDelivery, text] of prompts) {
    const { view } = await open({
      initialTask: TKT_WORKING,
      sessions: { ok: true, value: [session({ promptDelivery })] },
    });
    using _ = view;
    const line = view.container.querySelector("[data-prompt]");
    if (text === null) assertEquals(line, null);
    else assertStringIncludes(textOf(line!), text);
  }
});

Deno.test("coding-agent/sessions#R9: 다른 Task의 TUI는 보이지 않고 연 TUI가 없으면 TUI 줄을 만들어 내지 않는다", async () => {
  const { view } = await open({
    initialTask: TKT_WORKING,
    sessions: { ok: true, value: [session({ ticket: TKT_READY })] },
  });
  using _ = view;
  assertEquals(view.container.querySelector("[data-section='tui']"), null);
  const none = await open({ initialTask: TKT_READY });
  using _none = none.view;
  assertEquals(none.view.container.querySelector("[data-section='tui']"), null);
});

Deno.test("coding-agent/tickets#R14, flow manage-tickets 5: claim이 풀려 다시 준비된 일은 이전 터미널이 멈췄다고 알리고 [Start]로 다시 맡기게 한다", async () => {
  for (const tui of ["ended", "unknown"] as const) {
    const { view } = await open({
      initialTask: TKT_READY,
      sessions: { ok: true, value: [session({ ticket: TKT_READY, tui })] },
    });
    using _ = view;
    assertStringIncludes(
      textOf(find(view.container, "[data-task-start-again]")),
      "The earlier terminal stopped",
    );
    assert(view.container.querySelector("[data-action='start']") !== null);
  }
  // 아직 살아 있는 터미널이 있으면 다시 맡기라고 하지 않는다.
  const alive = await open({
    initialTask: TKT_READY,
    sessions: {
      ok: true,
      value: [session({ ticket: TKT_READY, tui: "working" })],
    },
  });
  using _alive = alive.view;
  assertEquals(
    alive.view.container.querySelector("[data-task-start-again]"),
    null,
  );
});

Deno.test("coding-agent/tickets#R18, R19, flow manage-tickets 6: 완료 주장·실제 검사·남은 확인은 서로 다른 줄이고 보고가 있다고 확인됨이 되지 않는다", async () => {
  const reported = detail({
    id: TKT_REPORTED,
    state: "reported",
    next: "waiting_for_approval",
    reported: true,
    checks: [
      { condition: 0, result: "pass" },
      { condition: 1, result: "inconclusive" },
    ],
    remaining: [1],
  });
  const { view } = await open({
    initialTask: TKT_REPORTED,
    details: { [TKT_REPORTED]: { ok: true, value: reported } },
  });
  using _ = view;
  const checks = find(view.container, "[data-section='checks']");
  assertStringIncludes(
    textOf(find(checks, "[data-check='claim']")),
    "It says the work is done. That isn't the same as checked.",
  );
  const results = [...checks.querySelectorAll("[data-check-result]")];
  assertEquals(results.map((item) => item.getAttribute("data-check-result")), [
    "pass",
    "inconclusive",
  ]);
  assertStringIncludes(textOf(results[0]!), "The app's own tests pass: Passed");
  assertStringIncludes(textOf(results[1]!), "You confirm it: Not confirmed");
  // 미확인은 통과 색이 아니다.
  assertEquals(
    results[0]!.querySelector("[data-tone]")?.getAttribute("data-tone"),
    "good",
  );
  assertEquals(
    results[1]!.querySelector("[data-tone]")?.getAttribute("data-tone"),
    "warning",
  );
  assertStringIncludes(
    textOf(find(checks, "[data-check='remaining']")),
    "You confirm it",
  );
  // 상태는 확인됨이 아니라 보고됨이다.
  assertStringIncludes(
    textOf(find(view.container, "[data-task-detail]")),
    "Reported",
  );
  noInternal(view.container);
});

Deno.test("coding-agent/tickets#R19: 실제 실패는 실패로, 보고 전에는 주장 없음으로 보이고 아무것도 보고되지 않았으면 검사 칸을 만들지 않는다", async () => {
  const failed = detail({
    id: TKT_FAILED,
    state: "check_failed",
    next: "start",
    reported: true,
    checks: [{ condition: 0, result: "fail" }],
    remaining: [0],
  });
  const { view } = await open({
    initialTask: TKT_FAILED,
    details: { [TKT_FAILED]: { ok: true, value: failed } },
  });
  using _ = view;
  const result = find(view.container, "[data-check-result='fail']");
  assertStringIncludes(textOf(result), "Failed");
  assertEquals(
    result.querySelector("[data-tone]")?.getAttribute("data-tone"),
    "serious",
  );
  // 확인 실패한 일은 다시 맡길 수 있다.
  assert(view.container.querySelector("[data-action='start']") !== null);
  const fresh = await open({ initialTask: TKT_READY });
  using _fresh = fresh.view;
  assertEquals(
    fresh.view.container.querySelector("[data-section='checks']"),
    null,
  );
  const notYet = detail({
    id: TKT_WORKING,
    state: "in_progress",
    checks: [{ condition: 0, result: "pass" }],
  });
  const partial = await open({
    initialTask: TKT_WORKING,
    details: { [TKT_WORKING]: { ok: true, value: notYet } },
  });
  using _partial = partial.view;
  assertStringIncludes(
    textOf(find(partial.view.container, "[data-check='claim']")),
    "hasn't said it's done yet",
  );
  assertEquals(
    partial.view.container.querySelector("[data-check='remaining']"),
    null,
  );
});

Deno.test("coding-agent/tickets#R27: 기한·조건 목록은 기본 화면이 아니라 펼친 자리에만 있다", async () => {
  const held = detail({
    id: TKT_WORKING,
    state: "in_progress",
    heldUntil: "2026-10-07T12:45:00Z",
  });
  const { view } = await open({
    initialTask: TKT_WORKING,
    details: { [TKT_WORKING]: { ok: true, value: held } },
  });
  using _ = view;
  const folded = find(view.container, "[data-task-details]");
  assertStringIncludes(textOf(folded), "Held until");
  assertStringIncludes(textOf(folded), "The app's own tests pass");
  assert(!visibleText(view.container).includes("Held until"));
  assert(!visibleText(view.container).includes("own tests pass"));
});

Deno.test("coding-agent/tickets#R22, R23, flow manage-tickets 다른 갈래: 한 줄 사유로 취소하고 확인 창 없이 본 판과 사유만 보낸다", async () => {
  const { fake, view } = await open({ initialTask: TKT_READY });
  using _ = view;
  click(find(view.container, "[data-action='ask-cancel']"));
  await flush();
  const form = find(view.container, "[data-cancel-form]");
  const submit = () =>
    find(form, "[data-action='cancel-task']") as HTMLButtonElement;
  assert(submit().disabled, "사유가 없으면 취소할 수 없다");
  typeInto(find(form, "[data-cancel-reason]"), "   ");
  assert(submit().disabled, "공백뿐인 사유는 안 된다");
  typeInto(find(form, "[data-cancel-reason]"), "x".repeat(201));
  assert(submit().disabled, "200자를 넘는 사유는 안 된다");
  typeInto(find(form, "[data-cancel-reason]"), "I changed my mind.");
  assert(!submit().disabled);
  click(submit());
  await flush();
  assertEquals(fake.calls.cancel, [{
    ticket: TKT_READY,
    revision: "12",
    reason: "I changed my mind.",
  }]);
  // 취소 뒤 현재 Task를 다시 읽는다.
  assert(fake.calls.get.length >= 2);
});

Deno.test("coding-agent/tickets#R22: 낡은 판의 취소는 conflict 문장으로, 그 밖의 실패는 취소되지 않았다고 알리고 사유를 그대로 둔다", async () => {
  for (
    const [code, text] of [
      ["conflict", "This task changed after you opened it"],
      ["unavailable", "Couldn't cancel this task"],
    ] as const
  ) {
    const { fake, view } = await open({
      initialTask: TKT_READY,
      cancel: { ok: false, code },
    });
    using _ = view;
    click(find(view.container, "[data-action='ask-cancel']"));
    await flush();
    typeInto(find(view.container, "[data-cancel-reason]"), "Not needed.");
    click(find(view.container, "[data-action='cancel-task']"));
    await flush();
    assertStringIncludes(
      textOf(find(view.container, "[data-cancel-result]")),
      text,
    );
    assertEquals(fake.calls.cancel.length, 1);
    assertEquals(
      (find(view.container, "[data-cancel-reason]") as HTMLInputElement).value,
      "Not needed.",
    );
  }
});

Deno.test("coding-agent/tickets#R22: 끝났거나 이미 취소된 Task에는 취소가 없고 사유 입력은 접을 수 있다", async () => {
  for (const id of [TKT_CONFIRMED, TKT_CANCELLED]) {
    const { view } = await open({ initialTask: id });
    using _ = view;
    assertEquals(view.container.querySelector("[data-section='cancel']"), null);
  }
  const { view } = await open({ initialTask: TKT_READY });
  using _ = view;
  click(find(view.container, "[data-action='ask-cancel']"));
  await flush();
  click(find(view.container, "[data-action='keep-task']"));
  await flush();
  assertEquals(view.container.querySelector("[data-cancel-form]"), null);
  assert(view.container.querySelector("[data-action='ask-cancel']") !== null);
});

Deno.test("coding-agent/tickets#R3, flow manage-tickets 1: 준비 중인 Task는 사람이 정할 것을 보이고 [Start]는 열지 않는다", async () => {
  const preparing = detail({
    id: TKT_PREPARING,
    state: "needs_confirmation",
    next: "needs_confirmation",
    needs: ["Choose what to adopt before this can start."],
  });
  const { view } = await open({
    initialTask: TKT_PREPARING,
    details: { [TKT_PREPARING]: { ok: true, value: preparing } },
  });
  using _ = view;
  assertStringIncludes(
    textOf(find(view.container, "[data-section='needs']")),
    "Choose what to adopt",
  );
  assertEquals(view.container.querySelector("[data-action='start']"), null);
  assertEquals(
    view.container.querySelector("[data-section='own-terminal']"),
    null,
  );
});

Deno.test("flow manage-tickets 1, coding-agent/tickets#R3: 사람이 새 Task를 만들면 제목·원하는 결과·이유만 보내고 준비 중 Task로 열린다", async () => {
  const { fake, view } = await open();
  using _ = view;
  click(find(view.container, "[data-action='new-task']"));
  await flush();
  const form = find(view.container, "[data-create-form]");
  const submit = () =>
    find(form, "[data-action='create-task']") as HTMLButtonElement;
  assert(submit().disabled);
  typeInto(find(form, "[data-create-title]"), "Add a tag filter");
  typeIntoArea(find(form, "[data-create-what]"), "Filter receipts by tag.");
  assert(submit().disabled, "이유가 없으면 만들 수 없다");
  typeIntoArea(find(form, "[data-create-why]"), "I use tags a lot.");
  assert(!submit().disabled);
  click(submit());
  await flush();
  assertEquals(fake.calls.create, [{
    app: APP,
    draft: {
      title: "Add a tag filter",
      what: "Filter receipts by tag.",
      why: "I use tags a lot.",
    },
  }]);
  // 만든 Task의 상세가 열린다.
  assert(view.container.querySelector("[data-task-detail]") !== null);
  assertEquals(fake.calls.get.at(-1), TKT_PREPARING);
});

Deno.test("flow manage-tickets 1: 만들지 못하면 아무것도 더해지지 않았다고 알리고 입력은 그대로다", async () => {
  const { fake, view } = await open({
    create: { ok: false, code: "conflict" },
  });
  using _ = view;
  click(find(view.container, "[data-action='new-task']"));
  await flush();
  const form = find(view.container, "[data-create-form]");
  typeInto(find(form, "[data-create-title]"), "A title");
  typeIntoArea(find(form, "[data-create-what]"), "What");
  typeIntoArea(find(form, "[data-create-why]"), "Why");
  click(find(form, "[data-action='create-task']"));
  await flush();
  assertStringIncludes(
    textOf(find(view.container, "[data-create-failed]")),
    "Nothing was added",
  );
  assertEquals(fake.calls.create.length, 1);
  assertEquals(
    (find(form, "[data-create-title]") as HTMLInputElement).value,
    "A title",
  );
  assertEquals(view.container.querySelector("[data-task-detail]"), null);
});

Deno.test("coding-agent#T25: 링크로 온 Task는 그 상세로, 링크로 온 앱은 새 Task 입력을 펼친 채 열린다", async () => {
  const task = await open({ initialTask: TKT_READY });
  using _task = task.view;
  assert(task.view.container.querySelector("[data-task-detail]") !== null);
  assertEquals(task.fake.calls.get, [TKT_READY]);
  const create = await open({ initialCreate: true });
  using _create = create.view;
  assert(create.view.container.querySelector("[data-create-form]") !== null);
  click(find(create.view.container, "[data-action='cancel-create']"));
  await flush();
  assertEquals(create.view.container.querySelector("[data-create-form]"), null);
});

Deno.test("shell/wording#R10: Task 상세를 읽지 못하면 실패한 대상과 다시 읽기를 보이고 목록으로 돌아갈 수 있다", async () => {
  const { view } = await open({
    initialTask: TKT_READY,
    details: { [TKT_READY]: { ok: false, code: "unavailable" } },
  });
  using _ = view;
  assertStringIncludes(
    textOf(find(view.container, "[data-state='error']")),
    "your tasks",
  );
  click(find(view.container, "[data-task-back]"));
  await flush();
  assert(view.container.querySelector("[data-tasks-list]") !== null);
});
