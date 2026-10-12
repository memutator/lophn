import { assert, assertEquals } from "@std/assert";
import { click, render } from "../../../../design/components/testing.ts";

import {
  find,
  flush,
  pressTab,
} from "../../desktop/lophn-space/testdata/dom.ts";
import { AppDetail } from "./app-detail.tsx";
import { coreAppDetailSource } from "./core-source.ts";
import { type DecisionEnded, decisionEnds } from "./decision-end.ts";
import { coreIssuesSource } from "./issues/core-source.ts";
import { IssuesTab } from "./issues/issues-tab.tsx";
import {
  APP as ISSUE_APP,
  fakeIssues,
  now as issueNow,
  PRB_OPEN,
} from "./issues/testdata/fake-source.ts";
import type { GrantRow } from "./source.ts";
import {
  ACCESS,
  APP,
  fakeDetail,
  now,
  OTHER,
  REL_4,
} from "./testdata/fake-source.ts";

function detail() {
  const fake = fakeDetail();
  const ui = (
    <AppDetail
      app={APP}
      name="Grocery budget"
      source={fake.source}
      preview={null}
      onPreview={() => {}}
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

const waiting = (root: Element) =>
  root.querySelector("[data-decision-waiting]");

Deno.test("shell/confirmation-window#R4: Version 확인 창이 거절·닫힘으로 끝나면 단추가 다시 활성이다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  const row = () => find(view.container, `[data-version='${REL_4}']`);
  click(find(row(), "[data-use-version]"));
  await flush();
  assert(waiting(row()));
  assert((find(row(), "[data-use-version]") as HTMLButtonElement).disabled);
  fake.endDecisions();
  await flush();
  assertEquals(waiting(row()), null);
  assert(!(find(row(), "[data-use-version]") as HTMLButtonElement).disabled);
});

Deno.test("shell/confirmation-window#R4: Access 회수 확인 창이 끝나면 요청 접수 표시가 없어지고 다시 누를 수 있다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  await openTab(view.container, "access");
  const grant = ACCESS.grants[0];
  const row = () => find(view.container, `[data-grant='${grant.id}']`);
  click(find(row(), "[data-remove-access]"));
  await flush();
  assertEquals(row().getAttribute("data-revoke"), "requested");
  assert((find(row(), "[data-remove-access]") as HTMLButtonElement).disabled);
  fake.endDecisions();
  await flush();
  assert(row().getAttribute("data-revoke") !== "requested");
  assert(!(find(row(), "[data-remove-access]") as HTMLButtonElement).disabled);
});

Deno.test("shell/confirmation-window#R4: Automation 켜기 확인 창이 끝나면 기다림이 풀린다", async () => {
  const { fake, ui } = detail();
  using view = render(ui);
  await flush();
  await openTab(view.container, "automations");
  const card = () => find(view.container, "[data-automation='weekly_report']");
  click(find(card(), "[data-turn-on]"));
  await flush();
  assert(waiting(view.container));
  assert((find(card(), "[data-turn-on]") as HTMLButtonElement).disabled);
  fake.endDecisions();
  await flush();
  assertEquals(waiting(view.container), null);
  assert(!(find(card(), "[data-turn-on]") as HTMLButtonElement).disabled);
});

Deno.test("shell/confirmation-window#R4: Connections 확인 창이 끝나면 두 단추가 다시 활성이다", async () => {
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
  const fake = fakeDetail({
    access: { ...ACCESS, grants: [...ACCESS.grants, callGrant] },
  });
  using view = render(
    <AppDetail
      app={APP}
      name="Grocery budget"
      source={fake.source}
      preview={null}
      onPreview={() => {}}
      now={now}
    />,
  );
  await flush();
  await openTab(view.container, "connections");
  const row = () => find(view.container, `[data-connection='${OTHER}']`);
  click(find(row(), "[data-remove-connection]"));
  await flush();
  assert(waiting(row()));
  assert(
    (find(row(), "[data-remove-connection]") as HTMLButtonElement).disabled,
  );
  fake.endDecisions();
  await flush();
  assertEquals(waiting(row()), null);
  assert(
    !(find(row(), "[data-remove-connection]") as HTMLButtonElement).disabled,
  );
});

