// Settings의 새 설계 page. 모두 인자 없이 한 상태를 그린다.

import { SettingsFrame } from "./settings-frame.tsx";
import { click, find, press, type, wait } from "../../mock/drive.ts";
import type { Bookmark } from "../../../../packages/shell/ipc/browser.ts";
import { appPanelBindingId } from "../../../../packages/shell/ipc/keybindings.ts";
import { APP_BUDGET } from "../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";

/** Settings 머리의 [Back]. 누르면 Settings를 열기 전 화면으로 돌아간다. */
export const SettingsBack = () => <SettingsFrame pane="agents" />;

/** Settings › General. */
export const SettingsGeneral = () => <SettingsFrame pane="general" />;

/** Settings › General: 필수 설정이 비어 그 기능만 시작하지 않는 상태. 알림은 탭 위쪽 toast다. */
export const SettingsRequiredEmpty = () => (
  <SettingsFrame pane="general" requiredEmpty />
);

/** Settings › Appearance. */
export const SettingsAppearance = () => <SettingsFrame pane="appearance" />;

// 처음 값과 다르게 고른 것. Cool(light)·Tokyo Night(dark) theme, Purple accent, System UI, 설치된 코드 글꼴(D2Coding Bold),
// Serif 본문, Large, Compact다.
const PRESETS = {
  light_theme: "cool-light",
  dark_theme: "tokyo-night",
  accent: "#6b3fc4",
  font: "system",
  code_font: "custom",
  code_font_custom: "D2Coding",
  code_font_weight: "700",
  reading_font: "serif",
  text_size: "large",
  density: "compact",
} as const;

/** Settings › Appearance: preset을 바꾼 상태(Light). 화면 전체가 고른 색·글꼴·크기로 바뀐다. */
export const SettingsAppearancePresets = () => (
  <SettingsFrame pane="appearance" appearance={{ ...PRESETS, mode: "light" }} />
);

/** Settings › Appearance: preset을 바꾼 상태(Dark). */
export const SettingsAppearancePresetsDark = () => (
  <SettingsFrame pane="appearance" appearance={{ ...PRESETS, mode: "dark" }} />
);

/**
 * Settings › Appearance: light theme으로 theme file(Pastel)을 고른 상태. 그 file의 문제(모르는 색 이름, 대비가 모자란
 * 글자)가 줄 아래에 보이고, 읽을 수 없는 file(draft.json)은 Themes folder 줄 아래에 이유와 함께 보인다.
 */
export const SettingsAppearanceThemeFile = () => (
  <SettingsFrame
    pane="appearance"
    appearance={{ mode: "light", light_theme: "pastel" }}
  />
);

/** Settings › Appearance: UI 글꼴 칸을 열고 검색 칸에 "no"를 쳐 설치된 글꼴을 거른 상태. */
export const SettingsAppearanceFontSearch = () => (
  <SettingsFrame
    pane="appearance"
    appearance={{}}
    steps={[
      () => click('[data-appearance-row="font"] button[aria-haspopup]'),
      () => type('input[type="search"]', "no"),
    ]}
  />
);

/** Settings › Appearance: 저장된 코드 글꼴이 이 컴퓨터에 없어 그 이름에 Not installed가 붙은 상태. */
export const SettingsAppearanceFontMissing = () => (
  <SettingsFrame
    pane="appearance"
    appearance={{ code_font: "custom", code_font_custom: "Berkeley Mono" }}
    steps={[
      () => click('[data-appearance-row="code_font"] button[aria-haspopup]'),
    ]}
  />
);

/** Settings › Coding agents. */
export const SettingsCoding = () => <SettingsFrame pane="coding" />;

/** Settings › Shell rules. */
export const SettingsShellRules = () => <SettingsFrame pane="shell-rules" />;

/** Settings › Shell rules: Global 절의 더하기 줄에 pattern을 치고 Ask를 고른 상태. */
export const SettingsShellRulesAdd = () => (
  <SettingsFrame
    pane="shell-rules"
    steps={[
      () =>
        type('[data-layer="global"] [data-add-rule] input', "npm publish *"),
      () =>
        press('[data-layer="global"] [data-add-rule] button[role="combobox"]'),
      () => click('[role="option"]', "Ask"),
    ]}
  />
);

