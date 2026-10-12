// settings 화면(shell#T31). Providers·Agents·확장·일반 설정, 전역 지침 편집기로 가는 길, 설정의 뜻 묻기.
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
import { fakeAgents } from "./agents/testdata/fake-agents.ts";
import {
  ANTHROPIC,
  fakeProviders,
  OPENAI,
  XAI,
} from "./providers/testdata/fake-providers.ts";
import { buttonText } from "./testdata/field.ts";
import { fakeSettings, server, setting } from "./testdata/fake-settings.ts";

// 왼쪽 nav 단추를 누른다.
const pressTab = click;

function textOf(root: Element): string {
  return root.textContent ?? "";
}

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
        // [agent-I49] 전역에서 끈 skill 이름은 Agents 자리의 스위치로 바꾸므로 General에 줄이 없다.
        setting(
          "lophn-agent.extensions.skills_off",
          "Names of the skills switched off for every agent.",
          ["review-notes"],
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

Deno.test("shell/wording#R10: 읽지 못한 자리는 대상과 다시 시도를 보인다", async () => {
  const failed = fakeSettings({ settingsFail: true });
  using view = render(<SettingsScreen source={failed.source} />);
  pressTab(byText(view.container, "General"));
  await flush();
  assertEquals(
    find(view.container, "[data-state='error'] p").textContent,
    "Couldn't load your settings.",
  );
  pressTab(byText(view.container, "Tools and skills"));
  await flush();
  assertEquals(
    find(view.container, "[data-state='error'] p").textContent,
    "Couldn't load your tools and skills.",
  );
});

const ready: CoreSource = {
  subscribe(listener) {
    listener({ state: "ready", confirmedAt: 1 });
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

Deno.test("shell/desktop#R49 [agent-I46]: Providers 자리는 새 provider list를 그리고 model 고르기 칸이 없으며 옛 연결 카드는 없다", async () => {
  const { source } = fakeSettings();
  const fake = fakeProviders();
  using view = render(
    <SettingsScreen source={source} providers={fake.source} />,
  );
  pressTab(byText(view.container, "Providers"));
  await flush();
  assertEquals(
    find(view.container, "[role=tab][aria-selected=true]").textContent,
    "Providers",
  );
  assertEquals(view.container.querySelector("h1")?.textContent, "Providers");
  const panel = find(view.container, "[data-settings-panel='providers']");
  assertEquals(
    [...panel.querySelectorAll("h2")].map(textOf),
    ["Connected", "Add a provider"],
  );
  assertEquals(
    [...panel.querySelectorAll("[data-provider]")].map((row) =>
      row.getAttribute("data-provider")
    ),
    [ANTHROPIC, OPENAI, XAI],
  );
  // provider는 계정만 다룬다: model을 고르는 칸도, 옛 연결 카드의 key 더하기·테스트도 없다.
  assertEquals(panel.querySelectorAll("select, [role='combobox']").length, 0);
  assertEquals(panel.querySelector("[data-provider-ways]"), null);
  assertEquals(panel.querySelector("[data-action='add-key']"), null);
  assertEquals(panel.querySelector("[data-test-panel]"), null);
});

Deno.test("shell/desktop#R49 [agent-I46]: Add a provider의 [Connect]는 Connect dialog를 열고 고른 방법이 provider 통로로 가며 dialog에도 model 고르기가 없다", async () => {
  const { source } = fakeSettings();
  const fake = fakeProviders();
  using view = render(
    <SettingsScreen source={source} providers={fake.source} />,
  );
  pressTab(byText(view.container, "Providers"));
  await flush();
  click(
    find(view.container, "[data-available='google'] [data-action='connect']"),
  );
  await flush();
  const dialog = find(document.body, "[role='dialog']");
  assertEquals(find(dialog, "h2").textContent, "Connect Google");
  assertEquals(dialog.querySelectorAll("select, [role='combobox']").length, 0);
  click(find(dialog, "[data-method='api_key']"));
  await flush();
  assertEquals(fake.calls.find((call) => call[0] === "connect"), [
    "connect",
    "google",
    "api_key",
  ]);
});

Deno.test("shell/desktop#R49 [agent-I46]: Providers를 읽지 못하면 그 자리만 대상과 다시 시도를 보인다", async () => {
  const { source } = fakeSettings();
  const fake = fakeProviders({ failing: { connected: "unavailable" } });
  using view = render(
    <SettingsScreen source={source} providers={fake.source} />,
  );
  pressTab(byText(view.container, "Providers"));
  await flush();
  assertEquals(
    find(view.container, "[data-state='error'] p").textContent,
    "Couldn't load your connections.",
  );
  pressTab(byText(view.container, "General"));
  await flush();
  assertEquals(view.container.querySelector("[data-state='error']"), null);
});

Deno.test("shell/desktop#R50 [agent-I46]: Agents 자리는 새 Agents 패널을 그리고 읽은 기본값을 보인다", async () => {
  const { source } = fakeSettings();
  const fake = fakeAgents();
  using view = render(<SettingsScreen source={source} agents={fake.source} />);
  pressTab(byText(view.container, "Agents"));
  await flush();
  assertEquals(
    find(view.container, "[role=tab][aria-selected=true]").textContent,
    "Agents",
  );
  assertEquals(view.container.querySelector("h1")?.textContent, "Agents");
  const panel = find(view.container, "[data-settings-panel='agents']");
  assertEquals(
    [...panel.querySelectorAll("h2")].map(textOf),
    [
      "Default models",
      "Model for summaries",
      "Instructions for all projects",
      "Skills (all projects)",
      "MCP servers (all projects)",
    ],
  );
  assertEquals(
    [...panel.querySelectorAll("[data-slot]")].map((row) =>
      row.getAttribute("data-slot")
    ),
    ["lophn", "context_engineer", "app_engineer", "operator", "summaries"],
  );
  assert(fake.counts.reads >= 1);
});

Deno.test("shell/desktop#R50 [agent-I46]: General에는 Models와 Instructions 칸이 없고 설정 값만 있다", async () => {
  const { source, calls } = fakeSettings({
    settings: { rows: [setting("shell.reading_width", "Width.", "default")] },
  });
  using view = render(
    <SettingsScreen
      source={source}
      onInstructions={() => {}}
      agents={fakeAgents().source}
    />,
  );
  pressTab(byText(view.container, "General"));
  await flush();
  const panel = find(view.container, "[data-settings-panel='general']");
  assertEquals(
    [...panel.querySelectorAll("h2")].map(textOf),
    ["Settings"],
  );
  assertEquals(panel.querySelector("[data-models]"), null);
  assertEquals(panel.querySelector("[data-instructions]"), null);
  assertEquals(panel.querySelector("[data-open-instructions]"), null);
  assert(!textOf(panel).includes("For decisions"));
  // General은 settings 값만 읽는다. provider와 model 기본값은 읽지 않는다.
  assert(calls.length > 0 && calls.every((call) => call[0] === "settings"));
});

Deno.test("shell/desktop#R50, shell/editor#R17 [agent-I46]: Agents의 LOPHN.md [Edit]은 전역 지침 편집기를 여는 통로를 부르고 Agents 통로의 열기는 부르지 않는다", async () => {
  const { source } = fakeSettings();
  const fake = fakeAgents();
  let opened = 0;
  using view = render(
    <SettingsScreen
      source={source}
      agents={fake.source}
      onInstructions={() => opened++}
    />,
  );
  pressTab(byText(view.container, "Agents"));
  await flush();
  click(buttonText(view.container, "Edit"));
  await flush();
  assertEquals(opened, 1);
  assertEquals(fake.calls.filter((call) => call[0] === "instructions"), []);
  assertEquals(view.container.querySelector("[data-notice='failed']"), null);
});

Deno.test("shell/desktop#R50, lophn-agent/extensions#R11 [agent-I49]: Agents의 [Add server]는 server form을 가진 Tools and skills 자리로 옮기고 Agents 통로의 더하기는 부르지 않는다", async () => {
  const { source } = fakeSettings();
  const fake = fakeAgents();
  using view = render(<SettingsScreen source={source} agents={fake.source} />);
  pressTab(byText(view.container, "Agents"));
  await flush();
  click(buttonText(view.container, "Add server"));
  await flush();
  assertEquals(
    find(view.container, "[role=tab][aria-selected=true]").textContent,
    "Tools and skills",
  );
  find(view.container, "[data-settings-panel='extensions']");
  assertEquals(fake.calls.filter((call) => call[0] === "add-server"), []);
});

Deno.test("shell/desktop#R50 [agent-I46]: 전역 지침 편집기를 열 통로가 없는 창은 [Edit]이 열지 못했다고 알린다", async () => {
  const { source } = fakeSettings();
  using view = render(
    <SettingsScreen source={source} agents={fakeAgents().source} />,
  );
  pressTab(byText(view.container, "Agents"));
  await flush();
  click(buttonText(view.container, "Edit"));
  await flush();
  find(view.container, "[data-notice='failed']");
});

Deno.test("shell/wording#R10: 전역 지침 편집기는 Agents의 [Edit]이 열고 돌아오면 settings이다", async () => {
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
      settingsPanels={{ agents: fakeAgents().source }}
      instructions={instructions}
      editor={{} as unknown as EditorDeps}
      windowWidth={1280}
    />,
  );
  await flush();
  pressTab(byText(view.container, "Agents"));
  await flush();
  click(buttonText(view.container, "Edit"));
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

Deno.test("shell/wording#R13: Ask lophn은 단추가 없는 창에서는 두지 않고 있는 창은 눌러 연다", async () => {
  const { source } = fakeSettings({ settings: { rows: [] } });
  using bare = render(<SettingsScreen source={source} />);
  await flush();
  assertEquals(bare.container.querySelector("[data-action='ask-lophn']"), null);
  let asked = 0;
  using wired = render(
    <SettingsScreen source={source} onAsk={() => asked++} />,
  );
  await flush();
  click(find(wired.container, "[data-action='ask-lophn']"));
  assertEquals(asked, 1);
});

Deno.test("shell/desktop#R31, shell/desktop#R50 [agent-I46]: settings는 왼쪽 세로 nav에 자리를 묶어 두고 통로가 있는 자리만 보이며 General 다음에 Providers와 Agents가 있고 backup은 두지 않는다", async () => {
  const { source } = fakeSettings();
  using bare = render(<SettingsScreen source={source} />);
  await flush();
  // 통로가 없으면 그 자리를 두지 않는다. 일반·도구 자리는 늘 선다.
  const navLabels = (root: Element) =>
    [...root.querySelectorAll("[data-settings-nav]")].map(
      (item) => textOf(item).trim(),
    );
  assertEquals(navLabels(bare.container), ["General", "Tools and skills"]);

  const update = fakeUpdate({ picked: null });
  const diag = fakeDiagnostics();
  const notes = fakeNotifications({ enabled: false });
  const backup = fakeBackup({ backups: [] });
  using wired = render(
    <SettingsScreen
      source={source}
      providers={fakeProviders().source}
      agents={fakeAgents().source}
      backup={backup.source}
      update={update.source}
      diagnostics={diag.source}
      notifications={notes.source}
    />,
  );
  await flush();
  // backup 통로가 와도 nav에 backup 자리를 두지 않는다. 옛 Connections 자리는 Providers가 되었다.
  assertEquals(navLabels(wired.container), [
    "General",
    "Providers",
    "Agents",
    "Tools and skills",
    "Notifications",
    "Update lophn",
    "Diagnose",
  ]);
  assert(!navLabels(wired.container).includes("Connections"));
  const groups = [...wired.container.querySelectorAll("nav h2")].map(
    (heading) => textOf(heading).trim(),
  );
  assertEquals(groups, ["Preferences", "Integrations", "System"]);
  // 고른 자리는 aria-selected로 표시하고 그 자리 하나만 가운데 column에 그린다.
  assertEquals(
    find(wired.container, "[role=tab][aria-selected=true]").textContent,
    "General",
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
