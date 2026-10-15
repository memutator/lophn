// Settings › General. 옮긴 renderer General panel을 fake 선언 설정으로 그린다. 설정 항목을 타입(불리언, 숫자
// 범위, 선택지, 목록)대로 보고 바꾸고, 사람이 정한 값만 저장하며 기본값과 나눠 보인다.
import { useMemo } from "react";

import { SettingsScreen } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/settings-screen.tsx";
import { fakeSettings } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/testdata/fake-settings.ts";

export function GeneralPane() {
  const source = useMemo(() => fakeSettings().source, []);
  return <SettingsScreen pane="general" onPane={() => {}} source={source} />;
}
