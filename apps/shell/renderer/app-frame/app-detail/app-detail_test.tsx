import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  click,
  render,
} from "../../../../../packages/design/components/testing.ts";

import {
  find,
  flush,
  pressTab,
} from "../../desktop/lophn-space/testdata/dom.ts";
import { AppDetail } from "./app-detail.tsx";
import { Loadable } from "./loadable.tsx";
import { useRead } from "./use-read.ts";
import type { PreviewOpen } from "./model.ts";
import type { GrantRow } from "./source.ts";
import {
  ACCESS,
  activity,
  APP,
  fakeDetail,
  type FakeOptions,
  now,
  OTHER,
  REL_2,
  REL_3,
  REL_4,
  REL_5,
  version,
  VERSIONS,
} from "./testdata/fake-source.ts";

// 안쪽 개념 이름과 원시 값은 기본 화면 글에 없다(shell/wording#R4, R6).
const INTERNAL = [
  "rel_",
  "app_",
  "grt_",
  "vrf_",
  "tkt_",
  "invocation",
  "release",
  "grant",
  "prepared",
  "superseded",
  "activating",
  "automation.run",
  "net.fetch",
  "fs.read",
];

function detail(
  options: FakeOptions = {},
  props: {
    preview?: PreviewOpen | null;
    onPreview?: (next: PreviewOpen | null) => void;
    onInstructions?: () => void;
    issues?: React.ReactNode;
    tasks?: React.ReactNode;
  } = {},
) {
  const fake = fakeDetail(options);
  const ui = (
    <AppDetail
      app={APP}
      name="Grocery budget"
      source={fake.source}
      preview={props.preview ?? null}
      onPreview={props.onPreview ?? (() => {})}
      onInstructions={props.onInstructions}
      issues={props.issues}
      tasks={props.tasks}
      now={now}
    />
  );
  return { fake, ui };
}

async function openTab(root: HTMLElement, tab: string): Promise<void> {
  pressTab(
    find(root, `[role=tab][data-radix-collection-item][id$="trigger-${tab}"]`),
  );
  await flush();
}

function textOf(root: Element): string {
  return root.textContent ?? "";
}

function noInternal(root: Element, allowed: readonly string[] = []): void {
  // 자세히 보기(<details>) 안은 원문이 있어도 되는 자리다(shell/wording#R12).
  const shown = root.cloneNode(true) as Element;
  for (const folded of shown.querySelectorAll("details")) folded.remove();
  const text = textOf(shown).toLowerCase();
  for (const word of INTERNAL) {
    if (allowed.includes(word)) continue;
    assert(!text.includes(word), `기본 화면 글에 ${word}가 있다`);
  }
}

Deno.test("shell/wording#R4: Version 탭은 지금 쓰는 Version과 다른 Version을 사람 말로 보이고 안쪽 ID·enum이 없다", async () => {
  const { ui } = detail();
  using view = render(ui);
  await flush();
  const current = find(view.container, "[data-section='current']");
  assertStringIncludes(textOf(current), "Version 3");
  assertStringIncludes(textOf(current), "In use");
  const others = [...view.container.querySelectorAll(
    "[data-section='others'] [data-version]",
  )];
  assertEquals(others.map((row) => row.getAttribute("data-version")), [
    REL_4,
    REL_2,
  ]);
  assertStringIncludes(textOf(others[0]), "Version 4");
  assertStringIncludes(textOf(others[0]), "Saved, not in use");
  assertStringIncludes(textOf(others[1]), "Older version");
  noInternal(view.container);
});

