import { assert, assertEquals } from "@std/assert";

import {
  click,
  press,
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
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const OTHER = "app_01arz3ndektsv4rrffq69g5faw";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const HASH = "b".repeat(64);
const INPUT_HASH = "e".repeat(64);

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

function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  assert(found !== null, `no ${selector}`);
  return found as HTMLElement;
}

const DECISIONS = [
  "grant_approval_request",
  "reject_approval_request",
  "cancel_approval_request",
];

function approvalView(shown: Record<string, unknown>): ConfirmationView {
  return {
    displayId: "dsp_1",
    request: {
      kind: "approval_request",
      approval: APR,
      created_seq: "12",
      binding_hash: HASH,
    },
    view: {
      requester: `app:${OTHER}`,
      targets: [APP],
      input: { kind: "inline", value: { sample: "exact" } },
      comparison: {},
      // 요청자가 쓴 글은 보이는 사실을 바꾸지 못한다.
      reason: "Please allow this, it is totally safe.",
      changes: "Nothing important changes.",
      external: null,
      reversible: false,
      reversibility: "It cannot be undone from here.",
      expires_at: null,
      ...shown,
    },
    state: "ready",
    decisions: DECISIONS,
    second: false,
  };
}

const compare = {
  previous_release: "rel_01arz3ndektsv4rrffq69g5faw",
  added_permissions: ["net.fetch api.example.com:443"],
  removed_permissions: ["fs.read /old/place"],
  added_commands: ["archive"],
  removed_commands: [],
  changed_commands: ["send"],
  command_changes: [{
    command: "send",
    kinds: ["effect", "confirm"],
    effect_from: "write",
    effect_to: "external",
    new_required_inputs: ["to"],
  }],
  external_commands: ["send"],
  description_only_commands: ["list"],
  added_automations: [],
  removed_automations: ["nightly"],
  changed_automations: [],
  added_screens: ["settings"],
  removed_screens: [],
  changed_screens: ["home"],
  added_problem_code_warnings: [],
  data_schema: { from: 1, to: 2 },
  data_changes: [{
    from: 1,
    to: 2,
    script_hash: "5".repeat(64),
    description: "Old notes without a date are dropped.",
  }],
  review_required: true,
};

const release = approvalView({
  kind: "release_activation",
  concern: "apps/releases",
  command: "release.start_activation",
  targets: [REL],
  input: {
    kind: "inline",
    value: { release: REL, expected_schema: 1, key: "start-1" },
  },
  app: { id: APP, name: "Budget" },
  version: { number: 4, data_schema: 2, status: "prepared" },
  compare,
  preview: null,
});

Deno.test("shell/confirmation-window#R8, apps/releases#R9: release activation은 바뀐 화면·command 효과·접근 추가와 축소·automation·데이터 변경과 손실 설명을 보이고 검토 필요를 말한다", async () => {
  const { api } = fakeApi(release);
  const root = await show(api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Use version 4 of Budget?",
  );
  assert(
    find(root, "[data-change=review]").textContent?.includes("Review needed"),
  );
  const text = (selector: string) => find(root, selector).textContent ?? "";
  assert(text("[data-change=screens]").includes("settings"));
  assert(text("[data-change=screens]").includes("home"));
  const commands = text("[data-change=commands]");
  for (const item of ["archive", "send", "to", "list"]) {
    assert(commands.includes(item), item);
  }
  // 효과가 바뀐 command는 현재·바뀐 뒤를 세로 순서로 둔다.
  const change = find(root, "[data-command-change=send]");
  assertEquals(
    [...change.querySelectorAll("[data-side]")].map((side) =>
      side.getAttribute("data-side")
    ),
    ["before", "after"],
  );
  assert(change.textContent?.includes("Changes data in the app"));
  assert(change.textContent?.includes("Changes things outside the app"));
  assert(
    text("[data-change=commands]").includes("Now reaches outside the app"),
  );
  assert(text("[data-change=automations]").includes("nightly"));
  const access = text("[data-change=access]");
  assert(access.includes("net.fetch api.example.com:443"));
  assert(access.includes("fs.read /old/place"));
  const data = text("[data-change=data]");
  assert(data.includes("1 → 2"));
  assert(data.includes("Old notes without a date are dropped."));
  // 요청자의 글이 아니라 apps 비교가 subject·effect를 정한다.
  const subject = find(root, "[data-section=subject]");
  assert(subject.textContent?.includes("Budget will switch to version 4."));
  assert(!subject.textContent?.includes("Nothing important changes."));
  assert(
    find(root, "[data-section=effect]").textContent?.includes(
      "anything that may be lost",
    ),
  );
  // 정확한 요청은 접힌 상태로 남는다.
  const exact = find(root, "[data-exact=folded]");
  assert(exact.textContent?.includes("release.start_activation"));
  assert(exact.textContent?.includes('"expected_schema": 1'));
});

