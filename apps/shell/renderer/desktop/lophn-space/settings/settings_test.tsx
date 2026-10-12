// settings 화면(shell#T31). 연결·계정·확장·일반 설정과 전역 [Instructions] 진입, 설정의 뜻 묻기.
// 값은 가짜 통로가 기록한다. secret 값은 이 통로에 없고 보호 창이 받는다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../../../packages/design/components/testing.ts";

import { SettingsScreen } from "./settings-screen.tsx";
import { Desktop } from "../../main.tsx";
import { openLophn } from "../../router.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type { EditorDeps } from "../../../editor/document-view.tsx";
import type { InstructionsSource } from "../../../editor/instructions-entry.tsx";
import { fakeSource } from "../testdata/fake-source.ts";
import { byText, find, flush, typeInto } from "../testdata/dom.ts";
import { fakeBackup } from "./backup/testdata/fake-source.ts";
import { fakeDiagnostics } from "./diagnostics/testdata/fake-source.ts";
import { fakeNotifications } from "./notifications/testdata/fake-source.ts";
import { fakeUpdate } from "./update/testdata/fake-source.ts";
import {
  account,
  CHATGPT,
  CLAUDE,
  fakeSettings,
  LOCAL,
  provider,
  server,
  setting,
} from "./testdata/fake-settings.ts";
import type { AccountRow, ProviderRow } from "./source.ts";

const AT = "2026-10-06T15:40:00.000Z";

function claude(accounts: readonly AccountRow[]): ProviderRow {
  return provider(CLAUDE, "Claude", { ways: ["api_key"], accounts });
}

// 왼쪽 nav 단추를 누른다.
const pressTab = click;

function textOf(root: Element): string {
  return root.textContent ?? "";
}

Deno.test("shell/wording#R10: 연결 카드는 contract가 알려 준 인증 방식만 보이고 API 과금·구독 한도·이 컴퓨터를 구별하며 key는 입력칸이 아니라 보호 창으로만 받는다", async () => {
  const { source, calls } = fakeSettings({
    providers: [
      claude([]),
      provider(CHATGPT, "ChatGPT", {
        ways: ["oauth"],
        signIn: { verified: true },
      }),
      provider(LOCAL, "Local model", { ways: ["none"], local: true }),
    ],
  });
  using view = render(<SettingsScreen source={source} />);
  await flush();
  const cards = [...view.container.querySelectorAll("[data-provider-ways]")];
  assertEquals(cards.length, 3);
  const rows = cards.map((card) =>
    [...card.querySelectorAll("[data-way]")].map((row) =>
      row.getAttribute("data-way")
    )
  );
  // 이름 순서(ChatGPT, Claude, Local model)로, 각 연결의 방식만 있다.
  assertEquals(rows, [["oauth"], ["api_key"], ["none"]]);
  const text = textOf(view.container);
  assert(text.includes("Billed by use on your API account"));
  assert(text.includes("Uses your subscription limits"));
  assert(text.includes("Runs on this computer"));
  // 금액을 모르면 지어내지 않는다. 계정이 없으면 비용 줄도 없다.
  assert(!/\$\d/.test(text));
  assert(text.includes("Not tested yet."));
  // key는 입력칸이 아니라 보호 창으로 받는다: 이름만 정하고 [Continue]로 창을 연다.
  assertEquals(view.container.querySelector("input[type='password']"), null);
  const claudeCard = cards[1]!.parentElement!;
  click(find(claudeCard, "[data-action='add-key']"));
  const nameInput = find(claudeCard, "[data-add-key] input");
  assert(nameInput.getAttribute("type") !== "password");
  assertEquals(
    find(claudeCard, "[data-action='continue-key']").hasAttribute("disabled"),
    true,
  );
  typeInto(nameInput, "Work account");
  click(find(claudeCard, "[data-action='continue-key']"));
  await flush();
  assertEquals(calls.find((call) => call[0] === "connect-key"), [
    "connect-key",
    CLAUDE,
    "Work account",
  ]);
  assertEquals(
    find(view.container, "[data-notice='window-opened']").textContent,
    "Finish in the window that opened. This list updates when you come back.",
  );
});

Deno.test("shell/wording#R10: 보호 창을 열지 못하면 아무것도 바뀌지 않았다고 말하고 다시 시도하게 한다", async () => {
  const { source } = fakeSettings({
    providers: [claude([])],
    windowCode: "unavailable",
  });
  using view = render(<SettingsScreen source={source} />);
  await flush();
  click(find(view.container, "[data-action='add-key']"));
  typeInto(find(view.container, "[data-add-key] input"), "Work");
  click(find(view.container, "[data-action='continue-key']"));
  await flush();
  assertEquals(
    find(view.container, "[data-notice='window-failed']").textContent,
    "The window didn't open. Nothing changed. Try again.",
  );
});