Deno.test("shell/wording#R4: 준비·적용·시작 확인·Task 확인은 서로 다른 결과 줄이고 당시 Test result는 지금 앱의 증명이 아니라고 적는다", async () => {
  const { ui } = detail();
  using view = render(ui);
  await flush();
  // 지금 쓰는 Version: 저장·적용·시작 확인·Test result가 따로 있다.
  const current = find(view.container, "[data-section='current']");
  assertEquals(
    [...current.querySelectorAll("[data-fact]")].map((fact) =>
      fact.getAttribute("data-fact")
    ),
    ["saved", "applied", "start", "test"],
  );
  assertEquals(find(current, "[data-fact='applied']").textContent, "In use");
  assertEquals(
    find(current, "[data-fact='start']").textContent,
    "Started and responding",
  );
  assertEquals(
    find(current, "[data-fact='test']").textContent?.trim(),
    "Passed",
  );
  assertStringIncludes(
    textOf(find(current, "[data-test-scope]")),
    "doesn't prove the app works today",
  );
  // 다른 Version을 펼치면 준비만 된 것은 적용되지 않았고 Task 확인이 따로 보인다.
  click(
    find(view.container, `[data-version='${REL_4}'] [data-version-expand]`),
  );
  await flush();
  const prepared = find(view.container, `[data-version='${REL_4}']`);
  assertEquals(
    [...prepared.querySelectorAll("[data-fact]")].map((fact) =>
      fact.getAttribute("data-fact")
    ),
    ["saved", "applied", "task", "test"],
  );
  assertEquals(
    find(prepared, "[data-fact='applied']").textContent,
    "Not in use",
  );
  assertEquals(
    find(prepared, "[data-fact='task']").textContent,
    "All checks passed",
  );
  noInternal(view.container);
});

Deno.test("shell/wording#R4: 시작 확인과 Task 확인이 안 됐으면 적용됐다는 사실과 합치지 않고 그대로 따로 보인다", async () => {
  const { ui } = detail({
    start: { release: REL_3, ready: false },
    task: { reported: true, passed: 1, failed: 1, unclear: 0 },
    tests: [{ id: "vrf_01h455vb4pex5v6nkc6gd5fd01", result: "fail" }],
  });
  using view = render(ui);
  await flush();
  const current = find(view.container, "[data-section='current']");
  assertEquals(find(current, "[data-fact='applied']").textContent, "In use");
  assertEquals(
    find(current, "[data-fact='start']").textContent,
    "Not confirmed yet",
  );
  assertEquals(
    find(current, "[data-fact='test']").textContent?.trim(),
    "Failed",
  );
  click(
    find(view.container, `[data-version='${REL_4}'] [data-version-expand]`),
  );
  await flush();
  assertEquals(
    find(view.container, `[data-version='${REL_4}'] [data-fact='task']`)
      .textContent,
    "Some checks failed",
  );
});

Deno.test("shell/wording#R12: 바뀐 것은 개수로 요약하고 이름·원문은 자세히 보기 안에만 있으며 검토 필요를 표시한다", async () => {
  const { ui } = detail();
  using view = render(ui);
  await flush();
  click(
    find(view.container, `[data-version='${REL_4}'] [data-version-expand]`),
  );
  await flush();
  const changes = find(view.container, "[data-changes]");
  const lines = textOf(find(changes, "[data-change-lines]"));
  assertStringIncludes(lines, "1 action added");
  assertStringIncludes(lines, "1 action behaves differently");
  assertStringIncludes(lines, "1 action can change things outside lophn");
  assertStringIncludes(lines, "1 new permission asked");
  assertStringIncludes(lines, "Saved data changes from format 2 to 3");
  // 이름은 앱이 지은 원문이라 자세히 보기 안에만 있다.
  const details = find(changes, "[data-change-details]");
  assertStringIncludes(textOf(details), "add_item");
  assertStringIncludes(textOf(details), "net.fetch:api.example.com:443");
  assert(!lines.includes("add_item"));
  assert(!lines.includes("net.fetch"));
  assert(find(changes, "[data-review-needed]"));
  assertStringIncludes(
    textOf(find(changes, "[data-data-warning]")),
    "won't convert it back",
  );
});