Deno.test("shell/confirmation-window#R4: Issues 확인 창이 끝나면 결정을 기다린다는 글이 없어진다", async () => {
  const fake = fakeIssues();
  using view = render(
    <IssuesTab
      app={ISSUE_APP}
      source={fake.source}
      now={issueNow}
      initialProblem={PRB_OPEN}
    />,
  );
  await flush();
  click(find(view.container, "[data-issue-choice='not_fixed']"));
  await flush();
  assert(view.container.querySelector("[data-issue-waiting]"));
  fake.endDecisions();
  await flush();
  assertEquals(view.container.querySelector("[data-issue-waiting]"), null);
});

Deno.test("shell/confirmation-window#R4: 결정 창이 열린 뒤 main이 알린 끝남만 그 창의 대기를 푼다", () => {
  const listeners: ((ended: DecisionEnded) => void)[] = [];
  const ends = decisionEnds((listener) => {
    listeners.push(listener);
    return () => {};
  });
  const done: string[] = [];
  ends.watch("cfw_1", () => done.push("one"));
  ends.watch("cfw_2", () => done.push("two"));
  ends.watch("cfw_3", undefined);
  // 구독은 한 번이고, 다른 창의 알림이나 모르는 창은 아무것도 풀지 않는다.
  assertEquals(listeners.length, 1);
  listeners[0]!({ windowId: "cfw_9", ended: "closed" });
  assertEquals(done, []);
  listeners[0]!({ windowId: "cfw_2", ended: "cancelled" });
  listeners[0]!({ windowId: "cfw_2", ended: "cancelled" });
  assertEquals(done, ["two"]);
  // 알릴 곳이 없는 창에서는 구독하지 않는다.
  decisionEnds(undefined).watch("cfw_1", () => done.push("none"));
  assertEquals(done, ["two"]);
});

Deno.test("shell/confirmation-window#R4: core source는 열린 창의 windowId로 끝남을 기다리고 열지 못했으면 기다리지 않는다", async () => {
  const listeners: ((ended: DecisionEnded) => void)[] = [];
  const subscribe = (listener: (ended: DecisionEnded) => void) => {
    listeners.push(listener);
    return () => {};
  };
  const core = { subscribe: () => () => {}, call: () => Promise.reject() };
  const source = coreAppDetailSource(
    core,
    () => Promise.resolve({ windowId: "cfw_1" }),
    subscribe,
  );
  let ended = 0;
  const reply = await source.decide(
    { kind: "use_version", app: APP, release: REL_4 },
    () => ended++,
  );
  assertEquals(reply, { ok: true, value: true });
  listeners[0]!({ windowId: "cfw_1", ended: "closed" });
  assertEquals(ended, 1);

  const failed = coreAppDetailSource(
    core,
    () => Promise.resolve({ code: "forbidden" }),
    subscribe,
  );
  const denied = await failed.decide(
    { kind: "use_version", app: APP, release: REL_4 },
    () => ended++,
  );
  assertEquals(denied, { ok: false, code: "forbidden" });
  assertEquals(listeners.length, 1);

  const issues = coreIssuesSource(
    core,
    () => Promise.resolve({ windowId: "cfw_7" }),
    subscribe,
  );
  await issues.decide(
    { problem: PRB_OPEN, choice: "fixed", note: null },
    () => ended++,
  );
  // 이슈 source는 자기 구독을 따로 시작한다.
  assertEquals(listeners.length, 2);
  listeners[1]!({ windowId: "cfw_7", ended: "expired" });
  assertEquals(ended, 2);
});
