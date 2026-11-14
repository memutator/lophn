// Home의 오른쪽 sidebar Workspaces panel을 shell 틀 안에 놓는다. Home workspace 연결은 app 화면 task가 하므로 여기서는 가운데 card를
// 비워 두고 panel만 실제 WorkspacesPanel로 그린다. Jobs 칸은 project의 Jobs panel을 그대로 보인다.
import { useMemo, useState } from "react";
import { galleryApps } from "../../../../../packages/shell/renderer/apps/testdata/fake-apps.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import {
  fakeProjects,
  MISSING_FOLDER,
} from "../../../../../packages/shell/renderer/desktop/workspaces/projects/testdata/fake-projects.ts";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { WorkspacesPanel } from "../../../../../packages/shell/renderer/shell/workspaces-panel.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import {
  click,
  press,
  runSteps,
  type Step,
  useDrive,
} from "../../../mock/drive.ts";
import { withSyncLists } from "../../../mock/core-answers/sync-lists.ts";
import { PageLeftSidebar, PageProjectPanel } from "../project-window.tsx";

const PANELS = [
  { key: "workspaces", label: "Workspaces", icon: shellIcons.app },
  { key: "jobs", label: "Jobs", icon: shellIcons.jobs },
];

const noop = () => {};

export function WorkspacesScene({
  steps = [],
  deleteCode,
}: {
  steps?: readonly Step[];
  /** 지우기가 돌려줄 오류 code. 앱 process가 아직 멈추는 중이면 unavailable이다. */
  deleteCode?: string;
}) {
  const [panel, setPanel] = useState("workspaces");
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const projects = useMemo(
    () =>
      fakeProjects({
        missingFolder: MISSING_FOLDER,
        picked: "/home/mina/trips/autumn",
      }).source,
    [],
  );
  const apps = useMemo(() => galleryApps({ deleteCode }).source, [deleteCode]);
  // panel은 목록을 core 읽기로 받는다. 쓰기를 맡는 fake의 값이 읽기의 답이다.
  const client = useMemo(
    () => createEventClient(withSyncLists(createFakeSource(), projects, apps)),
    [projects, apps],
  );
  useDrive(() => runSteps(steps));
  return (
    <ShellFrame
      left={left}
      onToggleLeft={() => setLeft(!left)}
      right={right}
      onToggleRight={() => setRight(!right)}
      tabs={null}
      panelTabs={
        <PanelTabs tabs={PANELS} selected={panel} onSelect={setPanel} />
      }
      leftSidebar={<PageLeftSidebar onOpenFile={noop} onAgent={noop} />}
      rightSidebar={
        panel === "workspaces" ? (
          <EventsProvider client={client}>
            <WorkspacesPanel
              projects={projects}
              apps={apps}
              onProject={noop}
              onApp={noop}
              onNewApp={noop}
            />
          </EventsProvider>
        ) : (
          <PageProjectPanel tab="jobs" onOpenFile={noop} onAgent={noop} />
        )
      }
    >
      <div
        style={{
          flex: 1,
          borderRadius: "var(--radius-lg)",
          background: "var(--color-surface-base)",
        }}
      />
    </ShellFrame>
  );
}

export const workspacesSteps = {
  menu: [() => press("[data-project] [data-card-menu]")] as readonly Step[],
  appMenu: [() => press("[data-app] [data-card-menu]")] as readonly Step[],
  archived: [
    () => click('[data-section="archived"] [data-toggle]'),
  ] as readonly Step[],
  deleteApp: [
    () => click('[data-section="archived"] [data-toggle]'),
    () => click('[data-archived="app"] [data-action="delete"]'),
  ] as readonly Step[],
  deleteAppStopping: [
    () => click('[data-section="archived"] [data-toggle]'),
    () => click('[data-archived="app"] [data-action="delete"]'),
    () => click('[data-action="confirm-delete-app"]'),
  ] as readonly Step[],
  register: [() => click("[data-register-project]")] as readonly Step[],
};
