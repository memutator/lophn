// Settings 화면 전체의 가짜 통로 묶음. 항목마다의 가짜 통로가 가짜 core 하나를 나눠 써서 쓰기가 같은 답을 바꾸고
// StateChanged를 낸다. 쓰는 쪽(gallery, dev mock)은 core.answers로 fake Gateway를 만들고 core.attach로 잇는다.
import type { Bookmark } from "../../../../ipc/browser.ts";
import { CUSTOM_PROVIDER } from "../../../workspace/agents/fake-source.ts";
import { fakeAgents } from "../agents/testdata/fake-agents.ts";
import type { AppearanceValues } from "../appearance/source.ts";
import { fakeAppearance } from "../appearance/testdata/fake-source.ts";
import type { Device, LinkValues, LoginRow } from "../browser/source.ts";
import { fakeBrowserSettings } from "../browser/testdata/fake-source.ts";
import { fakeConnections } from "../connections/testdata/fake-source.ts";
import { fakeDiagnostics } from "../diagnostics/testdata/fake-source.ts";
import { fakeExtensions } from "../extension-packages/testdata/fake-extensions.ts";
import type { StoredKeybindings } from "../keyboard/source.ts";
import { fakeKeyboard } from "../keyboard/testdata/fake-source.ts";
import { fakeProviders } from "../providers/testdata/fake-providers.ts";
import { fakeRemote } from "../remote/testdata/fake-source.ts";
import type { SettingsPanels } from "../settings-screen.tsx";
import {
  fakeShellRules,
  SAMPLE_SHELL_RULES,
} from "../shell-rules/testdata/fake-source.ts";
import type { SettingsSource } from "../source.ts";
import { type FakeCore, fakeCore } from "./fake-core.ts";
import { declared, fakeSettings, SAMPLE_DECLARED } from "./fake-settings.ts";

export interface FakeSettingsScreenOptions {
  /** 값이 비어 있는 필수 설정이 하나 있어 General 위에 안내가 뜬다. */
  readonly requiredEmpty?: boolean;
  /** Appearance 줄의 처음 값. 안 쓴 줄은 기본이다. */
  readonly appearance?: Partial<AppearanceValues>;
  /** 연결된 provider. none은 하나도 없고 some은 Anthropic만 있다. 안 쓰면 셋이 연결된 모양이다. */
  readonly providers?: "none" | "some";
  /** 전역 기본 model을 아직 고르지 않았다. */
  readonly noDefaultModel?: boolean;
  readonly browser?: {
    readonly bookmarks?: Bookmark[];
    readonly corrupt?: boolean;
    readonly links?: Partial<LinkValues>;
    readonly devices?: Device[];
    readonly logins?: LoginRow[];
  };
  readonly keyboard?: StoredKeybindings;
  /** Extensions 항목에 가짜 `lophnExtensions` 통로와 `extensions.<id>.enabled` 선언을 끼운다. */
  readonly extensions?: boolean;
  /** custom provider를 붙일 수 있게 한다. found는 연결 뒤 목록을 찾고, empty는 /models가 없어 목록이 비어 있다. */
  readonly customList?: "found" | "empty";
}

export interface FakeSettingsScreen {
  /** 화면이 읽는 route의 답. fake Gateway에 넘기고 붙인다. */
  readonly core: FakeCore;
  readonly settings: SettingsSource;
  readonly panels: SettingsPanels;
}

export function fakeSettingsScreen(
  options: FakeSettingsScreenOptions = {},
): FakeSettingsScreen {
  const core = fakeCore();
  const extensions = options.extensions ? fakeExtensions() : null;
  if (extensions !== null) {
    // Extensions 화면은 preload 통로를 window에서 읽는다. gallery는 창 하나에 frame 하나라 전역에 꽂아도 겹치지 않는다.
    (globalThis as { lophnExtensions?: unknown }).lophnExtensions =
      extensions.api;
  }
  const settings = fakeSettings({
    core,
    declared: [
      ...SAMPLE_DECLARED,
      ...(options.requiredEmpty
        ? [
            declared("agents.run.fallback_model", {
              type: "string",
              enum: ["sonnet", "opus"],
            }),
          ]
        : []),
      ...(extensions?.settings ?? []),
    ],
  }).source;
  // custom provider는 같은 id를 두 fake가 알아야 연결 뒤 목록 읽기가 그 provider를 찾는다.
  const panels: SettingsPanels = {
    providers: fakeProviders({
      core,
      preset: options.providers,
      customId: options.customList === undefined ? undefined : CUSTOM_PROVIDER,
    }).source,
    agents: fakeAgents({
      core,
      noDefaultModel: options.noDefaultModel,
      editor:
        options.customList === undefined
          ? undefined
          : {
              providers: "custom",
              customListed: false,
              refreshFails: options.customList === "empty",
            },
    }).source,
    diagnostics: fakeDiagnostics().source,
    shellRules: fakeShellRules({ core, value: SAMPLE_SHELL_RULES }).source,
    appearance: fakeAppearance({ core, values: options.appearance }).source,
    coding: fakeConnections({ core }).source,
    browser: fakeBrowserSettings({ core, ...options.browser }).source,
    keyboard: fakeKeyboard({ core, value: options.keyboard }).source,
    remote: fakeRemote().source,
  };
  return { core, settings, panels };
}
