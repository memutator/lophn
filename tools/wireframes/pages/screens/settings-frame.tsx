// Settings 틀. 화면은 renderer의 실제 SettingsSpace가 그린다. source는 모두 dev-mock의 fake다. 필수 설정이 빈
// 상태는 fake의 설정이고, 열린 dialog 같은 모양은 mount 뒤에 사람이 하듯이 눌러 만든다.
import { useMemo, useState } from "react";

import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createFakeWaiting } from "../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import { devMock } from "../../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import { SettingsSpace } from "../../../../packages/shell/renderer/desktop/settings/settings-space.tsx";
import type { SettingsPane } from "../../../../packages/shell/renderer/desktop/settings/model.ts";
import { fakeAppearance } from "../../../../packages/shell/renderer/desktop/settings/appearance/testdata/fake-source.ts";
import type { AppearanceValues } from "../../../../packages/shell/renderer/desktop/settings/appearance/source.ts";
import { fakeAgents } from "../../../../packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts";
import { fakeProviders } from "../../../../packages/shell/renderer/desktop/settings/providers/testdata/fake-providers.ts";
import { fakeSettings } from "../../../../packages/shell/renderer/desktop/settings/testdata/fake-settings.ts";
import {
  fakeJobs,
  type FakeJobsOptions,
} from "../../../../packages/shell/renderer/desktop/settings/jobs/testdata/fake-source.ts";
import { fakeBrowserSettings } from "../../../../packages/shell/renderer/desktop/settings/browser/testdata/fake-source.ts";
import type { Bookmark } from "../../../../packages/shell/ipc/browser.ts";
import type { LinkValues } from "../../../../packages/shell/renderer/desktop/settings/browser/source.ts";
import { fakeKeyboard } from "../../../../packages/shell/renderer/desktop/settings/keyboard/testdata/fake-source.ts";
import type { StoredKeybindings } from "../../../../packages/shell/renderer/desktop/settings/keyboard/source.ts";
import { CUSTOM_PROVIDER } from "../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { GalleryConnectHost } from "../../mock/connect-host.tsx";
import { runSteps, type Step, useDrive } from "../../mock/drive.ts";

interface SettingsFrameProps {
  /** 처음에 보이는 항목. */
  readonly pane?: SettingsPane;
  /** 필수 설정이 비어 있는 fake settings로 그린다. */
  readonly requiredEmpty?: boolean;
  /** Appearance 줄의 처음 값. 안 쓴 줄은 기본이다. */
  readonly appearance?: Partial<AppearanceValues>;
  /** 연결된 provider. none은 하나도 없고 some은 Anthropic만 있다. 안 쓰면 셋이 연결된 모양이다. */
  readonly providers?: "none" | "some";
  /** 전역 기본 model을 아직 고르지 않았다. */
  readonly noDefaultModel?: boolean;
  /** Browser 항목의 bookmark 파일. 안 쓰면 dev mock 것이고, corrupt는 파일이 깨진 상태다. */
  readonly browser?: {
    readonly bookmarks?: Bookmark[];
    readonly corrupt?: boolean;
    /** Links 줄의 처음 값. 안 쓴 줄은 Browser tab이다. */
    readonly links?: Partial<LinkValues>;
  };
  /** Scheduled jobs 항목의 job. 안 쓰면 dev mock의 대표 job이다. */
  readonly jobs?: Partial<FakeJobsOptions>;
  /** Keyboard 항목의 저장된 키. 안 쓰면 바꾼 키가 없다. */
  readonly keyboard?: StoredKeybindings;
  /** custom provider를 붙일 수 있게 한다. found는 연결 뒤 목록을 찾고, empty는 /models가 없어 목록이 비어 있다. */
  readonly customList?: "found" | "empty";
  /** mount 뒤에 차례로 하는 동작. */
  readonly steps?: readonly Step[];
}

const noop = () => {};

export function SettingsFrame({
  pane = "general",
  requiredEmpty = false,
  appearance,
  providers,
  noDefaultModel = false,
  browser,
  jobs,
  customList,
  keyboard,
  steps = [],
}: SettingsFrameProps = {}) {
  const mock = useMemo(() => devMock("?mock")!, []);
  const [client] = useState(() => createEventClient(createFakeWaiting([])));
  // mock의 settings에는 필수 설정이 빈 항목이 하나 있어 General 위에 toast가 뜬다.
  const settings = useMemo(
    () => (requiredEmpty ? mock.settings : fakeSettings().source),
    [mock, requiredEmpty],
  );
  // host가 Settings 화면과 같은 provider·기본 model source를 읽어야 연결 뒤에 새 provider를 찾는다.
  const panels = useMemo(
    () => ({
      ...mock.settingsPanels,
      ...(appearance === undefined
        ? {}
        : { appearance: fakeAppearance({ values: appearance }).source }),
      ...(providers === undefined
        ? {}
        : { providers: fakeProviders({ preset: providers }).source }),
      ...(noDefaultModel
        ? { agents: fakeAgents({ noDefaultModel }).source }
        : {}),
      ...(browser === undefined
        ? {}
        : { browser: fakeBrowserSettings(browser).source }),
      ...(jobs === undefined ? {} : { jobs: fakeJobs(jobs).source }),
      ...(keyboard === undefined
        ? {}
        : { keyboard: fakeKeyboard({ value: keyboard }).source }),
      // 같은 id의 custom provider를 두 fake가 알아야 연결 뒤 목록 읽기가 그 provider를 찾는다.
      ...(customList === undefined
        ? {}
        : {
            providers: fakeProviders({
              preset: providers,
              customId: CUSTOM_PROVIDER,
            }).source,
            agents: fakeAgents({
              editor: {
                providers: "custom",
                customListed: false,
                refreshFails: customList === "empty",
              },
            }).source,
          }),
    }),
    [
      mock,
      appearance,
      providers,
      noDefaultModel,
      browser,
      jobs,
      customList,
      keyboard,
    ],
  );
  useDrive(() => runSteps(steps));
  return (
    <EventsProvider client={client}>
      <GalleryConnectHost providers={panels.providers} agents={panels.agents}>
        <SettingsSpace
          source={mock.catalog}
          settingsPane={pane}
          onHome={noop}
          onBack={noop}
          backTo={null}
          onApp={noop}
          settings={settings}
          settingsPanels={panels}
          onProject={noop}
          onOpenSession={noop}
        />
      </GalleryConnectHost>
    </EventsProvider>
  );
}