Deno.test("shell/app-frame#R7: 공식 로그인 단추는 확인 창 없이 OS browser로 열고 코드와 다음 행동만 보이며 취소하면 로그인을 닫는다", async () => {
  const chatgpt = provider(CHATGPT, "ChatGPT", {
    ways: ["oauth"],
    signIn: { verified: true },
  });
  const { source, calls } = fakeSettings({
    providers: [chatgpt],
    signIn: {
      login: "login-1",
      url: "https://auth.example.com/device?state=SECRET#frag",
      code: "ABCD-1234",
      paste: true,
    },
  });
  using view = render(<SettingsScreen source={source} />);
  await flush();
  click(find(view.container, "[data-action='sign-in']"));
  await flush();
  // 열기 요청은 URL 하나다. 확인 창을 거치지 않고 보호 창도 열지 않는다.
  assertEquals(calls.filter((call) => call[0] === "open-link"), [[
    "open-link",
    "https://auth.example.com/device?state=SECRET#frag",
  ]]);
  assertEquals(calls.some((call) => call[0] === "connect-key"), false);
  const waiting = find(view.container, "[data-sign-in='waiting']");
  assertEquals(
    find(waiting, "p").textContent,
    "Complete the sign-in in your browser.",
  );
  assertEquals(
    find(waiting, "[data-sign-in-code]").textContent,
    "Enter this code on the page: ABCD-1234.",
  );
  // 화면 어디에도 주소의 query·fragment가 없다.
  assert(!textOf(view.container).includes("SECRET"));
  // 최종 주소를 붙여 넣는 방식이면 그 값은 보호 창이 받는다.
  click(find(view.container, "[data-action='enter-response']"));
  await flush();
  assertEquals(calls.find((call) => call[0] === "sign-in-response"), [
    "sign-in-response",
    CHATGPT,
    "ChatGPT",
  ]);
  click(find(view.container, "[data-action='cancel-sign-in']"));
  await flush();
  assertEquals(calls.find((call) => call[0] === "cancel-sign-in"), [
    "cancel-sign-in",
    CHATGPT,
    "login-1",
  ]);
  assertEquals(view.container.querySelector("[data-sign-in='waiting']"), null);
});

Deno.test("shell/app-frame#R7: 브라우저가 열리지 않으면 다시 열게 하고, 로그인 통로가 아직 없으면 없다고 말하며, lophn이 확인하지 못한 로그인은 누르지 못한다", async () => {
  const chatgpt = provider(CHATGPT, "ChatGPT", {
    ways: ["oauth"],
    signIn: { verified: true },
  });
  const closed = fakeSettings({
    providers: [chatgpt],
    signIn: {
      login: "login-1",
      url: "https://auth.example.com/device",
      code: null,
      paste: false,
    },
    linkOpens: false,
  });
  using first = render(<SettingsScreen source={closed.source} />);
  await flush();
  click(find(first.container, "[data-action='sign-in']"));
  await flush();
  assertEquals(
    find(first.container, "[data-sign-in='waiting'] p").textContent,
    "The sign-in page didn't open. Open it again to continue.",
  );
  click(find(first.container, "[data-action='open-again']"));
  await flush();
  assertEquals(
    closed.calls.filter((call) => call[0] === "open-link").length,
    2,
  );

  const absent = fakeSettings({ providers: [chatgpt] });
  using second = render(<SettingsScreen source={absent.source} />);
  await flush();
  click(find(second.container, "[data-action='sign-in']"));
  await flush();
  assertEquals(
    find(second.container, "[data-sign-in='absent']").textContent,
    "Signing in with ChatGPT isn't available in this version yet.",
  );

  const unverified = fakeSettings({
    providers: [provider(CHATGPT, "ChatGPT", {
      ways: ["oauth"],
      signIn: { verified: false },
    })],
  });
  using third = render(<SettingsScreen source={unverified.source} />);
  await flush();
  assertEquals(
    find(third.container, "[data-action='sign-in']").hasAttribute("disabled"),
    true,
  );
  assertEquals(
    find(third.container, "[data-sign-in='unverified']").textContent,
    "Signing in with this account isn't confirmed to work with lophn yet.",
  );
});

