import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../../packages/design/components/testing.ts";

import { find, flush, typeInto } from "../../testdata/dom.ts";
import { buttonText, fieldInput } from "../testdata/field.ts";
import { ConnectDialog } from "./connect-dialog.tsx";
import type { ProviderDefinitionRow } from "./settings-source.ts";
import {
  CUSTOM_DEFINITION,
  definition,
  fakeProviders,
  type FakeProvidersOptions,
  OPENAI_DEFINITION,
} from "./testdata/fake-providers.ts";

async function open(
  target: ProviderDefinitionRow,
  options: FakeProvidersOptions = {},
) {
  const fake = fakeProviders(options);
  const log = { closed: 0, connected: 0 };
  const view = render(
    <ConnectDialog
      source={fake.source}
      definition={target}
      onClose={() => {
        log.closed += 1;
      }}
      onConnected={() => {
        log.connected += 1;
      }}
    />,
  );
  await flush();
  return { fake, log, view, dialog: find(document.body, "[role='dialog']") };
}

function text(root: ParentNode, selector: string): string {
  return find(root, selector).textContent ?? "";
}

function methods(dialog: ParentNode): string[] {
  return [...dialog.querySelectorAll("[data-method]")].map((item) =>
    item.getAttribute("data-method") ?? ""
  );
}

function fill(dialog: ParentNode, values: Record<string, string>): void {
  for (const [label, value] of Object.entries(values)) {
    typeInto(fieldInput(dialog, label), value);
  }
}

const VALID = {
  "Provider ID": "myprovider",
  "Display name": "My AI provider",
  "Base URL": "https://api.myprovider.com/v1",
};

Deno.test("shell/desktop#R49 [agent-I30]: Connect dialog는 그 정의가 지원하는 로그인 방법만 순서대로 고르게 하고 model 칸이 없다", async () => {
  const { view, dialog } = await open(OPENAI_DEFINITION);
  using _ = view;
  assertEquals(text(dialog, "h2"), "Connect OpenAI");
  assert(
    (dialog.textContent ?? "").includes(
      "How do you want to sign in to OpenAI?",
    ),
  );
  assertEquals(methods(dialog), ["oauth", "api_key"]);
  const [login, key] = [...dialog.querySelectorAll("[data-method]")];
  assertEquals(text(login!, "[data-method-name]"), "Sign in with ChatGPT");
  assertEquals(text(login!, "[data-method-hint]"), "Opens your browser");
  assertEquals(text(key!, "[data-method-name]"), "API key");
  assertEquals(text(key!, "[data-method-hint]"), "Paste a key");
  assertEquals(dialog.querySelectorAll("select, [role='combobox']").length, 0);
  assertEquals(
    [...dialog.querySelectorAll("button")].filter((button) =>
      button.getAttribute("data-method") === null
    ).map((button) => button.textContent),
    ["Cancel"],
  );
});

Deno.test("shell/desktop#R49 [agent-I30]: 로컬 정의는 Local server 한 방법만 고르게 한다", async () => {
  const { view, dialog } = await open(
    definition("ollama", "Ollama (local)", { ways: ["none"] }),
  );
  using _ = view;
  assertEquals(text(dialog, "h2"), "Connect Ollama (local)");
  assertEquals(methods(dialog), ["none"]);
  assertEquals(text(dialog, "[data-method-name]"), "Local server");
});

Deno.test("shell/desktop#R49 [agent-I30]: 방법을 고르면 그 정의와 방법으로 연결을 시작하고 목록을 다시 읽게 한 뒤 닫는다", async () => {
  const { fake, log, view, dialog } = await open(OPENAI_DEFINITION);
  using _ = view;
  click(find(dialog, "[data-method='oauth']"));
  await flush();
  assertEquals(fake.calls, [["connect", "openai", "oauth"]]);
  assertEquals(log, { closed: 1, connected: 1 });
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R1 [agent-I30]: lophn 이름으로 허용이 확인되지 않은 로그인은 고를 수 없고 다른 방법은 그대로 고른다", async () => {
  const { fake, view, dialog } = await open(
    definition("supergrok", "SuperGrok", {
      ways: ["oauth", "api_key"],
      signIn: { product: "SuperGrok", verified: false },
    }),
  );
  using _ = view;
  const login = find(dialog, "[data-method='oauth']");
  assertEquals(login.hasAttribute("disabled"), true);
  assertEquals(
    text(login, "[data-method-hint]"),
    "Not confirmed to work with lophn yet.",
  );
  click(login);
  await flush();
  assertEquals(fake.calls, []);
  click(find(dialog, "[data-method='api_key']"));
  await flush();
  assertEquals(fake.calls, [["connect", "supergrok", "api_key"]]);
});

Deno.test("shell/desktop#R49 [agent-I30]: 연결을 시작하지 못하면 dialog를 열어 둔 채 아무것도 바뀌지 않았다고 알린다", async () => {
  const { log, view, dialog } = await open(OPENAI_DEFINITION, {
    failing: { connect: "unavailable" },
  });
  using _ = view;
  click(find(dialog, "[data-method='oauth']"));
  await flush();
  assertEquals(log, { closed: 0, connected: 0 });
  assertEquals(
    text(dialog, "[data-notice='connect-failed']"),
    "Couldn't connect. Nothing changed. Try again.",
  );
});

Deno.test("shell/desktop#R49 [agent-I30]: [Cancel]은 아무것도 보내지 않고 닫는다", async () => {
  const { fake, log, view, dialog } = await open(OPENAI_DEFINITION);
  using _ = view;
  click(buttonText(dialog, "Cancel"));
  await flush();
  assertEquals(fake.calls, []);
  assertEquals(log, { closed: 1, connected: 0 });
});