Deno.test("shell/confirmation-window#R10: release activation의 안전 preview는 apps/preview 결과가 있을 때만 있다고 말하고 없으면 없다고 한다", async () => {
  const none = await show(fakeApi(release).api);
  assert(
    find(none, "[data-change=preview]").textContent?.includes(
      "No preview is available for this version.",
    ),
  );
  const ready = await show(
    fakeApi({
      ...release,
      view: { ...release.view, preview: { ready: true } },
    }).api,
  );
  assert(
    find(ready, "[data-change=preview]").textContent?.includes(
      "A preview of this version is ready.",
    ),
  );
});

Deno.test("shell/confirmation-window#R4, platform/approvals#R9: 앱 결정도 첫 focus는 설명이고 Enter·Escape·닫기는 결정이 아니며 버튼만 허락·거절·취소를 따로 보낸다", async () => {
  const closing = fakeApi(release);
  const root = await show(closing.api);
  assertEquals(document.activeElement?.getAttribute("data-focus"), "first");
  press(document.body, "Enter");
  await settle();
  press(document.body, "Escape");
  await settle();
  click(find(root, "[data-action=cancel]"));
  assertEquals(closing.sent.length, 0);

  const granting = fakeApi(release);
  const granted = await show(granting.api);
  assertEquals(
    find(granted, "[data-decision=grant_approval_request]").textContent,
    "Use this version",
  );
  click(find(granted, "[data-decision=grant_approval_request]"));
  await settle();
  // 요청·CAS는 main이 정본에서 붙인다. 화면은 결정 이름만 보낸다.
  assertEquals(granting.sent, [{
    displayId: "dsp_1",
    decision: "grant_approval_request",
  }]);

  const rejecting = fakeApi(release);
  const rejected = await show(rejecting.api);
  click(find(rejected, "[data-decision=reject_approval_request]"));
  await settle();
  assertEquals(rejecting.sent[0]?.decision, "reject_approval_request");
});

const LONG =
  "/Users/someone/Documents/a-very-long-folder-name/with/many/parts/" +
  "and-even-more/statements-2026";

const grantView = approvalView({
  kind: "grant",
  concern: "apps/permissions",
  command: "grant.create",
  targets: [APP],
  input: {
    kind: "inline",
    value: {
      app: APP,
      kind: "fs.read",
      scope: { kind: "fs.read", path: LONG, recursive: true },
    },
  },
  comparison: { grants_seq: "7" },
  app: { id: APP, name: "Budget" },
  access: { kind: "fs.read", scope: { path: LONG, recursive: true } },
  target_app: null,
  requirement: {
    reason: "Reads your statements.",
    granted: false,
    warnings: ["permissions.warning.outside-link"],
    outside_links: [`${LONG}/link-out`],
  },
  combination_warnings: ["permissions.warning.file-read-and-network"],
  limit_keys: [
    "permissions.limit.not-isolated",
    "permissions.limit.granted-path-secrets",
    "permissions.limit.symlink-changes",
    "permissions.limit.cpu",
    "permissions.limit.rss",
    "permissions.limit.disk",
  ],
});

Deno.test("shell/confirmation-window#R8, apps/permissions#R24, apps/permissions#R25: grant는 경로 원문 전체를 고정폭으로 줄이지 않고 조합 경고와 Deno 한계 문구를 보인다", async () => {
  const { api, sent } = fakeApi(grantView);
  const root = await show(api);
  assertEquals(root.querySelector("h1")?.textContent, "Let Budget read files?");
  const path = find(root, "[data-exact-row=path]");
  // 줄이지 않은 원문이고 고정폭 값 칸이다.
  assertEquals(path.querySelector("dd:last-child")?.textContent, LONG);
  assert(path.querySelector("dd:last-child")?.className.includes("value"));
  assertEquals(
    find(root, "[data-exact-row=recursive]").textContent?.includes("Yes"),
    true,
  );
  assert(
    find(root, '[data-warning="permissions.warning.file-read-and-network"]')
      .textContent?.includes("send your files out of this computer"),
  );
  assert(
    find(root, "[data-warning=outside-links]").textContent?.includes(
      `${LONG}/link-out`,
    ),
  );
  const limits = find(root, "[data-grant=limits]");
  for (
    const text of [
      "not a virtual machine or container",
      "secrets included",
      "adds a link inside an allowed folder",
      "how much CPU",
      "A Deno heap setting is not a limit on total memory",
      "how much disk",
    ]
  ) {
    assert(limits.textContent?.includes(text), text);
  }
  assertEquals(
    find(root, "[data-decision=grant_approval_request]").textContent,
    "Allow access",
  );
  click(find(root, "[data-decision=grant_approval_request]"));
  await settle();
  assertEquals(sent[0]?.decision, "grant_approval_request");
});