Deno.test("shell/wording#R10: Version을 고르면 확인 창만 열고 바로 바꾸지 않으며 열지 못하면 다음 행동을 적는다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  click(find(view.container, `[data-version='${REL_4}'] [data-use-version]`));
  await flush();
  const decisions = fake.calls.filter((call) => call[0] === "decide");
  assertEquals(decisions, [["decide", {
    kind: "use_version",
    app: APP,
    release: REL_4,
  }]]);
  // 결정은 확인 창에서만 받는다. 기다리는 중이라고만 보이고 다시 누르지 못한다.
  const row = find(view.container, `[data-version='${REL_4}']`);
  assertStringIncludes(
    textOf(find(row, "[data-decision-waiting]")),
    "confirmation window",
  );
  assert((find(row, "[data-use-version]") as HTMLButtonElement).disabled);
  // 지금 쓰는 Version에는 고르기가 없다.
  assertEquals(
    find(view.container, "[data-section='current']").querySelectorAll(
      "[data-use-version]",
    ).length,
    0,
  );
});

Deno.test("shell/wording#R10: 확인 창을 열지 못하면 무엇이 안 열렸는지와 다시 시도를 적는다", async () => {
  const { ui } = detail({ decideFails: true });
  using view = render(ui);
  await flush();
  click(find(view.container, `[data-version='${REL_2}'] [data-use-version]`));
  await flush();
  const failed = find(view.container, "[data-decision-failed]");
  assertEquals(
    textOf(failed),
    "The confirmation window didn't open. Try again.",
  );
});

Deno.test("shell/wording#R10: 적용에 실패한 Version은 현재 Version이 그대로라고 적고 안쪽 근거는 자세히 보기에 둔다", async () => {
  const failedList = {
    current: REL_3,
    versions: [
      version(REL_5, 5, "failed", { failure: "migration step 2 stopped" }),
      ...VERSIONS.versions.filter((entry) => entry.id !== REL_4),
    ],
  };
  const { ui } = detail({ versions: failedList });
  using view = render(ui);
  await flush();
  click(
    find(view.container, `[data-version='${REL_5}'] [data-version-expand]`),
  );
  await flush();
  const row = find(view.container, `[data-version='${REL_5}']`);
  assertEquals(
    textOf(find(row, "[data-apply-failed]")),
    "Version 5 couldn't be applied. Your current version is unchanged.",
  );
  assertEquals(
    find(row, "[data-fact='applied']").textContent,
    "Couldn't be applied",
  );
  assertStringIncludes(
    textOf(find(row, "details")),
    "migration step 2 stopped",
  );
  assert(!textOf(find(row, "[data-apply-failed]")).includes("migration"));
});

Deno.test("shell/wording#R4: Version의 [Open preview]는 지금 쓰는 앱이 아니라 그 Version의 preview를 열고 닫을 수 있다", async () => {
  const opened: (PreviewOpen | null)[] = [];
  const { fake, ui } = detail({}, { onPreview: (next) => opened.push(next) });
  fake.source.blueprint = (app, release) => {
    fake.calls.push(["blueprint-of", app, release]);
    return Promise.resolve({
      ok: true,
      value: {
        release: release ?? REL_3,
        commands: [],
        automations: [],
        connections: [],
        fullScreen: release === REL_4 ? "new-home" : "home",
      },
    });
  };
  using view = render(ui);
  await flush();
  click(find(view.container, `[data-version='${REL_4}'] [data-preview-open]`));
  await flush();
  assertEquals(fake.calls.find((call) => call[0] === "startPreview"), [
    "startPreview",
    APP,
    REL_4,
  ]);
  assertEquals(fake.calls.find((call) => call[0] === "blueprint-of"), [
    "blueprint-of",
    APP,
    REL_4,
  ]);
  assertEquals(opened, [{
    release: REL_4,
    number: 4,
    screen: "new-home",
    nonce: "nonce-1",
  }]);
  // 이미 쓰는 Version과 older Version에는 preview 단추가 없다.
  assertEquals(
    view.container.querySelectorAll("[data-preview-open]").length,
    1,
  );
});

