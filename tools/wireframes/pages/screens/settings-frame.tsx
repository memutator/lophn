// Settings 틀. 화면은 renderer의 실제 SettingsSpace가 그린다. source는 모두 dev-mock의 fake다. 필수 설정이 빈
// 상태는 fake의 설정이고, 열린 dialog 같은 모양은 mount 뒤에 사람이 하듯이 눌러 만든다.
import { useMemo, useState } from "react";

import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createFakeWaiting } from "../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import { devMock } from "../../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import { SettingsSpace } from "../../../../packages/shell/renderer/desktop/settings/settings-space.tsx";
import type { SettingsPane } from "../../../../packages/shell/renderer/desktop/settings/model.ts";
import { fakeSettings } from "../../../../packages/shell/renderer/desktop/settings/testdata/fake-settings.ts";
import { runSteps, type Step, useDrive } from "../../mock/drive.ts";

interface SettingsFrameProps {
  /** 처음에 보이는 항목. */
  readonly pane?: SettingsPane;
  /** 필수 설정이 비어 있는 fake settings로 그린다. */
  readonly requiredEmpty?: boolean;
  /** mount 뒤에 차례로 하는 동작. */
  readonly steps?: readonly Step[];
}

const noop = () => {};

export function SettingsFrame(
  { pane = "general", requiredEmpty = false, steps = [] }: SettingsFrameProps =
    {},
) {
  const mock = useMemo(() => devMock("?mock")!, []);
  const [client] = useState(() => createEventClient(createFakeWaiting([])));
  // mock의 settings에는 필수 설정이 빈 항목이 하나 있어 General 위에 toast가 뜬다.
  const settings = useMemo(
    () => requiredEmpty ? mock.settings : fakeSettings().source,
    [mock, requiredEmpty],
  );
  useDrive(() => runSteps(steps));
  return (
    <EventsProvider client={client}>
      <SettingsSpace
        source={mock.catalog}
        settingsPane={pane}
        windowWidth={1280}
        onLauncher={noop}
        onApp={noop}
        settings={settings}
        settingsPanels={mock.settingsPanels}
        onInstructions={noop}
        onOpenSession={noop}
        onAnswerInTerminal={noop}
      />
    </EventsProvider>
  );
}