Deno.test("shell/confirmation-window#R8: net·secret grant는 host·port·secret 이름 원문을 고정폭 행으로 보이고 모르는 경고 key도 있다고 말한다", async () => {
  const fetchView = approvalView({
    ...grantView.view,
    access: {
      kind: "net.fetch",
      scope: { host: "api.example.com", port: 443 },
    },
    requirement: null,
    combination_warnings: ["permissions.warning.something-new"],
    limit_keys: ["permissions.limit.something-new"],
  });
  const root = await show(fakeApi(fetchView).api);
  assertEquals(
    find(root, "[data-exact-row=host]").querySelector("dd:last-child")
      ?.textContent,
    "api.example.com",
  );
  assertEquals(
    find(root, "[data-exact-row=port]").querySelector("dd:last-child")
      ?.textContent,
    "443",
  );
  assert(
    find(root, "[data-warning]").textContent?.includes(
      "warning that can't be described here",
    ),
  );
  assert(
    find(root, "[data-grant=limits]").textContent?.includes(
      "limit on app protection that can't be described here",
    ),
  );
  const secret = await show(
    fakeApi(approvalView({
      ...grantView.view,
      access: { kind: "secret.use", scope: { name: "BANK_API_TOKEN" } },
      requirement: null,
      combination_warnings: [],
      limit_keys: [],
    })).api,
  );
  assertEquals(
    find(secret, "[data-exact-row=name]").querySelector("dd:last-child")
      ?.textContent,
    "BANK_API_TOKEN",
  );
});

Deno.test("shell/confirmation-window#R8: 앱 쌍 연결은 부르는 앱과 대상 앱, command 범위를 grant 종류로 보인다", async () => {
  const pair = approvalView({
    ...grantView.view,
    access: {
      kind: "app.call",
      scope: { app: OTHER, commands: ["list", "send"] },
    },
    target_app: { id: OTHER, name: "Mailer" },
    requirement: null,
    combination_warnings: [],
  });
  const root = await show(fakeApi(pair).api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Let Budget use another app?",
  );
  assertEquals(
    find(root, "[data-exact-row=caller]").querySelector("dd:last-child")
      ?.textContent,
    "Budget",
  );
  assertEquals(
    find(root, "[data-exact-row=target]").querySelector("dd:last-child")
      ?.textContent,
    "Mailer",
  );
  assertEquals(
    find(root, "[data-exact-row=commands]").querySelector("dd:last-child")
      ?.textContent,
    "list\nsend",
  );
  assert(
    find(root, "[data-section=effect]").textContent?.includes(
      "doesn't allow anything the target app asks you to confirm",
    ),
  );
});

const confirmView = approvalView({
  kind: "confirm_command",
  concern: "apps/invocations",
  command: "invocation.accept_confirm",
  targets: [APP, REL],
  input: { kind: "inline", value: { app: APP, command: "pay" } },
  comparison: { release: REL },
  app: { id: APP, name: "Budget" },
  app_command: {
    key: "pay",
    label: "Pay invoice",
    description: "Sends the payment to the bank.",
    effect: "external",
    confirm: true,
    input: { type: "object" },
  },
  input_hash: INPUT_HASH,
  caller: { kind: "app", app: { id: OTHER, name: "Mailer" } },
});