Deno.test("shell/wording#R10: preview를 열지 못하면 지금 쓰는 앱은 그대로라고 적는다", async () => {
  const { ui } = detail({ previewFails: true });
  using view = render(ui);
  await flush();
  click(find(view.container, `[data-version='${REL_4}'] [data-preview-open]`));
  await flush();
  assertEquals(
    textOf(find(view.container, "[data-preview-failed]")),
    "The preview didn't open. Your app in use isn't affected.",
  );
});

Deno.test("shell/wording#R10: 열린 preview가 있으면 그 Version의 [Close preview]로 닫는다", async () => {
  const opened: (PreviewOpen | null)[] = [];
  const { ui } = detail({}, {
    preview: { release: REL_4, number: 4, screen: "home", nonce: "nonce-1" },
    onPreview: (next) => opened.push(next),
  });
  using view = render(ui);
  await flush();
  click(find(view.container, `[data-version='${REL_4}'] [data-preview-close]`));
  assertEquals(opened, [null]);
});

Deno.test("shell/wording#R12: Access는 경로·host·secret 이름 원문을 고정폭으로 줄이지 않고 보이고 조합 경고를 먼저 둔다", async () => {
  const { ui } = detail();
  using view = render(ui);
  await flush();
  await openTab(view.container, "access");
  const body = find(view.container, "[data-tab-body='access']");
  const first = body.firstElementChild!;
  assertEquals(
    first.getAttribute("data-access-warning"),
    "permissions.warning.file-read-and-network",
  );
  assertStringIncludes(textOf(first), "could send what it reads elsewhere");
  // 갈래별 제목과 원문.
  assertEquals(
    textOf(find(body, "[data-access-group='fs.read'] h3")),
    "Files this app can read",
  );
  assertEquals(
    find(body, "[data-access-group='fs.read'] [data-exact]").textContent,
    "/home/pat/Documents/budget/receipts",
  );
  assertEquals(
    find(body, "[data-access-group='net.fetch'] [data-exact]").textContent,
    "api.example.com:443",
  );
  assertEquals(
    find(body, "[data-access-group='secret.use'] [data-exact]").textContent,
    "BANK_TOKEN",
  );
  // 아직 허락하지 않은 요구는 이유와 함께 따로 있다.
  const asks = find(body, "[data-access-asks]");
  assertStringIncludes(textOf(asks), "rates.example.org:443");
  assertStringIncludes(textOf(asks), "Looks up exchange rates");
  // 안쪽 이름(kind 값·ID)은 글에 없다.
  noInternal(body);
});

Deno.test("shell/wording#R10: Access를 바꾸거나 회수하는 것은 확인 창으로 보내고 회수는 요청 접수와 실제 정리를 구별한다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  await openTab(view.container, "access");
  click(find(view.container, "[data-change-access]"));
  await flush();
  const grant = ACCESS.grants[0];
  click(
    find(view.container, `[data-grant='${grant.id}'] [data-remove-access]`),
  );
  await flush();
  assertEquals(
    fake.calls.filter((call) => call[0] === "decide").map((call) => call[1]),
    [
      { kind: "change_access", app: APP, requirement: 0 },
      { kind: "remove_access", app: APP, grant: grant.id },
    ],
  );
  // 요청만 접수했다. 아직 회수 완료가 아니다.
  const row = find(view.container, `[data-grant='${grant.id}']`);
  assertEquals(row.getAttribute("data-revoke"), "requested");
  assertEquals(
    textOf(find(row, "[data-removing]")),
    "Removal was requested. It isn't finished yet.",
  );
  assert((find(row, "[data-remove-access]") as HTMLButtonElement).disabled);
  // 이 목록에는 완료 표시가 이 grant에 없다.
  assert(!textOf(row).includes("Access was removed"));
});

