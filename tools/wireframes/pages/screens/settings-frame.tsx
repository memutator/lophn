// Settings 틀. 화면은 renderer의 실제 SettingsSpace가 그린다. 화면이 읽는 route는 가짜 core(core-answers)가 답하고
// 통로는 그 core를 나눠 쓰는 fake다. 필수 설정이 빈 상태는 fake의 설정이고, 열린 dialog 같은 모양은 mount 뒤에 사람이
// 하듯이 눌러 만든다.
import type { BrowserProfile } from "../../../../packages/protocol/secrets/browser-vault.ts";
import { type ReactNode, useMemo, useState } from "react";
import type { Bookmark } from "../../../../packages/shell/ipc/browser.ts";
import { AppViewsProvider } from "../../../../packages/shell/renderer/app-frame/app-views.tsx";
import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { devMock } from "../../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import type { AppearanceValues } from "../../../../packages/shell/renderer/desktop/settings/appearance/source.ts";
import type {
  Device,
  LinkValues,
  LoginRow,
} from "../../../../packages/shell/renderer/desktop/settings/browser/source.ts";
import type { StoredKeybindings } from "../../../../packages/shell/renderer/desktop/settings/keyboard/source.ts";
import type { SettingsPane } from "../../../../packages/shell/renderer/desktop/settings/model.ts";
import { MachinesProvider } from "../../../../packages/shell/renderer/desktop/machines/context.tsx";
import {
  type FakeMachinesOptions,
  fakeMachines,
} from "../../../../packages/shell/renderer/desktop/machines/testdata/fake-source.ts";
import type {
  AlwaysOnView,
  JoinOutcome,
  RemoteDevice,
} from "../../../../packages/shell/renderer/desktop/settings/remote/source.ts";
import { fakeRemote } from "../../../../packages/shell/renderer/desktop/settings/remote/testdata/fake-source.ts";
import {
  type FakeSyncOptions,
  fakeSync,
} from "../../../../packages/shell/renderer/desktop/settings/sync/testdata/fake-source.ts";
import { SettingsSpace } from "../../../../packages/shell/renderer/desktop/settings/settings-space.tsx";
import { GalleryConnectHost } from "../../mock/connect-host.tsx";
import { settingsCore } from "../../mock/core-answers/sync-settings.ts";
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
    /** Devices 구역의 등록한 기기. 안 쓰면 비어 있다. */
    readonly devices?: Device[];
    /** Logins 구역의 login. 안 쓰면 비어 있다. */
    readonly logins?: LoginRow[];
    /** Profiles 구역의 browser profile. 안 쓰면 Default뿐이다. */
    readonly profiles?: BrowserProfile[];
    /** profile을 쓰는 agent. 있으면 `agents/list`가 이 목록으로 답한다. */
    readonly agents?: { id: string; name: string; profile: string | null }[];
  };
  /** My computers 항목. 안 쓰면 켜져 있고 명단에 이 컴퓨터, 컴퓨터 둘, 폰 둘이 있다. */
  readonly remote?: {
    readonly enabled?: boolean;
    readonly hub?: boolean;
    readonly devices?: RemoteDevice[];
    /** [Join with an invite]의 결과. 안 쓰면 초대한 컴퓨터에 닿아 끝난다. */
    readonly join?: JoinOutcome;
    /** 다른 컴퓨터가 이 컴퓨터를 뺀 때(ISO). */
    readonly removedAt?: string;
    /** "Keep running"의 처음 상태에서 바꿀 칸. 안 쓰면 설치본에서 두 스위치가 꺼져 있다. */
    readonly alwaysOn?: Partial<AlwaysOnView>;
  };
  /** Sync 항목. 안 쓰면 같이 보는 폴더 하나와 이름 붙인 폴더 둘, 앱 셋이 있다. */
  readonly sync?: FakeSyncOptions;
  /** 기계 보기(My devices의 컴퓨터 상태). 안 쓰면 없다. */
  readonly machines?: FakeMachinesOptions;
  /** Keyboard 항목의 저장된 키. 안 쓰면 바꾼 키가 없다. */
  readonly keyboard?: StoredKeybindings;
  /** Extensions 항목에 가짜 `extensions/*` 답과 `extensions.<id>.enabled` 선언을 끼운다. */
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
  customList,
  keyboard,
  remote,
  sync,
  machines,
  steps = [],
}: SettingsFrameProps = {}) {
  const mock = useMemo(() => devMock("?mock")!, []);
  // frame 하나에 가짜 core 하나. 항목의 통로와 event client가 같은 core를 본다.
  const [wiring] = useState(() => {
    const made = settingsCore({
      requiredEmpty,
      appearance,
      providers,
      noDefaultModel,
      browser,
      keyboard,
      customList,
    });
    return {
      ...made,
      panels: {
        ...made.panels,
        remote: fakeRemote(remote).source,
        sync: fakeSync(sync).source,
      },
      client: createEventClient(made.source),
    };
  });
  const { client, settings, panels } = wiring;
  const [machineSource] = useState(() =>
    machines === undefined ? null : fakeMachines(machines).source,
  );
  useDrive(() => runSteps(steps));
  return (
    <MaybeMachines source={machineSource}>
      <EventsProvider client={client}>
        <GalleryConnectHost providers={panels.providers} agents={panels.agents}>
          {/* Keyboard와 Quick launch가 앱 panel 화면 목록을 읽는다. */}
          <AppViewsProvider value={mock.appViews}>
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
          </AppViewsProvider>
        </GalleryConnectHost>
      </EventsProvider>
    </MaybeMachines>
  );
}

function MaybeMachines({
  source,
  children,
}: {
  source: ReturnType<typeof fakeMachines>["source"] | null;
  children: ReactNode;
}) {
  return source === null ? (
    children
  ) : (
    <MachinesProvider source={source}>{children}</MachinesProvider>
  );
}
