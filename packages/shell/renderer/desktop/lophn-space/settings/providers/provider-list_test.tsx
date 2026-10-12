import { assert, assertEquals } from "@std/assert";
import { click, render } from "../../../../../../design/components/testing.ts";

import { find, flush } from "../../testdata/dom.ts";
import { buttonText } from "../testdata/field.ts";
import { provider } from "../testdata/fake-settings.ts";
import { ProviderList } from "./provider-list.tsx";
import {
  ANTHROPIC,
  CONNECTED,
  definition,
  fakeProviders,
  type FakeProvidersOptions,
  OPENAI,
  XAI,
} from "./testdata/fake-providers.ts";

async function open(options: FakeProvidersOptions = {}) {
  const fake = fakeProviders(options);
  const view = render(<ProviderList source={fake.source} />);
  await flush();
  return { fake, view };
}

function text(root: ParentNode, selector: string): string {
  return find(root, selector).textContent ?? "";
}

function rows(root: ParentNode, attribute: string): string[] {
  return [...root.querySelectorAll(`[${attribute}]`)].map((row) =>
    row.getAttribute(attribute) ?? ""
  );
}

Deno.test("shell/desktop#R49: Providers는 연결된 provider의 이름·로그인 방법·[Disconnect]와 Add a provider 목록의 [+ Connect]를 이 순서로 보이고 model 고르기가 없다", async () => {
  const { view } = await open();
  using _ = view;
  const headings = [...view.container.querySelectorAll("h2")].map((h) =>
    h.textContent
  );
  assertEquals(headings, ["Connected", "Add a provider"]);
  assertEquals(rows(view.container, "data-provider"), [ANTHROPIC, OPENAI, XAI]);
  const anthropic = find(view.container, `[data-provider='${ANTHROPIC}']`);
  assertEquals(text(anthropic, "[data-provider-name]"), "Anthropic");
  assertEquals(text(anthropic, "[data-login-methods]"), "API key");
  // 로그인한 연결은 로그인 방법만 말한다.
  const openai = find(view.container, `[data-provider='${OPENAI}']`);
  assertEquals(text(openai, "[data-login-methods]"), "Signed in");
  for (const row of view.container.querySelectorAll("[data-provider]")) {
    assertEquals(text(row, "[data-action='disconnect']"), "Disconnect");
  }
  assertEquals(rows(view.container, "data-available"), [
    "google",
    "openrouter",
    "custom",
  ]);
  const google = find(view.container, "[data-available='google']");
  assertEquals(text(google, "[data-provider-name]"), "Google");
  assertEquals(text(google, "[data-hint]"), "Gemini models");
  assertEquals(text(google, "[data-action='connect']"), "Connect");
  assertEquals(
    view.container.querySelectorAll("select, [role='combobox']").length,
    0,
  );
  assert(
    (view.container.textContent ?? "").includes(
      "You choose models per agent and per session, not here.",
    ),
  );
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R8: 연결된 행에는 계정 목록·펼치기·순서·끄기·연결 테스트가 없고 Add a provider에도 로컬 항목이 없다", async () => {
  const { view } = await open();
  using _ = view;
  const body = view.container;
  for (
    const gone of [
      "[data-action='expand']",
      "[data-accounts]",
      "[data-account]",
      "[role='switch']",
      "[data-action='test']",
      "[data-test-panel]",
      "[data-note='next-run']",
    ]
  ) {
    assertEquals(body.querySelectorAll(gone).length, 0, gone);
  }
  const labels = [...body.querySelectorAll("button")].map((button) =>
    button.getAttribute("aria-label") ?? button.textContent ?? ""
  );
  for (const label of labels) {
    assert(
      !/Move .* (up|down)|Use .*|Test connection|Accounts for/.test(label),
    );
  }
  assert(!(body.textContent ?? "").includes("Ollama"));
  assertEquals(body.querySelector("[data-available='ollama']"), null);
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R4: 사용량 대기나 사용 불가인 provider만 그 상태와 다음 행동을 한 줄로 보인다", async () => {
  const { view } = await open({
    connected: [
      ...CONNECTED,
      provider("pvd_01h455vb4pex5v6nkc6gd5fd14", "Groq", {
        state: "rejected",
        reason: "authentication",
      }),
      provider("pvd_01h455vb4pex5v6nkc6gd5fd15", "DeepSeek", {
        state: "revoked",
        reason: "refresh_revoked",
        way: "oauth",
      }),
      provider("pvd_01h455vb4pex5v6nkc6gd5fd16", "Grok", {
        state: "rejected",
        reason: "plan_access",
      }),
    ],
  });
  using _ = view;
  const status = (id: string) =>
    view.container.querySelector(`[data-provider='${id}'] [data-status]`);
  assertEquals(status(ANTHROPIC), null);
  assertEquals(status(OPENAI), null);
  assertEquals(
    status(XAI)?.textContent,
    "Usage limit reached. Wait for the limit to reset.",
  );
  assertEquals(status(XAI)?.getAttribute("data-status"), "usage-limit");
  assertEquals(
    status("pvd_01h455vb4pex5v6nkc6gd5fd14")?.textContent,
    "There's a sign-in problem. Disconnect, then connect again.",
  );
  assertEquals(
    status("pvd_01h455vb4pex5v6nkc6gd5fd15")?.getAttribute("data-status"),
    "sign-in-problem",
  );
  assertEquals(
    status("pvd_01h455vb4pex5v6nkc6gd5fd16")?.textContent,
    "Your plan doesn't allow this. Check that your plan includes it.",
  );
  // 한 줄뿐이다: 행마다 상태 줄은 하나다.
  for (const row of view.container.querySelectorAll("[data-provider]")) {
    assert(row.querySelectorAll("[data-status]").length <= 1);
  }
});