/** Settings › Diagnostics. */
export const SettingsDiagnostics = () => <SettingsFrame pane="diagnostics" />;

const icon = (fill: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='3' fill='%23${fill}'/%3E%3C/svg%3E`;
const mark = (
  n: number,
  title: string,
  url: string,
  favicon?: string,
): Bookmark => ({
  id: `bookmark-${n}`,
  title,
  url,
  created_at: "2026-10-19T00:00:00.000Z",
  ...(favicon === undefined ? {} : { favicon }),
});
// 셋째는 favicon이 없어 Globe로 보인다.
const BOOKMARKS: Bookmark[] = [
  mark(1, "Deno", "https://deno.com/", icon("1f2937")),
  mark(2, "MDN Web Docs", "https://developer.mozilla.org/", icon("2563eb")),
  mark(3, "Grocery dev server", "http://localhost:5173/"),
];

/** Settings › Browser: Bookmarks, Links, Devices(등록한 기기가 없다)와 Browsing data([Clear browsing data]). */
export const SettingsBrowser = () => (
  <SettingsFrame pane="browser" browser={{ bookmarks: BOOKMARKS }} />
);

/** Settings › Browser: Devices 구역에 기기 둘이 등록되어 있다. 줄마다 크기·DPR·OS와 [Edit], [Remove]가 있다. */
export const SettingsBrowserDevices = () => (
  <SettingsFrame
    pane="browser"
    browser={{
      bookmarks: BOOKMARKS,
      devices: [
        { name: "iPhone 15", width: 390, height: 844, dpr: 3, os: "ios" },
        { name: "Pixel 8", width: 412, height: 915, dpr: 2.6, os: "android" },
      ],
    }}
  />
);

/** Settings › Browser: [Add device]를 눌러 기기 입력 칸이 열린 상태. 처음 값은 iPhone 크기다. */
export const SettingsBrowserDeviceAdd = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS }}
    steps={[() => click("[data-device-add]")]}
  />
);

const LOGINS = [
  {
    id: "lgn_fake0",
    label: "GitHub",
    origin: "https://github.com",
    username: "dev@example.com",
    note: "",
    password: true,
    totp: true,
  },
  {
    id: "lgn_fake1",
    label: "Staging admin",
    origin: "http://localhost:3000",
    username: "admin",
    note: "",
    password: false,
    totp: false,
  },
];

/** Settings › Browser: Logins 구역에 login 둘이 있다. 줄마다 password·TOTP 유무와 [Set password], [Set TOTP], [Edit], [Delete]가 있다. */
export const SettingsBrowserLogins = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS, logins: LOGINS }}
  />
);

/** Settings › Browser: [Add login]을 눌러 입력 칸(Label, Site, Username, Note)이 열린 상태. */
export const SettingsBrowserLoginAdd = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS, logins: LOGINS }}
    steps={[() => click("[data-login-add]")]}
  />
);

/** Settings › Keyboard. 바꾼 키가 없다. section(Tabs, Splits, ...)마다 제목 아래 줄이 서고 키 없는 줄은 흐린 Not set이다. */
export const SettingsKeyboard = () => <SettingsFrame pane="keyboard" />;

/** Settings › Keyboard: 탭 닫기를 바꾸고 sidebar 키를 뺀 뒤, Open a file에 이미 쓰는 키를 눌러 [Replace]·[Cancel]을 묻는 상태. */
export const SettingsKeyboardChanged = () => (
  <SettingsFrame
    pane="keyboard"
    keyboard={{
      other: { "tab.close": ["Ctrl+Alt+KeyQ"], "sidebar.toggle": [] },
      mac: { "tab.close": ["Cmd+Alt+KeyQ"], "sidebar.toggle": [] },
    }}
    steps={[
      () => click('[data-key-change="files.quick-open"]'),
      async () => {
        const field = await find("[data-key-capture]");
        field.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            code: "Tab",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        // 새 키 칸은 둘째 타를 1.5초 기다린다. 둘째 타가 없는 경우를 기다려 저장 뒤 상태를 그린다.
        await wait(1700);
      },
    ]}
  />
);

/** Settings › Keyboard: 겹친 키가 있는 저장 값. 위에 겹침 수와 [Show conflicts only]가 서고, 겹친 줄에 상대 이름과 [Remove]가 있다. 겹친 것만 보는 상태다. */
export const SettingsKeyboardConflicts = () => (
  <SettingsFrame
    pane="keyboard"
    keyboard={{
      // Rename the tab이 Next tab과 같은 키를, Reveal이 OS 전역 팔레트가 먼저 쓰는 Ctrl+Shift+K를 단 상태다.
      other: {
        "tab.rename": ["Ctrl+Tab"],
        "tab.reveal": ["Ctrl+Shift+KeyK"],
      },
      mac: {
        "tab.rename": ["Ctrl+Tab"],
        "tab.reveal": ["Cmd+Shift+KeyK"],
      },
    }}
    steps={[() => click("[data-key-conflicts-only]")]}
  />
);

/** Settings › Keyboard: 앱 단축키가 달린 저장 값. 앱 panel 화면마다 한 줄이고, 지워진 앱의 키는 "app not found" 줄로 남아 [Remove]만 된다. */
export const SettingsKeyboardApps = () => (
  <SettingsFrame
    pane="keyboard"
    keyboard={{
      other: {
        [appPanelBindingId(APP_BUDGET, "home")]: ["Ctrl+Alt+KeyG"],
        [appPanelBindingId("app_gone", "main")]: ["Ctrl+Alt+KeyH"],
      },
      mac: {
        [appPanelBindingId(APP_BUDGET, "home")]: ["Cmd+Alt+KeyG"],
        [appPanelBindingId("app_gone", "main")]: ["Cmd+Alt+KeyH"],
      },
    }}
    steps={[
      async () =>
        (await find('[data-key-section="app"]')).scrollIntoView({
          block: "start",
        }),
    ]}
  />
);

/** Settings › Browser: Links 구역. web과 local link 둘 다 Browser tab으로 연다. */
export const SettingsBrowserLinks = () => (
  <SettingsFrame pane="browser" browser={{ bookmarks: BOOKMARKS }} />
);

/** Settings › Browser: web link는 System browser, local link는 Browser tab으로 여는 설정. */
export const SettingsBrowserLinksSystem = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS, links: { web_links: "system_browser" } }}
  />
);

/** Settings › Browser: [Clear browsing data]를 눌러 확인 dialog가 열린 상태. */
export const SettingsBrowserClearData = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS }}
    steps={[() => click("[data-browser-clear]")]}
  />
);

/** Settings › Browser: bookmark 목록. 한 줄은 [Edit]을 눌러 title·URL 입력으로 바뀌었다. */
export const SettingsBrowserBookmarks = () => (
  <SettingsFrame
    pane="browser"
    browser={{ bookmarks: BOOKMARKS }}
    steps={[() => click("[data-bookmark-edit]", undefined, 1)]}
  />
);

/** Settings › Browser: bookmarks.json이 깨져 목록 자리에 오류 문장만 있다. 고치는 길은 열지 않는다. */
export const SettingsBrowserBookmarksCorrupt = () => (
  <SettingsFrame pane="browser" browser={{ corrupt: true }} />
);

/** Settings › Extensions: 켜짐(Harness GUI, [Turn off]), 설치했지만 꺼짐(Harness agents, [Turn on]), 설치 안 됨(Demo, [Install]) 세 줄. */
export const SettingsExtensions = () => (
  <SettingsFrame pane="extension-packages" extensions />
);

/** Settings › Extensions: 꺼진 extension의 [Remove]를 눌러 확인 dialog가 열린 상태. 켜져 있으면 먼저 끄라는 글만 보이고 dialog는 열리지 않는다. */
export const SettingsExtensionRemove = () => (
  <SettingsFrame
    pane="extension-packages"
    extensions
    steps={[
      () => click('[data-extension-id="harness"] [data-action="remove"]'),
    ]}
  />
);