Deno.test("shell/wording#R10: 계정은 사람이 정한 순서와 상태, 확인된 계정 정보만 보이고 사용량 한도는 리셋 시각을, 인증 문제는 교체·로그인을 다음 행동 하나로 말한다", async () => {
  const { source } = fakeSettings({
    providers: [
      claude([
        account("b", "Backup key", {
          order: 1,
          state: "usage_wait",
          reason: "quota",
          until: AT,
        }),
        account("a", "Work key", {
          order: 0,
          account: "me@example.com",
          plan: "Max",
        }),
        account("c", "Old key", {
          order: 2,
          state: "rejected",
          reason: "authentication",
        }),
        account("d", "Plan key", {
          order: 3,
          state: "rejected",
          reason: "plan_access",
        }),
        account("e", "Gone key", {
          order: 4,
          state: "revoked",
          reason: "authentication",
        }),
        account("f", "Login", {
          order: 5,
          way: "oauth",
          state: "rejected",
          reason: "refresh_revoked",
        }),
      ]),
    ],
  });
  using view = render(<SettingsScreen source={source} />);
  await flush();
  const rows = [...view.container.querySelectorAll("[data-account-row]")];
  assertEquals(
    rows.map((row) => row.getAttribute("data-order")),
    ["0", "1", "2", "3", "4", "5"],
  );
  assertEquals(rows.map((row) => row.getAttribute("data-status")), [
    "ready",
    "limit",
    "sign-in-problem",
    "plan",
    "removed",
    "signed-out",
  ]);
  const first = textOf(rows[0]!);
  assert(first.includes("me@example.com · Max"));
  // 확인하지 않은 계정·조직은 말하지 않는다.
  assert(!textOf(rows[2]!).includes("@"));
  // 사용량 한도: 한도와 인증 문제를 섞지 않고 리셋 시각을 보인다.
  const limit = textOf(rows[1]!);
  assert(limit.includes("Usage limit reached"));
  assert(
    /Wait for the limit to reset\. It is expected around Oct \d+, .*\./.test(
      limit,
    ),
    limit,
  );
  assert(!limit.includes("Sign-in problem"));
  // 다음 행동은 하나다. 인증 문제는 key 교체, 로그인은 다시 로그인이다.
  assertEquals(
    rows.map((row) =>
      row.querySelector("[data-next]")?.getAttribute("data-next") ?? null
    ),
    [null, "wait", "replace-key", "check-plan", "add-account", "sign-in"],
  );
  assert(
    textOf(rows[2]!).includes("Replace the key to use this account again."),
  );
  assert(textOf(rows[5]!).includes("Sign in again to use this account."));
  assert(rows[5]!.querySelector("[data-action='sign-in-again']"));
  // 삭제한 계정은 더 지우지 못한다.
  assertEquals(rows[4]!.querySelector("[data-action='remove']"), null);
});

Deno.test("shell/wording#R10: 계정 교체·삭제는 그 계정을 대상으로 보호 창을 열고 열린 창만 알리며 로그인 다시 하기는 같은 로그인 흐름이다", async () => {
  const { source, calls } = fakeSettings({
    providers: [
      claude([
        account("a", "Work key", { order: 0 }),
        account("c", "Old key", {
          order: 1,
          state: "rejected",
          reason: "authentication",
        }),
      ]),
      provider(CHATGPT, "ChatGPT", {
        ways: ["oauth"],
        signIn: { verified: true },
        accounts: [
          account("l", "Login", {
            way: "oauth",
            state: "rejected",
            reason: "refresh_revoked",
          }),
        ],
      }),
    ],
    signIn: { login: "login-2", url: null, code: null, paste: false },
  });
  using view = render(<SettingsScreen source={source} />);
  await flush();
  const rows = [...view.container.querySelectorAll("[data-account-row]")];
  // ChatGPT 카드가 먼저(이름 순서)라 Login, Work key, Old key 순이다.
  click(find(rows[1]!, "[data-action='replace-key']"));
  await flush();
  click(find(rows[2]!, "[data-action='remove']"));
  await flush();
  assertEquals(
    calls.filter((call) =>
      call[0] === "replace-key" || call[0] === "remove-account"
    ),
    [
      ["replace-key", CLAUDE, "a"],
      ["remove-account", CLAUDE, "c"],
    ],
  );
  // 값을 넣는 입력칸은 이 화면 어디에도 없다.
  assertEquals(view.container.querySelector("input[type='password']"), null);
  click(find(rows[0]!, "[data-action='sign-in-again']"));
  await flush();
  assertEquals(calls.some((call) => call[0] === "begin-sign-in"), true);
  assertEquals(
    find(view.container, "[data-sign-in='waiting'] p").textContent,
    "No sign-in page was provided. Cancel and try again.",
  );
});

