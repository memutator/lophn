// ProjectApp을 감싸 body와 children으로 얹은 화면이 탭을 열 수 있게 한다. 탭을 열면 그 탭이 든 칸 구성으로 다시 시작한다.
import { useState } from "react";

import {
  type PaneInit,
  ProjectApp,
  type ProjectAppProps,
} from "../../pages/screens/project-app.tsx";
import type { TabSpec } from "../../pages/screens/project-window.tsx";
import { HostProvider, type OpenTab } from "./open-tab.ts";

// ProjectApp의 open과 같은 규칙: 이미 열린 탭이면 고르고(Context 탭은 하위 탭도 바꾼다), 아니면 칸 끝에 더한다.
function openIn(
  panes: readonly PaneInit[],
  tab: TabSpec,
  other: boolean,
): readonly PaneInit[] {
  const at = panes.findIndex((pane) =>
    pane.tabs.some((item) => item.key === tab.key)
  );
  if (at !== -1) {
    return panes.map((pane, index) =>
      index !== at ? pane : {
        tabs: pane.tabs.map((item) =>
          item.key === tab.key && tab.sub !== undefined &&
            item.kind === "context"
            ? { ...item, sub: tab.sub, rev: (item.rev ?? 0) + 1 }
            : item
        ),
        selected: tab.key,
      }
    );
  }
  const target = other ? 1 : 0;
  const base = panes.length > target
    ? panes
    : [...panes, { tabs: [], selected: "" }];
  return base.map((pane, index) =>
    index !== target ? pane : { tabs: [...pane.tabs, tab], selected: tab.key }
  );
}

export function ProjectHost(props: ProjectAppProps) {
  const [panes, setPanes] = useState<readonly PaneInit[]>(props.panes);
  const [opened, setOpened] = useState(0);
  const open: OpenTab = (tab, other = false) => {
    setPanes((current) => openIn(current, tab, other));
    setOpened((count) => count + 1);
  };
  return (
    <HostProvider value={{ open, opened }}>
      <ProjectApp key={opened} {...props} panes={panes} />
    </HostProvider>
  );
}
