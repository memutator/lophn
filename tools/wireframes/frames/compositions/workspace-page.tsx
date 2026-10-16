// Lophn Workspace 틀. 화면은 renderer의 실제 LophnSpace가 그린다. Projects, Apps, Settings 셋이고 source는
// 모두 dev-mock의 fake다. 사라진 폴더나 필수 설정이 빈 상태는 fake의 설정이고, 열린 dialog 같은 모양은 mount 뒤에
// 사람이 하듯이 눌러 만든다.
import { useMemo, useRef, useState } from "react";

import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createFakeWaiting } from "../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import { devMock } from "../../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import type { LophnScreen } from "../../../../packages/shell/renderer/desktop/lophn-space/model.ts";
import { LophnSpace } from "../../../../packages/shell/renderer/desktop/lophn-space/lophn-space.tsx";
import { fakeProjects } from "../../../../packages/shell/renderer/desktop/lophn-space/projects/testdata/fake-projects.ts";
import type { SettingsPane } from "../../../../packages/shell/renderer/desktop/lophn-space/settings/model.ts";
import { fakeSettings } from "../../../../packages/shell/renderer/desktop/lophn-space/settings/testdata/fake-settings.ts";
import { type Action, useWorkspaceDrive } from "./workspace/drive.ts";

type WorkspaceScreen = LophnScreen;
type WorkspacePane = SettingsPane;

interface WorkspaceProps {
  /** 처음에 보이는 화면. 기본은 Projects. */
  readonly screen?: WorkspaceScreen;
  /** Settings의 처음 항목. */
  readonly pane?: WorkspacePane;
  /** 이 경로의 등록 폴더가 사라진 fake로 그린다. */
  readonly missingFolder?: string;
  /** 필수 설정이 비어 있는 fake settings로 그린다. */
  readonly requiredEmpty?: boolean;
  /** mount 뒤에 차례로 하는 click. dialog는 portal로 열리니 global이면 document 전체에서 찾는다. */
  readonly steps?: readonly Action[];
  readonly global?: boolean;
}

const noop = () => {};

export function WorkspaceWithoutProject(
  {
    screen = "projects",
    pane = "general",
    missingFolder,
    requiredEmpty = false,
    steps = [],
    global = false,
  }: WorkspaceProps = {},
) {
  const mock = useMemo(() => devMock("?mock")!, []);
  const [client] = useState(() => createEventClient(createFakeWaiting([])));
  const projectsSource = useMemo(
    () => fakeProjects({ missingFolder }).source,
    [missingFolder],
  );
  // mock의 settings에는 필수 설정이 빈 항목이 하나 있어 General 위에 toast가 뜬다.
  const settings = useMemo(
    () => requiredEmpty ? mock.settings : fakeSettings().source,
    [mock, requiredEmpty],
  );
  const root = useRef<HTMLDivElement>(null);
  useWorkspaceDrive(root, steps, global);
  return (
    <div ref={root} style={{ display: "contents" }}>
      <EventsProvider client={client}>
        <LophnSpace
          source={mock.lophn}
          screen={screen}
          settingsPane={pane}
          windowWidth={1280}
          onLauncher={noop}
          projectsSource={projectsSource}
          apps={mock.apps}
          onApp={noop}
          settings={settings}
          settingsPanels={mock.settingsPanels}
          onInstructions={noop}
          onOpenSession={noop}
          onAnswerInTerminal={noop}
        />
      </EventsProvider>
    </div>
  );
}
