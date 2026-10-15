// Settings › Coding agents. 옮긴 renderer Coding agents panel을 fake 통로로 그린다. 제품마다 감지 결과와
// 맡길 수 있는지를 보이고 기본 실행 옵션을 정한다.
import { useMemo } from "react";

import { SettingsScreen } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/settings-screen.tsx";
import { fakeConnections } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/connections/testdata/fake-source.ts";
import { fakeSettings } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/testdata/fake-settings.ts";

export function CodingPane() {
  const sources = useMemo(
    () => ({
      source: fakeSettings().source,
      coding: fakeConnections().source,
    }),
    [],
  );
  return <SettingsScreen pane="coding" onPane={() => {}} {...sources} />;
}
