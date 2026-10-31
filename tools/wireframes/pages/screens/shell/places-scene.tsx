// Home의 오른쪽 sidebar Places panel을 shell 틀 안에 놓는다. Home place 연결은 app 화면 task가 하므로 여기서는 가운데 card를
// 비워 두고 panel만 실제 PlacesPanel로 그린다. Jobs 칸은 project의 Jobs panel을 그대로 보인다.
import { useMemo, useState } from "react";
import { galleryApps } from "../../../../../packages/shell/renderer/apps/testdata/fake-apps.ts";
import {
  fakeProjects,
  MISSING_FOLDER,
} from "../../../../../packages/shell/renderer/desktop/places/projects/testdata/fake-projects.ts";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { PlacesPanel } from "../../../../../packages/shell/renderer/shell/places-panel.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import {
  click,
  press,
  runSteps,
  type Step,
  useDrive,
} from "../../../mock/drive.ts";
import { PageLeftSidebar, PageProjectPanel } from "../project-window.tsx";

const PANELS = [
  { key: "places", label: "Places", icon: shellIcons.app },
  { key: "jobs", label: "Jobs", icon: shellIcons.jobs },
];

const noop = () => {};

export function PlacesScene({ steps = [] }: { steps?: readonly Step[] }) {
  const [panel, setPanel] = useState("places");
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
  const apps = useMemo(() => galleryApps().source, []);
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
        panel === "places" ? (
          <PlacesPanel
            projects={projects}
            apps={apps}
            onProject={noop}
            onApp={noop}
            onNewApp={noop}
          />
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

export const placesSteps = {
  menu: [() => press("[data-project] [data-card-menu]")] as readonly Step[],
  archived: [
    () => click('[data-section="archived"] [data-toggle]'),
  ] as readonly Step[],
  register: [() => click("[data-register-project]")] as readonly Step[],
};
