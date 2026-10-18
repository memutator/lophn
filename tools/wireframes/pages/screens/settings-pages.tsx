// Settings의 새 설계 page. 모두 인자 없이 한 상태를 그린다.

import { SettingsFrame } from "./settings-frame.tsx";

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

/** Settings › Reactions. */
export const SettingsReactions = () => <SettingsFrame pane="reactions" />;

/** Settings › Diagnostics. */
export const SettingsDiagnostics = () => <SettingsFrame pane="diagnostics" />;
