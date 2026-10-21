// Settings의 새 설계 page. 모두 인자 없이 한 상태를 그린다.

import { SettingsFrame } from "./settings-frame.tsx";
import { click, press, type } from "../../mock/drive.ts";
import type { Bookmark } from "../../../../packages/shell/ipc/browser.ts";

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

// 처음 값과 다르게 고른 preset. Purple, Cool, System UI, 설치된 코드 글꼴 이름, Large, Compact다.
const PRESETS = {
  accent: "purple",
  background: "cool",
  font: "system",
  code_font: "custom",
  code_font_custom: "Fira Code",
  text_size: "large",
  density: "compact",
} as const;

/** Settings › Appearance: preset을 바꾼 상태(Light). 화면 전체가 고른 색·글꼴·크기로 바뀐다. */
export const SettingsAppearancePresets = () => (
  <SettingsFrame
    pane="appearance"
    appearance={{ ...PRESETS, theme: "light" }}
  />
);

/** Settings › Appearance: preset을 바꾼 상태(Dark). */
export const SettingsAppearancePresetsDark = () => (
  <SettingsFrame pane="appearance" appearance={{ ...PRESETS, theme: "dark" }} />
);

/** Settings › Coding agents. */
export const SettingsCoding = () => <SettingsFrame pane="coding" />;

/** Settings › Shell rules. */
export const SettingsShellRules = () => <SettingsFrame pane="shell-rules" />;

/** Settings › Shell rules: Workspace 절의 더하기 줄에 pattern을 치고 Ask를 고른 상태. */
export const SettingsShellRulesAdd = () => (
  <SettingsFrame
    pane="shell-rules"
    steps={[
      () =>
        type(
          '[data-layer="global"] [data-add-rule] input',
          "npm publish *",
        ),
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

/** Settings › Browser: Bookmarks와 Browsing data([Clear browsing data]). */
export const SettingsBrowser = () => (
  <SettingsFrame pane="browser" browser={{ bookmarks: BOOKMARKS }} />
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
