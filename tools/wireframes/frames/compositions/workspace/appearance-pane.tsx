// Settings › Appearance. 옮긴 renderer Appearance panel을 fake 통로로 그린다. Theme은 고르면 바로 바뀐다.
import { useMemo } from "react";

import { SettingsScreen } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/settings-screen.tsx";
import { fakeAppearance } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/appearance/testdata/fake-source.ts";
import { fakeSettings } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/testdata/fake-settings.ts";

export function AppearancePane() {
  const sources = useMemo(
    () => ({
      source: fakeSettings().source,
      appearance: fakeAppearance().source,
    }),
    [],
  );
  return <SettingsScreen pane="appearance" onPane={() => {}} {...sources} />;
}
