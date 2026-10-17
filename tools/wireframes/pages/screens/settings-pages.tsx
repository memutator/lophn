// Settings의 새 설계 page. 모두 인자 없이 한 상태를 그린다.

import { SettingsFrame } from "./settings-frame.tsx";

/** Settings › General. */
export const SettingsGeneral = () => <SettingsFrame pane="general" />;

/** Settings › General: 필수 설정이 비어 그 기능만 시작하지 않는 상태. 알림은 탭 위쪽 toast다. */
export const SettingsRequiredEmpty = () => (
  <SettingsFrame pane="general" requiredEmpty />
);

/** Settings › Appearance. */
export const SettingsAppearance = () => <SettingsFrame pane="appearance" />;

/** Settings › Coding agents. */
export const SettingsCoding = () => <SettingsFrame pane="coding" />;

/** Settings › Reactions. */
export const SettingsReactions = () => <SettingsFrame pane="reactions" />;

/** Settings › Diagnostics. */
export const SettingsDiagnostics = () => <SettingsFrame pane="diagnostics" />;