Deno.test("shell/wording#R10: 프로세스 종료를 기다리는 동안은 회수가 끝난 것이 아니라고 적는다", async () => {
  const { ui } = detail({
    runtime: { state: "running", terminationPending: true },
  });
  using view = render(ui);
  await flush();
  await openTab(view.container, "access");
  const grant = ACCESS.grants[0];
  click(
    find(view.container, `[data-grant='${grant.id}'] [data-remove-access]`),
  );
  await flush();
  const row = find(view.container, `[data-grant='${grant.id}']`);
  assertEquals(row.getAttribute("data-revoke"), "waiting-stop");
  assertEquals(
    textOf(find(row, "[data-removing]")),
    "Removal was requested. Waiting for the app to stop before it counts as removed.",
  );
});

Deno.test("shell/wording#R10: 회수가 끝난 접근은 지난 목록에 있고 secret 값이 실제로 지워졌는지는 확인한 것만 따로 말한다", async () => {
  const removedSecret: GrantRow = {
    id: "grt_01h455vb4pex5v6nkc6gd5fd09",
    kind: "secret.use",
    active: false,
    exact: "OLD_TOKEN",
    targetApp: null,
    commands: [],
    automation: null,
    inputHash: null,
  };
  const access = { ...ACCESS, grants: [...ACCESS.grants, removedSecret] };
  const stored = detail({
    access,
    secrets: [
      { name: "BANK_TOKEN", stored: true },
      { name: "OLD_TOKEN", stored: true },
    ],
  });
  using view = render(stored.ui);
  await flush();
  await openTab(view.container, "access");
  const removed = find(view.container, "[data-access-removed]");
  assertStringIncludes(textOf(removed), "Access was removed.");
  assertStringIncludes(textOf(removed), "OLD_TOKEN");
  // 접근이 회수됐어도 저장된 값이 남아 있으면 지웠다고 하지 않는다.
  assertStringIncludes(textOf(removed), "The saved value is still stored.");
  assert(!textOf(removed).includes("The saved value was deleted."));
  assertStringIncludes(
    textOf(find(view.container, "[data-access-caveat]")),
    "doesn't undo what the app already read",
  );
});

Deno.test("shell/wording#R10: 회수한 secret의 저장된 값이 지워졌으면 지웠다고 말한다", async () => {
  const removedSecret: GrantRow = {
    id: "grt_01h455vb4pex5v6nkc6gd5fd09",
    kind: "secret.use",
    active: false,
    exact: "OLD_TOKEN",
    targetApp: null,
    commands: [],
    automation: null,
    inputHash: null,
  };
  const { ui } = detail({
    access: { ...ACCESS, grants: [removedSecret] },
    secrets: [{ name: "OLD_TOKEN", stored: false }],
  });
  using view = render(ui);
  await flush();
  await openTab(view.container, "access");
  assertStringIncludes(
    textOf(find(view.container, "[data-access-removed]")),
    "The saved value was deleted.",
  );
});

Deno.test("shell/wording#R4: Automations는 선언한 일과 주기·고정 입력·지금 시작할 수 있는지·확인한 활동을 따로 보이고 승인이 필요한 일은 꺼져 있다", async () => {
  const { ui } = detail({
    activity: [
      activity("inv_1", {
        status: "succeeded",
        trigger: { kind: "automation", key: "refresh" },
        caller: "automation",
      }),
    ],
  });
  using view = render(ui);
  await flush();
  await openTab(view.container, "automations");
  const weekly = find(view.container, "[data-automation='weekly_report']");
  assertEquals(weekly.getAttribute("data-on"), "off");
  assertStringIncludes(textOf(weekly), "Weekly report");
  assertEquals(
    find(weekly, "[data-fact='action']").textContent,
    "Send the weekly report",
  );
  assertEquals(
    find(weekly, "[data-fact='schedule']").textContent,
    "Every 60 minutes",
  );
  assertEquals(
    find(weekly, "[data-fact='input']").textContent,
    "Saved with the app",
  );
  // 선언·실행 가능·실제 확인은 다른 줄이다.
  assertEquals(find(weekly, "[data-fact='can-start']").textContent, "Yes");
  assertEquals(find(weekly, "[data-fact='seen']").textContent, "Not yet");
  assertStringIncludes(
    textOf(find(weekly, "[data-observed-at]")),
    "Last checked",
  );
  assertEquals(
    textOf(find(weekly, "[data-last-activity]")),
    "No activity yet.",
  );
  // external이 아닌 일은 별도 승인이 없고 앱을 따른다.
  const refresh = find(view.container, "[data-automation='refresh']");
  assertEquals(refresh.getAttribute("data-on"), "on");
  assert(refresh.querySelector("[data-follows-app]"));
  assertEquals(
    refresh.querySelectorAll("[data-turn-on], [data-turn-off]").length,
    0,
  );
  assertEquals(
    find(refresh, "[data-fact='schedule']").textContent,
    "When the app starts",
  );
  assertStringIncludes(
    textOf(find(refresh, "[data-last-activity]")),
    "Last activity: Done",
  );
  // 고정 입력의 hash는 자세히 보기에만 있다.
  assert(
    !textOf(weekly).replace(textOf(find(weekly, "details")), "").includes(
      "aaaa",
    ),
  );
  assertStringIncludes(
    textOf(find(weekly, "[data-input-hash]")),
    "a".repeat(64),
  );
  noInternal(view.container);
});