Deno.test("shell/wording#R10: 사용량 비용은 실제 청구·추정·구독 포함·무료·모름을 구별하고 모름을 0으로 채우지 않으며 읽지 못하면 그렇게 말한다", async () => {
  const { source } = fakeSettings({
    providers: [
      claude([
        account("a", "Work key", { order: 0 }),
        account("b", "Plan key", { order: 1, way: "oauth" }),
        account("c", "Quiet key", { order: 2 }),
      ]),
    ],
    usage: {
      a: {
        calls: 5,
        complete: false,
        costs: [
          { kind: "reported", amount: "1.25", currency: "USD", calls: 2 },
          { kind: "estimated", amount: "0.5", currency: "USD", calls: 1 },
          { kind: "unknown", amount: null, currency: null, calls: 2 },
        ],
      },
      b: {
        calls: 3,
        complete: true,
        costs: [
          { kind: "subscription", amount: null, currency: null, calls: 3 },
        ],
      },
    },
  });
  using view = render(<SettingsScreen source={source} />);
  await flush();
  const usage = [...view.container.querySelectorAll("[data-usage]")].map(
    textOf,
  );
  assertEquals(
    usage[0],
    "Last 30 days · $1.25 · About $0.50 · 2 calls, cost unknown · Some records are missing",
  );
  assertEquals(usage[1], "Last 30 days · 3 calls in your plan");
  assertEquals(usage[2], "Last 30 days · No use");
  assert(!usage.join(" ").includes("$0.00"));

  const broken = fakeSettings({
    providers: [claude([account("a", "Work key")])],
    usageFail: true,
  });
  using failed = render(<SettingsScreen source={broken.source} />);
  await flush();
  assertEquals(
    find(failed.container, "[data-usage='failed']").textContent,
    "Use and cost couldn't be read right now.",
  );
});

Deno.test("shell/wording#R10: 연결 테스트는 사람이 누를 때만 부르고 두 종류 결과와 모르는 비용을 보이며, 통로가 없거나 실패하면 성공으로 채우지 않는다", async () => {
  const models = { "claude-def": ["claude-large", "claude-small"] };
  const ok = fakeSettings({
    providers: [claude([account("a", "Work key")])],
    models,
  });
  using view = render(<SettingsScreen source={ok.source} />);
  await flush();
  // 화면을 연 것만으로는 부르지 않는다.
  assertEquals(ok.calls.filter((call) => call[0] === "test").length, 0);
  assertEquals(ok.calls.filter((call) => call[0] === "models").length, 0);
  click(find(view.container, "[data-action='test']"));
  await flush();
  assertEquals(ok.calls.filter((call) => call[0] === "test").length, 0);
  assertEquals(
    find(view.container, "[data-test-panel] p").textContent,
    "This sends a small made-up message. None of your documents or conversations are sent.",
  );
  click(find(view.container, "[data-action='start-test']"));
  await flush();
  assertEquals(ok.calls.filter((call) => call[0] === "test"), [[
    "test",
    CLAUDE,
    "a",
    "claude-large",
  ]]);
  assertEquals(
    [...view.container.querySelectorAll("[data-test-result]")].map(textOf),
    ["Text messages worked.", "Tool use worked."],
  );
  assert(
    textOf(view.container).includes(
      "If the cost wasn't reported, it shows as unknown above.",
    ),
  );
  // 테스트 뒤 사용량을 다시 읽는다. 테스트로 생긴 비용을 지어내지 않는다.
  assertEquals(ok.calls.filter((call) => call[0] === "usage").length, 2);

  const mixed = fakeSettings({
    providers: [claude([account("a", "Work key")])],
    models,
    testResults: [
      { kind: "text", result: "failure", timeoutSeconds: 30 },
      { kind: "tool_call", result: null, timeoutSeconds: 30 },
    ],
  });
  using second = render(<SettingsScreen source={mixed.source} />);
  await flush();
  click(find(second.container, "[data-action='test']"));
  await flush();
  click(find(second.container, "[data-action='start-test']"));
  await flush();
  assertEquals(
    [...second.container.querySelectorAll("[data-test-result]")].map((
      row,
    ) => [textOf(row), row.getAttribute("data-result")]),
    [
      ["Text messages didn't work.", "failure"],
      ["Tool use wasn't tested.", "none"],
    ],
  );

  const absent = fakeSettings({
    providers: [claude([account("a", "Work key")])],
    models,
    testCode: "not_found",
  });
  using third = render(<SettingsScreen source={absent.source} />);
  await flush();
  click(find(third.container, "[data-action='test']"));
  await flush();
  click(find(third.container, "[data-action='start-test']"));
  await flush();
  assertEquals(
    find(third.container, "[data-test='absent']").textContent,
    "Connection tests aren't available in this version yet.",
  );
  assertEquals(third.container.querySelector("[data-test-results]"), null);

  const noModels = fakeSettings({
    providers: [claude([account("a", "Work key")])],
  });
  using fourth = render(<SettingsScreen source={noModels.source} />);
  await flush();
  click(find(fourth.container, "[data-action='test']"));
  await flush();
  assertEquals(
    find(fourth.container, "[data-test='no-models']").textContent,
    "The models for this connection couldn't be listed, so it can't be tested yet.",
  );
});

