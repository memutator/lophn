// 왼쪽 sidebar만 보이는 shell 틀. 맨 아래 줄의 빠른 실행(Terminal · Browser · App ▾)을 workspace마다 보인다.
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { press, runSteps, type Step, useDrive } from "../../../mock/drive.ts";
import { PageLeftSidebar } from "../project-window.tsx";

const noop = () => {};

export const sidebarSteps = {
  appMenu: [() => press("[data-quick=app]")] as readonly Step[],
};

export function SidebarScene({
  workspace,
  steps = [],
}: {
  workspace: "project" | "home" | "app";
  steps?: readonly Step[];
}) {
  useDrive(() => runSteps(steps));
  return (
    <ShellFrame
      left
      onToggleLeft={noop}
      right={false}
      onToggleRight={noop}
      tabs={null}
      panelTabs={
        <PanelTabs
          tabs={[
            { key: "workspaces", label: "Workspaces", icon: shellIcons.app },
          ]}
          selected="workspaces"
          onSelect={noop}
        />
      }
      leftSidebar={
        <PageLeftSidebar
          workspace={workspace}
          onOpenFile={noop}
          onAgent={noop}
        />
      }
      rightSidebar={null}
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