Deno.test("shell/wording#R10: Automation 켜기는 확인 창으로 보내고 승인된 일의 끄기는 확인 창 없이 회수한다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  await openTab(view.container, "automations");
  click(
    find(view.container, "[data-automation='weekly_report'] [data-turn-on]"),
  );
  await flush();
  assertEquals(
    fake.calls.filter((call) => call[0] === "decide").map((call) => call[1]),
    [{ kind: "turn_on_automation", app: APP, automation: "weekly_report" }],
  );
  assertStringIncludes(
    textOf(find(view.container, "[data-decision-waiting]")),
    "confirmation window",
  );
  // 승인된 일: 같은 선언의 automation.run 허락이 active이면 켜져 있고 끄기는 확인 창이 없다.
  const grant: GrantRow = {
    id: "grt_01h455vb4pex5v6nkc6gd5fd0a",
    kind: "automation.run",
    active: true,
    exact: "weekly_report",
    targetApp: null,
    commands: [],
    automation: "weekly_report",
    inputHash: "a".repeat(64),
  };
  const on = detail({
    access: { ...ACCESS, grants: [...ACCESS.grants, grant] },
  });
  on.fake.source.turnOffAutomation = (id) => {
    on.fake.calls.push(["turnOff", id]);
    on.fake.source.access = () =>
      Promise.resolve({
        ok: true,
        value: { ...ACCESS, grants: ACCESS.grants },
      });
    return Promise.resolve({ ok: true, value: true });
  };
  using onView = render(on.ui);
  await flush();
  await openTab(onView.container, "automations");
  const row = find(onView.container, "[data-automation='weekly_report']");
  assertEquals(row.getAttribute("data-on"), "on");
  click(find(row, "[data-turn-off]"));
  await flush();
  assertEquals(on.fake.calls.filter((call) => call[0] === "turnOff"), [
    ["turnOff", grant.id],
  ]);
  assertEquals(on.fake.calls.filter((call) => call[0] === "decide"), []);
  assertEquals(
    find(onView.container, "[data-automation='weekly_report']").getAttribute(
      "data-on",
    ),
    "off",
  );
});

Deno.test("shell/wording#R10: 끄지 못하면 어느 automation이 아직 켜져 있는지와 다시 시도를 적는다", async () => {
  const grant: GrantRow = {
    id: "grt_01h455vb4pex5v6nkc6gd5fd0a",
    kind: "automation.run",
    active: true,
    exact: "weekly_report",
    targetApp: null,
    commands: [],
    automation: "weekly_report",
    inputHash: "a".repeat(64),
  };
  const fake = fakeDetail({ access: { ...ACCESS, grants: [grant] } });
  const source = {
    ...fake.source,
    turnOffAutomation: () =>
      Promise.resolve({ ok: false as const, code: "unavailable" }),
  };
  using view = render(
    <AppDetail
      app={APP}
      name="Grocery budget"
      source={source}
      preview={null}
      onPreview={() => {}}
      now={now}
    />,
  );
  await flush();
  await openTab(view.container, "automations");
  click(find(view.container, "[data-turn-off]"));
  await flush();
  assertEquals(
    textOf(find(view.container, "[data-turn-off-failed]")),
    "Couldn't turn off Weekly report. It's still on. Try again.",
  );
});