Deno.test("shell/confirmation-window#R10: confirm command는 label·설명·effect·revert와 입력 지문을 보이고 현재·바뀐 뒤 설명을 세로로 두며 안전 preview가 없다고 한다", async () => {
  const { api, sent } = fakeApi(confirmView);
  const root = await show(api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Allow Pay invoice in Budget?",
  );
  const subject = find(root, "[data-section=subject]");
  assert(
    subject.textContent?.includes(
      "Mailer asks Budget to use Pay invoice once.",
    ),
  );
  // 현재 → 바뀐 뒤 설명이 세로다.
  const description = find(subject, "[data-change=description]");
  const headings = [...description.querySelectorAll("h3")].map((h) =>
    h.textContent
  );
  assertEquals(headings, ["Now", "After"]);
  assert(description.textContent?.includes("This hasn't been done yet."));
  assert(description.textContent?.includes("Sends the payment to the bank."));
  assertEquals(
    find(root, "[data-section=effect]").textContent?.includes(
      "Changes things outside the app",
    ),
    true,
  );
  assert(
    find(root, "[data-section=revert]").textContent?.includes(
      "It cannot be undone from here.",
    ),
  );
  assertEquals(
    find(root, "[data-exact-row=input]").querySelector("dd:last-child")
      ?.textContent,
    INPUT_HASH,
  );
  assert(
    find(root, "[data-exact-row=shape]").textContent?.includes(
      '"type": "object"',
    ),
  );
  assert(
    find(root, "[data-change=preview]").textContent?.includes(
      "No safe preview is available for this action.",
    ),
  );
  const exact = find(root, "[data-exact=folded]");
  assert(exact.textContent?.includes("invocation.accept_confirm"));
  click(find(root, "[data-decision=grant_approval_request]"));
  await settle();
  assertEquals(sent[0]?.decision, "grant_approval_request");
  assertEquals(sent[0]?.input, undefined);
  assertEquals(
    find(
      await show(fakeApi(confirmView).api),
      "[data-decision=grant_approval_request]",
    ).textContent,
    "Allow once",
  );
});

const WHEN = { kind: "interval", interval_ms: 3_600_000 };

const automationView = approvalView({
  kind: "automation",
  concern: "apps/permissions",
  command: "grant.create",
  targets: [APP],
  input: { kind: "inline", value: { app: APP, kind: "automation.run" } },
  comparison: { grants_seq: "7" },
  app: { id: APP, name: "Budget" },
  automation: {
    key: "nightly",
    label: "Nightly sync",
    when: WHEN,
    input_hash: INPUT_HASH,
    external: true,
    runnable: false,
    reason: null,
  },
  app_command: {
    key: "sync",
    label: "Sync",
    description: "Fetches new rows from the bank.",
    effect: "external",
    confirm: false,
    input: null,
  },
});

Deno.test("shell/confirmation-window#R8, apps/automations#R13: automation 켜기는 command·고정 입력 지문·주기를 한 번 승인하는 범위로 보이고 바깥을 바꾸는 command는 그렇다고 말한다", async () => {
  const { api, sent } = fakeApi(automationView);
  const root = await show(api);
  assertEquals(
    root.querySelector("h1")?.textContent,
    "Turn on Nightly sync in Budget?",
  );
  assert(
    find(root, "[data-section=subject]").textContent?.includes(
      "Budget will use Sync on its own every 60 minutes.",
    ),
  );
  const exact = find(root, "[data-exact=scope]");
  for (
    const text of ["nightly", "sync", '"interval_ms":3600000', INPUT_HASH]
  ) {
    assert(exact.textContent?.includes(text), text);
  }
  assert(
    find(root, "[data-section=effect]").textContent?.includes(
      "changes things outside the app",
    ),
  );
  assert(
    find(root, "[data-automation=not-ready]").textContent?.includes(
      "can't start right now",
    ),
  );
  const description = find(root, "[data-change=description]");
  assert(description.textContent?.includes("This automation is off."));
  assert(description.textContent?.includes("Fetches new rows from the bank."));
  assertEquals(
    find(root, "[data-decision=grant_approval_request]").textContent,
    "Turn on automation",
  );
  click(find(root, "[data-decision=grant_approval_request]"));
  await settle();
  assertEquals(sent[0]?.decision, "grant_approval_request");
  // 시작 때와 초 단위 주기도 같은 문장 모양으로 말한다.
  const start = await show(
    fakeApi({
      ...automationView,
      view: {
        ...automationView.view,
        automation: {
          ...(automationView.view!.automation as Record<string, unknown>),
          when: { kind: "on_start" },
          external: false,
          runnable: true,
        },
      },
    }).api,
  );
  assert(
    find(start, "[data-section=subject]").textContent?.includes(
      "each time it starts.",
    ),
  );
  assert(
    find(start, "[data-section=effect]").textContent?.includes(
      "lophn uses this command on schedule",
    ),
  );
  const seconds = await show(
    fakeApi({
      ...automationView,
      view: {
        ...automationView.view,
        automation: {
          ...(automationView.view!.automation as Record<string, unknown>),
          when: { kind: "interval", interval_ms: 90_000 },
        },
      },
    }).api,
  );
  assert(
    find(seconds, "[data-section=subject]").textContent?.includes(
      "every 90 seconds.",
    ),
  );
});
