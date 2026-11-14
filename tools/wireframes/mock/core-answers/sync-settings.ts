// Settings 화면들이 useCoreRead로 읽는 route의 gallery 답. 항목마다의 가짜 통로가 가짜 core 하나를 나눠 쓰고,
// `source`를 EventsProvider의 event client로 쓰면 쓰기가 같은 답을 바꾸고 StateChanged로 화면을 다시 읽게 한다.
import {
  createFakeSource,
  type FakeSource,
} from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import type { SettingsPanels } from "../../../../packages/shell/renderer/desktop/settings/settings-screen.tsx";
import type { SettingsSource } from "../../../../packages/shell/renderer/desktop/settings/source.ts";
import {
  fakeSettingsScreen,
  type FakeSettingsScreenOptions,
} from "../../../../packages/shell/renderer/desktop/settings/testdata/fake-screen.ts";

export type SettingsCoreOptions = FakeSettingsScreenOptions;

export interface SettingsCore {
  /** EventsProvider의 event client로 쓸 fake Gateway. Settings 화면이 읽는 route에 답한다. */
  readonly source: FakeSource;
  readonly settings: SettingsSource;
  readonly panels: SettingsPanels;
}

export function settingsCore(options: SettingsCoreOptions = {}): SettingsCore {
  const { core, settings, panels } = fakeSettingsScreen(options);
  const source = createFakeSource({
    snapshots: [],
    consents: [],
    answers: core.answers,
  });
  core.attach(source);
  return { source, settings, panels };
}