Deno.test("shell/wording#R4: Connections는 부르려는 앱과 action을 사람이 지은 이름으로 보이고 선언과 허락을 구별하며 확인 창으로 보낸다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  await openTab(view.container, "connections");
  const row = find(view.container, `[data-connection='${OTHER}']`);
  assertEquals(find(row, "[data-target-name]").textContent, "Price tracker");
  assertEquals(find(row, "[data-actions]").textContent, "1 action");
  // 선언만 있고 허락은 없다.
  assertEquals(row.getAttribute("data-allowed"), "none");
  assertStringIncludes(textOf(row), "Needs your approval");
  assertStringIncludes(
    textOf(find(row, "[data-connection-caveat]")),
    "doesn't approve actions",
  );
  click(find(row, "[data-review-connection]"));
  await flush();
  assertEquals(
    fake.calls.filter((call) => call[0] === "decide").map((call) => call[1]),
    [{ kind: "connect_apps", app: APP, target: OTHER }],
  );
  noInternal(view.container);
});

Deno.test("shell/wording#R10: 허락한 연결은 Allowed로 보이고 회수는 확인 창으로 보낸다", async () => {
  const callGrant: GrantRow = {
    id: "grt_01h455vb4pex5v6nkc6gd5fd0b",
    kind: "app.call",
    active: true,
    exact: OTHER,
    targetApp: OTHER,
    commands: ["read_prices"],
    automation: null,
    inputHash: null,
  };
  const { fake, ui } = detail({
    access: { ...ACCESS, grants: [...ACCESS.grants, callGrant] },
  });
  using view = render(ui);
  await flush();
  await openTab(view.container, "connections");
  const row = find(view.container, `[data-connection='${OTHER}']`);
  assertEquals(row.getAttribute("data-allowed"), "all");
  assertStringIncludes(textOf(row), "Allowed");
  assertEquals(row.querySelectorAll("[data-review-connection]").length, 0);
  click(find(row, "[data-remove-connection]"));
  await flush();
  assertEquals(
    fake.calls.filter((call) => call[0] === "decide").map((call) => call[1]),
    [{ kind: "remove_access", app: APP, grant: callGrant.id }],
  );
});

Deno.test("shell/wording#R4: Activity는 기본에서 접혀 있고 펼치면 사람 말 기록이며 invocation이라는 말과 ID가 없다", async () => {
  const { ui } = detail({
    activity: [
      activity("inv_01h455vb4pex5v6nkc6gd5fd01", {
        status: "succeeded",
        at: "2026-10-07T11:50:00Z",
      }),
      activity("inv_01h455vb4pex5v6nkc6gd5fd02", {
        status: "unknown",
        operation: { kind: "start" },
        trigger: { kind: "restart" },
        caller: "system",
        mode: "preview",
        at: "2026-10-07T10:00:00Z",
      }),
    ],
  });
  using view = render(ui);
  await flush();
  await openTab(view.container, "activity");
  const body = find(view.container, "[data-tab-body='activity']");
  // 기본은 마지막 하나의 요약뿐이다.
  assertEquals(
    textOf(find(body, "[data-activity-summary]")),
    "Last activity: Done, 10 minutes ago",
  );
  assertEquals(body.querySelectorAll("[data-activity-list]").length, 0);
  click(find(body, "[data-activity-toggle]"));
  const list = find(body, "[data-activity-list]");
  const rows = [...list.querySelectorAll("[data-activity]")];
  assertEquals(rows.map((row) => row.getAttribute("data-activity")), [
    "succeeded",
    "unknown",
  ]);
  assertStringIncludes(textOf(rows[0]), "Used Show items");
  assertStringIncludes(textOf(rows[0]), "Directly");
  assertStringIncludes(textOf(rows[1]), "Started");
  assertStringIncludes(textOf(rows[1]), "Result unknown");
  assertStringIncludes(textOf(rows[1]), "After the app restarted");
  assertStringIncludes(textOf(rows[1]), "Preview");
  // 호출 성공은 업무가 맞다는 뜻이 아니다.
  assertStringIncludes(
    textOf(body),
    "It doesn't mean the result is right for you.",
  );
  noInternal(body);
});