Deno.test("shell/desktop#R49 [agent-I30]: Custom provider form은 ID·Display name·Base URL과 선택 항목 API key를 받되 key 값 입력칸은 없다", async () => {
  const { view, dialog } = await open(CUSTOM_DEFINITION);
  using _ = view;
  assertEquals(text(dialog, "h2"), "Custom provider");
  assert(
    (dialog.textContent ?? "").includes(
      "Set up an OpenAI-compatible provider.",
    ),
  );
  assertEquals(
    [...dialog.querySelectorAll("label")].map((label) => label.textContent),
    [
      "Provider ID",
      "Display name",
      "Base URL",
      "Add an API key (optional)",
    ],
  );
  assert(
    (dialog.textContent ?? "").includes(
      "Lowercase letters, numbers, hyphens or underscores.",
    ),
  );
  // key는 보호 창이 받는다(platform/secrets#R2).
  assertEquals(dialog.querySelectorAll("input[type='password']").length, 0);
  assertEquals(
    [...dialog.querySelectorAll("button")].filter((button) =>
      button.getAttribute("role") !== "checkbox"
    ).map((button) => button.textContent),
    ["Cancel", "Connect"],
  );
  assertEquals(buttonText(dialog, "Connect").hasAttribute("disabled"), true);
});

Deno.test("shell/desktop#R49 [agent-I30]: 세 칸을 채우면 [Connect]가 켜지고 누르면 입력 그대로 등록해 목록을 다시 읽게 한 뒤 닫는다", async () => {
  const { fake, log, view, dialog } = await open(CUSTOM_DEFINITION);
  using _ = view;
  fill(dialog, VALID);
  assertEquals(buttonText(dialog, "Connect").hasAttribute("disabled"), false);
  click(buttonText(dialog, "Connect"));
  await flush();
  assertEquals(fake.calls, [["custom", {
    id: "myprovider",
    name: "My AI provider",
    baseUrl: "https://api.myprovider.com/v1",
    withKey: false,
  }]]);
  assertEquals(log, { closed: 1, connected: 1 });
});

Deno.test("shell/desktop#R49, platform/secrets#R2 [agent-I30]: API key 선택을 켜면 key 값이 아니라 withKey만 보낸다", async () => {
  const { fake, view, dialog } = await open(CUSTOM_DEFINITION);
  using _ = view;
  fill(dialog, VALID);
  click(find(dialog, "[role='checkbox']"));
  assert(
    (dialog.textContent ?? "").includes(
      "You enter the key in a protected window after you connect.",
    ),
  );
  click(buttonText(dialog, "Connect"));
  await flush();
  assertEquals(fake.calls.length, 1);
  const [, input] = fake.calls[0]!;
  assertEquals(Object.keys(input as object).sort(), [
    "baseUrl",
    "id",
    "name",
    "withKey",
  ]);
  assertEquals((input as { withKey: boolean }).withKey, true);
});

Deno.test("shell/desktop#R49, lophn-agent/harness/provider#R5 [agent-I30]: ID 모양이 틀리거나 이름이 비거나 Base URL이 https도 이 컴퓨터의 http도 아니면 [Connect]가 꺼져 있고 이유를 그 칸에 보인다", async () => {
  const { fake, view, dialog } = await open(CUSTOM_DEFINITION);
  using _ = view;
  const connect = () => buttonText(dialog, "Connect");
  fill(dialog, VALID);
  assertEquals(connect().hasAttribute("disabled"), false);

  fill(dialog, { "Provider ID": "MyProvider" });
  assertEquals(connect().hasAttribute("disabled"), true);
  assert(
    (dialog.textContent ?? "").includes(
      "Use lowercase letters, numbers, hyphens or underscores.",
    ),
  );
  fill(dialog, { "Provider ID": "my-provider_2" });
  assertEquals(connect().hasAttribute("disabled"), false);

  fill(dialog, { "Display name": "   " });
  assertEquals(connect().hasAttribute("disabled"), true);
  fill(dialog, { "Display name": "My AI provider" });

  for (
    const url of [
      "http://192.168.0.5/v1",
      "http://api.example.com/v1",
      "ftp://x.test",
      "api.example.com",
    ]
  ) {
    fill(dialog, { "Base URL": url });
    assertEquals(connect().hasAttribute("disabled"), true, url);
  }
  assert(
    (dialog.textContent ?? "").includes(
      "Use https, or http only for this computer.",
    ),
  );
  for (
    const url of [
      "https://api.example.com/v1",
      "http://localhost:11434/v1",
      "http://127.0.0.1:8080",
    ]
  ) {
    fill(dialog, { "Base URL": url });
    assertEquals(connect().hasAttribute("disabled"), false, url);
  }
  click(connect());
  await flush();
  assertEquals(fake.calls.length, 1);
});

Deno.test("shell/desktop#R49 [agent-I30]: 등록에 실패하면 dialog와 입력을 그대로 두고 아무것도 바뀌지 않았다고 알린다", async () => {
  const { log, view, dialog } = await open(CUSTOM_DEFINITION, {
    failing: { custom: "conflict" },
  });
  using _ = view;
  fill(dialog, VALID);
  click(buttonText(dialog, "Connect"));
  await flush();
  assertEquals(log, { closed: 0, connected: 0 });
  assertEquals(
    (fieldInput(dialog, "Provider ID") as HTMLInputElement).value,
    "myprovider",
  );
  assertEquals(
    text(dialog, "[data-notice='connect-failed']"),
    "Couldn't connect. Nothing changed. Try again.",
  );
});