Deno.test("shell/desktop#R49: [Disconnect]는 확인 창을 열 뿐이라 창이 열렸다고 알리고 연결은 그대로 둔다", async () => {
  const { fake, view } = await open();
  using _ = view;
  click(
    find(view.container, `[data-provider='${XAI}'] [data-action='disconnect']`),
  );
  await flush();
  assertEquals(fake.calls, [["disconnect", XAI]]);
  assertEquals(rows(view.container, "data-provider"), [ANTHROPIC, OPENAI, XAI]);
  assertEquals(
    text(view.container, "[data-notice='window-opened']"),
    "Finish in the window that opened. This list updates when you come back.",
  );
});

Deno.test("shell/desktop#R49: 창을 열지 못하면 아무것도 바뀌지 않았다고 알린다", async () => {
  const { view } = await open({ failing: { disconnect: "unavailable" } });
  using _ = view;
  click(
    find(view.container, `[data-provider='${XAI}'] [data-action='disconnect']`),
  );
  await flush();
  assertEquals(
    text(view.container, "[data-notice='window-failed']"),
    "The window didn't open. Nothing changed. Try again.",
  );
});

Deno.test("shell/desktop#R49, shell/desktop#R7: 창에서 돌아와 다시 읽으면 Disconnect한 provider는 사라져 Add a provider에서 다시 연결할 수 있다", async () => {
  const before = fakeProviders({
    available: [definition("openrouter", "OpenRouter")],
  });
  const after = fakeProviders({
    connected: CONNECTED.filter((row) => row.id !== XAI),
    available: [
      definition("openrouter", "OpenRouter"),
      definition("xai", "xAI"),
    ],
  });
  const view = render(<ProviderList source={before.source} />);
  using _ = view;
  await flush();
  assertEquals(rows(view.container, "data-provider"), [ANTHROPIC, OPENAI, XAI]);
  // 확인 창에서 xAI를 끊은 뒤 목록이 다시 읽힌다.
  view.rerender(<ProviderList source={after.source} />);
  await flush();
  assertEquals(rows(view.container, "data-provider"), [ANTHROPIC, OPENAI]);
  assertEquals(rows(view.container, "data-available"), ["openrouter", "xai"]);
  assertEquals(
    text(view.container, "[data-available='xai'] [data-action='connect']"),
    "Connect",
  );
});

Deno.test("shell/desktop#R49: Add a provider의 [+ Connect]는 그 정의의 Connect dialog를 열고 방법을 고르면 연결을 시작해 닫는다", async () => {
  const { fake, view } = await open();
  using _ = view;
  assertEquals(document.body.querySelector("[role='dialog']"), null);
  click(
    find(view.container, "[data-available='google'] [data-action='connect']"),
  );
  await flush();
  const dialog = find(document.body, "[role='dialog']");
  assertEquals(text(dialog, "h2"), "Connect Google");
  click(find(dialog, "[data-method='api_key']"));
  await flush();
  assertEquals(fake.calls, [["connect", "google", "api_key"]]);
  assertEquals(document.body.querySelector("[role='dialog']"), null);
});

Deno.test("shell/desktop#R49: Custom provider의 [+ Connect]는 Custom provider form dialog를 연다", async () => {
  const { view } = await open();
  using _ = view;
  click(
    find(view.container, "[data-available='custom'] [data-action='connect']"),
  );
  await flush();
  const dialog = find(document.body, "[role='dialog']");
  assertEquals(text(dialog, "h2"), "Custom provider");
  click(buttonText(dialog, "Cancel"));
  await flush();
  assertEquals(document.body.querySelector("[role='dialog']"), null);
});

Deno.test("shell/desktop#R49, shell/desktop#R7: 연결된 provider를 읽지 못하면 빈 목록이 아니라 읽지 못했다고 보이고 다시 읽으면 나온다", async () => {
  const failing: NonNullable<FakeProvidersOptions["failing"]> = {
    connected: "unavailable",
  };
  const { view } = await open({ failing });
  using _ = view;
  find(view.container, "[data-state='error']");
  assertEquals(view.container.querySelectorAll("[data-provider]").length, 0);
  delete failing.connected;
  click(buttonText(view.container, "Reload"));
  await flush();
  assertEquals(rows(view.container, "data-provider"), [ANTHROPIC, OPENAI, XAI]);
});