Deno.test("shell/wording#R10: Data는 사람이 누를 때만 export를 청하고 준비 결과를 구별해 보인다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  await openTab(view.container, "data");
  const body = find(view.container, "[data-tab-body='data']");
  assertEquals(textOf(find(body, "[data-data-format]")), "Saved data format 2");
  // 화면을 연 것만으로는 청하지 않는다.
  assertEquals(fake.calls.filter((call) => call[0] === "exportApp").length, 0);
  click(find(body, "[data-action='export-app']"));
  await flush();
  assertEquals(fake.calls.filter((call) => call[0] === "exportApp").length, 1);
  assertEquals(
    find(body, "[data-export='ready']").textContent,
    "The copy is ready in the folder lophn made for it.",
  );
});

Deno.test("shell/wording#R10: 읽지 못한 탭은 실패한 대상과 다시 읽기를 보인다", async () => {
  const failing = detail({ failing: ["versions"] });
  using view = render(failing.ui);
  await flush();
  const state = find(view.container, "[data-state='error']");
  assertEquals(
    textOf(state).startsWith("Couldn't load this app's versions."),
    true,
  );
  assert(state.querySelector("button"));
});

Deno.test("shell/wording#R10: 읽은 뒤 다시 읽기가 실패하면 마지막으로 확인한 내용과 시각을 두고 빈 결과로 바꾸지 않는다", async () => {
  let calls = 0;
  const load = () => {
    calls += 1;
    return Promise.resolve(
      calls === 1
        ? { ok: true as const, value: "Version 3" }
        : { ok: false as const, code: "unavailable" },
    );
  };
  function Probe() {
    const read = useRead(load, [], { now });
    return (
      <>
        <Loadable read={read} target="the versions" now={now}>
          {(value) => <p data-value="">{value}</p>}
        </Loadable>
        <button type="button" data-reload="" onClick={read.reload}>
          reload
        </button>
      </>
    );
  }
  using view = render(<Probe />);
  await flush();
  assertEquals(textOf(find(view.container, "[data-value]")), "Version 3");
  assertEquals(view.container.querySelectorAll("[data-stale]").length, 0);
  click(find(view.container, "[data-reload]"));
  await flush();
  assertEquals(textOf(find(view.container, "[data-value]")), "Version 3");
  assertStringIncludes(
    textOf(find(view.container, "[data-stale]")),
    "Last updated",
  );
});

Deno.test("shell/wording#R4: [Instructions]는 app 층 단추 하나로 열고 Issues·Tasks는 자리만 있다", async () => {
  let opened = 0;
  const { ui } = detail({}, { onInstructions: () => opened++ });
  using view = render(ui);
  await flush();
  click(find(view.container, "[data-open-instructions]"));
  assertEquals(opened, 1);
  await openTab(view.container, "issues");
  assertEquals(
    textOf(find(view.container, "[data-slot-empty='issues']")),
    "Issues aren't available here yet.",
  );
  await openTab(view.container, "tasks");
  assertEquals(
    textOf(find(view.container, "[data-slot-empty='tasks']")),
    "Tasks aren't available here yet.",
  );
  // 자리에 내용이 오면 그 내용이 보인다.
  const filled = detail({}, { issues: <p data-issues-body="">Open issues</p> });
  using filledView = render(filled.ui);
  await flush();
  await openTab(filledView.container, "issues");
  assertEquals(
    textOf(find(filledView.container, "[data-issues-body]")),
    "Open issues",
  );
});
