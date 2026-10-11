import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../../packages/design/components/testing.ts";

import { find, flush } from "../../testdata/dom.ts";
import { buttonText } from "../testdata/field.ts";
import { ProviderList } from "./provider-list.tsx";
import {
  ANTHROPIC,
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

function expand(root: ParentNode, provider: string): HTMLElement {
  const row = find(root, `[data-provider='${provider}']`);
  click(find(row, "[data-action='expand']"));
  return row;
}

function accounts(row: ParentNode): string[] {
  return rows(row, "data-account");
}

const NEXT_RUN = "Changes apply from the next run.";

Deno.test("shell/desktop#R49 [agent-I30]: Providers는 연결된 provider의 이름·로그인 방법·[Disconnect]와 Add a provider 목록의 [+ Connect]를 이 순서로 보이고 model 고르기가 없다", async () => {
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
  // 로그인한 계정은 확인한 요금제를 붙이고, key 계정과 함께 있으면 둘 다 보인다.
  const openai = find(view.container, `[data-provider='${OPENAI}']`);
  assertEquals(
    text(openai, "[data-login-methods]"),
    "Signed in (Plus) · API key",
  );
  for (const row of view.container.querySelectorAll("[data-provider]")) {
    assertEquals(text(row, "[data-action='disconnect']"), "Disconnect");
  }
  assertEquals(rows(view.container, "data-available"), [
    "google",
    "openrouter",
    "ollama",
    "custom",
  ]);
  const google = find(view.container, "[data-available='google']");
  assertEquals(text(google, "[data-provider-name]"), "Google");
  assertEquals(text(google, "[data-hint]"), "Gemini models");
  assertEquals(text(google, "[data-action='connect']"), "Connect");
  // provider는 계정만이다: model을 고르는 칸이 없다.
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

Deno.test("shell/desktop#R49 [agent-I30]: 연결된 provider는 접혀 있다가 펼치면 계정이 사람이 정한 순서로 나오고 계정마다 사용 스위치가 있다", async () => {
  const { view } = await open();
  using _ = view;
  const row = find(view.container, `[data-provider='${ANTHROPIC}']`);
  assertEquals(row.querySelector("[data-accounts]"), null);
  assertEquals(
    find(row, "[data-action='expand']").getAttribute("aria-expanded"),
    "false",
  );
  expand(view.container, ANTHROPIC);
  assertEquals(
    find(row, "[data-action='expand']").getAttribute("aria-expanded"),
    "true",
  );
  assertEquals(accounts(row), ["work", "personal", "spare"]);
  assertEquals(
    [...row.querySelectorAll("[data-account-label]")].map((label) =>
      label.textContent
    ),
    ["Work key", "Personal key", "Spare key"],
  );
  assertEquals(
    [...row.querySelectorAll("[role='switch']")].map((item) =>
      item.getAttribute("aria-checked")
    ),
    ["true", "true", "false"],
  );
  assertEquals(
    find(row, "[data-account='work'] [role='switch']").previousElementSibling
      ?.textContent,
    "Use Work key",
  );
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R8 [agent-I30]: [Move down]은 계정 순서 전부를 새 순서로 한 번 보내고 목록이 새 순서로 바뀌며 다음 run부터라고 알린다", async () => {
  const { fake, view } = await open();
  using _ = view;
  const row = expand(view.container, ANTHROPIC);
  assertEquals(row.querySelector("[data-note='next-run']"), null);
  click(find(row, "[aria-label='Move Work key down']"));
  await flush();
  assertEquals(fake.calls, [["reorder", ANTHROPIC, [
    "personal",
    "work",
    "spare",
  ]]]);
  assertEquals(accounts(row), ["personal", "work", "spare"]);
  assertEquals(text(row, "[data-note='next-run']"), NEXT_RUN);
  // 맨 위 계정은 위로, 맨 아래 계정은 아래로 갈 수 없다.
  assertEquals(
    find(row, "[aria-label='Move Personal key up']").hasAttribute("disabled"),
    true,
  );
  assertEquals(
    find(row, "[aria-label='Move Spare key down']").hasAttribute("disabled"),
    true,
  );
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R8 [agent-I30]: 순서 바꾸기가 실패하면 목록 순서는 그대로이고 실패를 알린다", async () => {
  const { fake, view } = await open({ failing: { reorder: "conflict" } });
  using _ = view;
  const row = expand(view.container, ANTHROPIC);
  click(find(row, "[aria-label='Move Personal key up']"));
  await flush();
  assertEquals(fake.calls.length, 1);
  assertEquals(accounts(row), ["work", "personal", "spare"]);
  assertEquals(
    text(row, "[data-notice='reorder-failed']"),
    "Couldn't change the order. Try again.",
  );
  assertEquals(row.querySelector("[data-note='next-run']"), null);
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R8 [agent-I30]: 계정 스위치는 그 계정의 사용만 끄고 켜며 순서는 그대로다", async () => {
  const { fake, view } = await open();
  using _ = view;
  const row = expand(view.container, ANTHROPIC);
  click(find(row, "[data-account='spare'] [role='switch']"));
  await flush();
  assertEquals(fake.calls, [["enabled", ANTHROPIC, "spare", true]]);
  assertEquals(
    find(row, "[data-account='spare'] [role='switch']").getAttribute(
      "aria-checked",
    ),
    "true",
  );
  assertEquals(accounts(row), ["work", "personal", "spare"]);
  assertEquals(text(row, "[data-note='next-run']"), NEXT_RUN);
  click(find(row, "[data-account='work'] [role='switch']"));
  await flush();
  assertEquals(fake.calls[1], ["enabled", ANTHROPIC, "work", false]);
});

Deno.test("shell/desktop#R49 [agent-I30]: [Disconnect]는 결정 창을 열 뿐이라 창이 열렸다고 알리고 연결은 그대로 둔다", async () => {
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

Deno.test("shell/desktop#R49 [agent-I30]: 창을 열지 못하면 아무것도 바뀌지 않았다고 알린다", async () => {
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

Deno.test("shell/desktop#R49 [agent-I30]: Add a provider의 [+ Connect]는 그 정의의 Connect dialog를 열고 방법을 고르면 연결을 시작해 닫는다", async () => {
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

Deno.test("shell/desktop#R49 [agent-I30]: Custom provider의 [+ Connect]는 Custom provider form dialog를 연다", async () => {
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

Deno.test("shell/desktop#R49, shell/desktop#R7 [agent-I30]: 연결된 provider를 읽지 못하면 빈 목록이 아니라 읽지 못했다고 보이고 다시 읽으면 나온다", async () => {
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