Deno.test("shell/wording#R10: 사용량 한도 대기 중인 계정은 테스트로 대기를 우회하지 못하고 마지막 테스트 결과와 안 한 테스트를 구별한다", async () => {
  const { source } = fakeSettings({
    providers: [
      {
        ...claude([
          account("a", "Waiting key", {
            state: "usage_wait",
            reason: "quota",
            until: AT,
          }),
        ]),
        lastCheck: { at: AT, result: "failure", kind: "text", model: "m" },
      },
    ],
  });
  using view = render(<SettingsScreen source={source} />);
  await flush();
  assertEquals(view.container.querySelector("[data-action='test']"), null);
  assertEquals(
    find(view.container, "[data-last-check='failure']").textContent?.includes(
      "didn't work",
    ),
    true,
  );
});

Deno.test("shell/wording#R13: 일반 자리의 model 선택은 For decisions·For summaries 라벨이고 쓸 수 있는 계정이 있는 연결만 고르며 기본값만 바꾼다", async () => {
  const { source, calls } = fakeSettings({
    providers: [
      claude([
        account("a", "Work key", { order: 1 }),
        account("b", "First key", { order: 0 }),
        account("c", "Old key", {
          order: 2,
          state: "rejected",
          reason: "authentication",
        }),
      ]),
      provider(CHATGPT, "ChatGPT", {
        ways: ["oauth"],
        signIn: { verified: true },
      }),
    ],
    models: { "claude-def": ["claude-large", "claude-small"] },
    defaults: {
      decisions: { provider: CLAUDE, model: "claude-small" },
      summaries: null,
      seq: "9",
    },
  });
  using view = render(<SettingsScreen source={source} />);
  pressTab(byText(view.container, "General"));
  await flush();
  const decisions = find(view.container, "[data-model-use='decisions']");
  const summaries = find(view.container, "[data-model-use='summaries']");
  assertEquals(find(decisions, "h3").textContent, "For decisions");
  assertEquals(find(summaries, "h3").textContent, "For summaries");
  assertEquals(
    find(decisions, "[data-model-current]").textContent,
    "claude-small on Claude.",
  );
  assertEquals(
    find(summaries, "[data-model-current]").textContent,
    "No model is chosen yet.",
  );
  // 안쪽 개념 이름이 라벨에 없다.
  const text = textOf(find(view.container, "[data-models]"));
  for (const raw of ["judgment", "organizing", "provider"]) {
    assert(!text.toLowerCase().includes(raw), raw);
  }
  // 저장: 계정은 쓸 수 있는 것만, 사람이 정한 순서로 보낸다. 기존 Preset 얘기는 하지 않는다.
  click(find(summaries, "[data-action='save-model']"));
  await flush();
  assertEquals(calls.find((call) => call[0] === "set-default"), [
    "set-default",
    "summaries",
    CLAUDE,
    "claude-large",
    ["b", "a"],
    "9",
  ]);
  assertEquals(
    find(summaries, "[data-notice]").textContent,
    "Saved. New Presets will start with this model.",
  );
  assertEquals(
    find(summaries, "[data-model-current]").textContent,
    "claude-large on Claude.",
  );
});

Deno.test("shell/wording#R13: model 기본값이 다른 곳에서 바뀌었으면 최신을 다시 읽게 하고 이유 없는 실패는 그대로임을 말한다", async () => {
  const stale = fakeSettings({
    providers: [claude([account("a", "Work key")])],
    models: { "claude-def": ["claude-large"] },
    setDefaultCode: "conflict",
  });
  using view = render(<SettingsScreen source={stale.source} />);
  pressTab(byText(view.container, "General"));
  await flush();
  const before =
    stale.calls.filter((call) => call[0] === "model-defaults").length;
  click(
    find(
      view.container,
      "[data-model-use='decisions'] [data-action='save-model']",
    ),
  );
  await flush();
  assertEquals(
    find(view.container, "[data-model-use='decisions'] [data-notice]")
      .textContent,
    "This changed somewhere else. The latest is shown. Try again.",
  );
  assertEquals(
    stale.calls.filter((call) => call[0] === "model-defaults").length,
    before + 1,
  );
  const failed = fakeSettings({
    providers: [claude([account("a", "Work key")])],
    models: { "claude-def": ["claude-large"] },
    setDefaultCode: "unavailable",
  });
  using second = render(<SettingsScreen source={failed.source} />);
  pressTab(byText(second.container, "General"));
  await flush();
  click(
    find(
      second.container,
      "[data-model-use='decisions'] [data-action='save-model']",
    ),
  );
  await flush();
  assertEquals(
    find(second.container, "[data-model-use='decisions'] [data-notice]")
      .textContent,
    "Couldn't save the choice. Nothing changed.",
  );
});

