// 런처. 화면은 renderer의 Launcher가 그리고 여기서는 fake source와 fake Gateway에 이어 준다. project 카드는 이름,
// 목적, 폴더 수나 "Folder not found"와 [Choose new location]이고 ⋯ 메뉴에 Details와 Archive가 있다. 보관한 project와
// 앱은 아래 접힌 Archived 묶음에서 되살린다. 등록 dialog는 이름, 목적, 폴더와 폴더 설명이다. 오른쪽 위 단추는 Settings다.
import { useMemo, useState } from "react";

import { Launcher } from "../../../../../packages/shell/renderer/desktop/launcher/launcher.tsx";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createFakeWaiting } from "../../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import { mockAgentTabSource } from "../../../../../packages/shell/renderer/desktop/dev-mock/agent.ts";
import { mockCore } from "../../../../../packages/shell/renderer/desktop/dev-mock/requests.ts";
import {
  fakeApps,
  galleryApps,
} from "../../../../../packages/shell/renderer/apps/testdata/fake-apps.ts";
import {
  fakeProjects,
  MISSING_FOLDER,
} from "../../../../../packages/shell/renderer/desktop/launcher/projects/testdata/fake-projects.ts";
import {
  click,
  press,
  runSteps,
  type Step,
  type,
  useDrive,
} from "../../../mock/drive.ts";
import { registerSteps } from "../../../mock/launcher/register-panel.tsx";

const noop = () => {};

function Page(
  { empty = false, steps = [] }: {
    empty?: boolean;
    steps?: readonly Step[];
  },
) {
  const core = useMemo(() => mockCore(), []);
  const [client] = useState(() => createEventClient(createFakeWaiting([])));
  const projects = useMemo(
    () =>
      fakeProjects(
        empty ? { projects: [] } : {
          missingFolder: MISSING_FOLDER,
          picked: "/home/mina/trips/autumn",
        },
      ).source,
    [empty],
  );
  const agentViewSource = useMemo(() => mockAgentTabSource(), []);
  const apps = useMemo(
    () => empty ? fakeApps().source : galleryApps().source,
    [empty],
  );
  useDrive(() => runSteps(steps));
  return (
    <>
      <EventsProvider client={client}>
        <Launcher
          source={core}
          platform="linux"
          projects={projects}
          apps={apps}
          agentViewSource={agentViewSource}
          onSettings={noop}
        />
      </EventsProvider>
    </>
  );
}

/** 카드가 있는 런처. phroner의 폴더 하나가 사라졌다. */
export const LauncherProjects = () => <Page />;

/** 프로젝트도 앱도 없는 런처. 두 section이 각자 비었음 안내와 행동 하나(Register project, New app)를 보인다. */
export const LauncherEmpty = () => <Page empty />;

/** 오른쪽 아래 Ask lophn 단추를 눌러 대화 패널을 연 런처. 안은 탭과 같은 Agent 화면이다. */
export const LauncherLophn = () => (
  <Page steps={[() => click('[data-entry="lophn"]')]} />
);

/** 등록 dialog를 연 런처. */
export const LauncherRegister = () => (
  <Page
    steps={[() => click("[data-register-project]"), ...registerSteps()]}
  />
);

/** New app dialog: 이름과 한 줄 목적. */
export const LauncherNewApp = () => (
  <Page
    steps={[
      () => click("[data-new-app]"),
      () => type("[data-new-app-form] [data-field='name']", "Reading list"),
      () =>
        type(
          "[data-new-app-form] [data-field='purpose']",
          "Books I want to read and what I thought of them",
        ),
    ]}
  />
);

const OPEN_MENU: Step = () => press('[data-card="project"] [data-card-menu]');

/** project 카드의 ⋯ 메뉴: Details와 Archive. */
export const LauncherCardMenu = () => <Page steps={[OPEN_MENU]} />;

/** 아래 접힌 Archived 묶음을 펼친 상태. project와 앱이 한 줄씩이고 [Unarchive]가 있다. */
export const LauncherArchived = () => (
  <Page steps={[() => click('[data-section="archived"] summary')]} />
);

const OPEN_DETAIL: readonly Step[] = [
  OPEN_MENU,
  () => press('[data-menu-item="details"]'),
];

/** [Details] dialog. 이름, 목적, 폴더와 설명, 하위 폴더를 고친다. 사라진 폴더 줄에 [Choose new location]이 있다. */
export const LauncherProjectDetail = () => <Page steps={OPEN_DETAIL} />;

/** [Details]에서 하위 폴더를 더하는 dialog. 고르기는 등록 폴더 안으로만 열린다. */
export const LauncherSubfolderAdd = () => (
  <Page
    steps={[
      ...OPEN_DETAIL,
      () => click("[data-add-subfolder]"),
      () => click('[data-expand="src"]'),
      () => click('[data-pick="src/tools"]'),
      () =>
        type("[data-subfolder-new-description]", "Small command-line helpers"),
    ]}
  />
);

/** [Details]에서 하위 폴더의 설명을 고쳤고 하나를 뺀 상태. 빼도 폴더 자체는 그대로이고 [Undo]가 있다. */
export const LauncherSubfolderEdit = () => (
  <Page
    steps={[
      ...OPEN_DETAIL,
      () =>
        type(
          "[data-subfolder-description]",
          "Experiment runs, results and score tables",
        ),
      () => click("[data-remove-subfolder]", undefined, -1),
    ]}
  />
);
