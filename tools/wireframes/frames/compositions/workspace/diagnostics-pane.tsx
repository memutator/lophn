// Settings › Diagnostics. 옮긴 renderer Diagnostics panel을 fake 통로로 그린다. 점검은 [Run checks]를 누를 때만
// 하므로, 결과가 보이는 상태는 mount 뒤에 한 번 눌러 만든다.
import { useEffect, useMemo, useRef } from "react";

import { SettingsScreen } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/settings-screen.tsx";
import { fakeDiagnostics } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/diagnostics/testdata/fake-source.ts";
import { fakeSettings } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/testdata/fake-settings.ts";

export function DiagnosticsPane() {
  const sources = useMemo(
    () => ({
      source: fakeSettings().source,
      diagnostics: fakeDiagnostics().source,
    }),
    [],
  );
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    frame.current?.querySelector<HTMLElement>('[data-action="check"]')
      ?.click();
  }, []);
  return (
    <div ref={frame}>
      <SettingsScreen pane="diagnostics" onPane={() => {}} {...sources} />
    </div>
  );
}