Deno.test("shell/wording#R13: 설정 값은 정의와 현재 적용값을 기본으로 보이고 효력 시점·기본값·출처는 펼친 곳에 두며 정해지지 않은 값을 지어내지 않는다", async () => {
  const { source } = fakeSettings({
    settings: {
      rows: [
        setting(
          "shell.os_notifications",
          "Show a desktop notification when something needs your attention.",
          true,
          {
            changed: true,
            defaultValue: false,
            applyAt: "current_check",
          },
        ),
        setting("lophn-agent.run_attempts", "Run limit: attempts (count).", 3),
        setting(
          "shell.reading_width",
          "Reading width shared by every document.",
          "default",
          {
            applyAt: "next_call",
          },
        ),
        setting("x.unset", "A value nobody chose.", null, {
          resolved: false,
          hasDefault: false,
        }),
        setting(
          "lophn-agent.extensions.skill_folders",
          "Registered absolute skill discovery roots in user order.",
          ["/a"],
        ),
        setting(
          "lophn-agent.extensions.mcp_servers",
          "Registered external MCP servers.",
          [],
        ),
      ],
    },
  });
  using view = render(<SettingsScreen source={source} />);
  pressTab(byText(view.container, "General"));
  await flush();
  const rows = [...view.container.querySelectorAll("[data-setting]")];
  // 확장 설정은 확장 자리에서 보이므로 여기에는 없다.
  assertEquals(rows.map((row) => row.getAttribute("data-setting")), [
    "shell.os_notifications",
    "lophn-agent.run_attempts",
    "shell.reading_width",
    "x.unset",
  ]);
  assertEquals(
    rows.map((row) => find(row, "[data-value]").textContent),
    ["On", "3", "Default", "Not set"],
  );
  const first = rows[0]!;
  // 기본 화면: 정의와 현재 값. 효력 시점·기본값은 펼친 자리(details) 안이다.
  const details = find(first, "details");
  assertEquals(details.hasAttribute("open"), false);
  assertEquals(
    [...details.querySelectorAll("dt")].map(textOf),
    ["Applies", "Default", "Where it comes from"],
  );
  assertEquals(
    [...details.querySelectorAll("dd")].map(textOf),
    ["Right away", "Off", "Changed by you"],
  );
  assertEquals(
    [...rows[2]!.querySelectorAll("dd")].map(textOf),
    ["Starting with the next call", "Default", "lophn's default"],
  );
  assertEquals(
    [...rows[3]!.querySelectorAll("dd")].map(textOf).slice(1, 2),
    ["None"],
  );
});

Deno.test("shell/wording#R10: 확장은 skill 폴더를 OS 선택기로 고른 폴더만 등록하고 실패하면 그대로임과 다음 행동을, 그만두면 아무 말 없이 둔다", async () => {
  const ok = fakeSettings({
    settings: { folders: ["/home/me/old"] },
  });
  using view = render(<SettingsScreen source={ok.source} />);
  pressTab(byText(view.container, "Tools and skills"));
  await flush();
  assertEquals(
    [...view.container.querySelectorAll("[data-folder]")].map((row) =>
      find(row, "[data-folder-name]").textContent
    ),
    ["old"],
  );
  click(find(view.container, "[data-action='add-folder']"));
  await flush();
  assertEquals(ok.calls.find((call) => call[0] === "add-folder"), [
    "add-folder",
    3,
  ]);
  assertEquals(
    find(view.container, "[data-notice='folder-added']").textContent,
    "notes is added. New work can use its skills.",
  );

  const cancelled = fakeSettings({ pickedFolder: null });
  using second = render(<SettingsScreen source={cancelled.source} />);
  pressTab(byText(second.container, "Tools and skills"));
  await flush();
  assertEquals(
    find(second.container, "[data-skills-empty]").textContent,
    "No skill folders are added yet.",
  );
  click(find(second.container, "[data-action='add-folder']"));
  await flush();
  assertEquals(second.container.querySelector("[data-notice]"), null);

  const failed = fakeSettings({ applyCode: "invalid_input" });
  using third = render(<SettingsScreen source={failed.source} />);
  pressTab(byText(third.container, "Tools and skills"));
  await flush();
  click(find(third.container, "[data-action='add-folder']"));
  await flush();
  assertEquals(
    find(third.container, "[data-notice='folder-failed']").textContent,
    "The folder wasn't added. Nothing changed. Pick the folder again.",
  );

  const stale = fakeSettings({ applyCode: "conflict" });
  using fourth = render(<SettingsScreen source={stale.source} />);
  pressTab(byText(fourth.container, "Tools and skills"));
  await flush();
  click(find(fourth.container, "[data-action='add-folder']"));
  await flush();
  assertEquals(
    find(fourth.container, "[data-notice='changed']").textContent,
    "This changed somewhere else. The latest is shown. Try again.",
  );
});

Deno.test("shell/wording#R10: 도구 server는 이름·방식·정확한 실행 또는 주소·인증 방식을 정해 추가하고 잘못된 값은 이유와 함께 막으며 로그인 방식은 아직 고르지 못한다", async () => {
  const { source, calls } = fakeSettings({
    settings: { servers: [server("notes")] },
  });
  using view = render(<SettingsScreen source={source} />);
  pressTab(byText(view.container, "Tools and skills"));
  await flush();
  click(find(view.container, "[data-action='show-server-form']"));
  const form = find(view.container, "[data-server-form]");
  // 아무것도 넣지 않고 추가하면 이유만 보이고 보내지 않는다.
  click(find(form, "[data-action='add-server']"));
  await flush();
  assertEquals(calls.some((call) => call[0] === "add-server"), false);
  assert(
    textOf(form).includes(
      "Use letters, numbers, dashes and underscores, up to 32.",
    ),
  );
  assert(
    textOf(form).includes(
      "Enter the full path of the program, starting from the top folder.",
    ),
  );
  // 이미 있는 이름은 받지 않는다.
  const inputs = () => [...form.querySelectorAll("input")];
  typeInto(inputs()[0]!, "notes");
  click(find(form, "[data-action='add-server']"));
  await flush();
  assert(textOf(form).includes("A server with this name already exists."));
  typeInto(inputs()[0]!, "files");
  typeInto(inputs()[1]!, "relative/tool");
  click(find(form, "[data-action='add-server']"));
  await flush();
  assertEquals(calls.some((call) => call[0] === "add-server"), false);
  typeInto(inputs()[1]!, "/usr/local/bin/files-mcp");
  const args = form.querySelector("textarea")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(args, "--root\n/home/me/docs\n\n");
    args.dispatchEvent(new Event("input", { bubbles: true }));
  });
  click(find(form, "[data-action='add-server']"));
  await flush();
  const added = calls.find((call) => call[0] === "add-server");
  assert(added !== undefined);
  assertEquals(added![2], {
    transport: "stdio",
    name: "files",
    executable: "/usr/local/bin/files-mcp",
    args: ["--root", "/home/me/docs"],
  });
  assertEquals(
    find(view.container, "[data-notice='server-added']").textContent,
    "files is added. New work can use it once any credential is saved.",
  );
});

Deno.test("shell/wording#R10: 도구 server의 credential 값은 이 화면이 받지 않고 보호 창이 받으며 credential이 없는 server는 다음 행동을 보인다", async () => {
  const { source, calls } = fakeSettings({
    settings: {
      servers: [
        server("notes", {
          auth: "bearer",
          secret: "mcp-notes",
          credential: "missing",
        }),
        server("search", {
          auth: "api_key",
          secret: "mcp-search",
          credential: "set",
        }),
        server("odd", { auth: "oauth2" }),
        server("flaky", {
          auth: "bearer",
          secret: "mcp-flaky",
          credential: "unknown",
        }),
        server("local", { transport: "stdio" }),
      ],
    },
  });
  using view = render(<SettingsScreen source={source} />);
  pressTab(byText(view.container, "Tools and skills"));
  await flush();
  const credential = (name: string) =>
    find(view.container, `[data-server='${name}']`).querySelector(
      "[data-credential]",
    )?.textContent ?? null;
  assertEquals(
    credential("notes"),
    "A credential is needed before new work can use this server.",
  );
  assertEquals(credential("search"), "Credential saved.");
  assertEquals(
    credential("flaky"),
    "Whether a credential is saved couldn't be checked.",
  );
  assertEquals(credential("local"), null);
  assert(
    textOf(find(view.container, "[data-server='odd']")).includes(
      "Signing in to this server isn't available yet.",
    ),
  );
  // 값이 없는 server만 [Enter credential]이 있고, 눌러도 이름만 넘어가 창이 연다.
  assertEquals(
    view.container.querySelectorAll("[data-action='enter-credential']").length,
    2,
  );
  click(
    find(
      find(view.container, "[data-server='notes']"),
      "[data-action='enter-credential']",
    ),
  );
  await flush();
  assertEquals(calls.find((call) => call[0] === "server-credential"), [
    "server-credential",
    "mcp-notes",
  ]);
  assertEquals(view.container.querySelector("input[type='password']"), null);
  assertEquals(
    find(view.container, "[data-notice='window-opened']").textContent,
    "Finish in the window that opened. This list updates when you come back.",
  );
});

Deno.test("shell/wording#R10: 읽지 못한 자리는 대상과 다시 시도를 보이고 연결이 하나도 없으면 한 문장만 보인다", async () => {
  const failed = fakeSettings({ providersFail: true, settingsFail: true });
  using view = render(<SettingsScreen source={failed.source} />);
  await flush();
  assertEquals(
    find(view.container, "[data-state='error'] p").textContent,
    "Couldn't load your connections.",
  );
  pressTab(byText(view.container, "Tools and skills"));
  await flush();
  assertEquals(
    find(view.container, "[data-state='error'] p").textContent,
    "Couldn't load your tools and skills.",
  );
  const empty = fakeSettings();
  using second = render(<SettingsScreen source={empty.source} />);
  await flush();
  assertEquals(
    find(second.container, "[data-settings-panel]").textContent,
    "No connections are available yet. They appear here once lophn can set them up.",
  );
});

const ready: CoreSource = {
  subscribe(listener) {
    listener({ state: "ready", confirmedAt: 1 });
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

Deno.test("shell/wording#R10: 전역 [Instructions] 단추는 settings에서 전역 지침 편집기를 열고 돌아오면 settings이며, 설정의 뜻은 대화 도크로 묻는다", async () => {
  const { source } = fakeSettings({ settings: { rows: [] } });
  const opens: unknown[] = [];
  const instructions: InstructionsSource = {
    open: ({ target }) => {
      opens.push(target);
      return Promise.resolve({ ok: false, code: "unavailable" });
    },
    create: () => Promise.resolve({ ok: false, code: "unavailable" }),
  };
  const lophn = fakeSource().source;
  using view = render(
    <Desktop
      source={ready}
      initial={openLophn("settings")}
      lophn={lophn}
      settings={source}
      instructions={instructions}
      editor={{} as unknown as EditorDeps}
      windowWidth={1280}
    />,
  );
  await flush();
  pressTab(byText(view.container, "General"));
  await flush();
  click(find(view.container, "[data-open-instructions]"));
  await flush();
  const space = find(view.container, "[data-space='instructions']");
  assertEquals(space.getAttribute("data-instructions"), "global");
  assertEquals(opens, [{ layer: "global" }]);
  click(find(view.container, "[data-instructions-back]"));
  await flush();
  assertEquals(
    find(view.container, "[data-space='lophn']").getAttribute(
      "data-current-screen",
    ),
    "settings",
  );
});

Deno.test("shell/wording#R13: 단추가 없는 창은 [Instructions]·Ask lophn을 두지 않고 있는 창은 눌러 연다", async () => {
  const { source } = fakeSettings({ settings: { rows: [] } });
  using bare = render(<SettingsScreen source={source} />);
  await flush();
  assertEquals(bare.container.querySelector("[data-action='ask-lophn']"), null);
  pressTab(byText(bare.container, "General"));
  await flush();
  assertEquals(bare.container.querySelector("[data-open-instructions]"), null);
  let asked = 0;
  let opened = 0;
  using wired = render(
    <SettingsScreen
      source={source}
      onAsk={() => asked++}
      onInstructions={() => opened++}
    />,
  );
  await flush();
  click(find(wired.container, "[data-action='ask-lophn']"));
  assertEquals(asked, 1);
  pressTab(byText(wired.container, "General"));
  await flush();
  click(find(wired.container, "[data-open-instructions]"));
  assertEquals(opened, 1);
});

Deno.test("shell/desktop#R31: settings는 왼쪽 세로 nav에 자리를 묶어 두고 통로가 있는 자리만 보이며 backup은 두지 않는다", async () => {
  const { source } = fakeSettings({ providers: [claude([])] });
  using bare = render(<SettingsScreen source={source} />);
  await flush();
  // 통로가 없으면 그 자리를 두지 않는다. 연결·도구·일반 자리는 늘 선다.
  const navLabels = (root: Element) =>
    [...root.querySelectorAll("[data-settings-nav]")].map(
      (item) => textOf(item).trim(),
    );
  const bareItems = navLabels(bare.container);
  assertEquals(bareItems, ["Connections", "Tools and skills", "General"]);

  const update = fakeUpdate({ picked: null });
  const diag = fakeDiagnostics();
  const notes = fakeNotifications({ enabled: false });
  const backup = fakeBackup({ backups: [] });
  using wired = render(
    <SettingsScreen
      source={source}
      backup={backup.source}
      update={update.source}
      diagnostics={diag.source}
      notifications={notes.source}
    />,
  );
  await flush();
  // backup 통로가 와도 nav에 backup 자리를 두지 않는다.
  assertEquals(navLabels(wired.container), [
    "Connections",
    "Tools and skills",
    "General",
    "Notifications",
    "Update lophn",
    "Diagnose",
  ]);
  const groups = [...wired.container.querySelectorAll("nav h2")].map(
    (heading) => textOf(heading).trim(),
  );
  assertEquals(groups, ["Integrations", "Preferences", "System"]);
  // 고른 자리는 aria-selected로 표시하고 그 자리 하나만 가운데 column에 그린다.
  assertEquals(
    find(wired.container, "[role=tab][aria-selected=true]").textContent,
    "Connections",
  );
  assertEquals(wired.container.querySelector("[data-backup]"), null);
  pressTab(byText(wired.container, "Diagnose"));
  await flush();
  assertEquals(
    find(wired.container, "[role=tab][aria-selected=true]").textContent,
    "Diagnose",
  );
  assertEquals(
    find(wired.container, "[data-settings-panel]").getAttribute(
      "data-settings-panel",
    ),
    "diagnostics",
  );
  assertEquals(wired.container.querySelector("h1")?.textContent, "Diagnose");
});
