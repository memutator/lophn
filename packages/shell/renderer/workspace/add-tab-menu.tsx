// 탭 줄의 새 탭 menu. Agent·Browser·App panel은 퀵 실행과 같은 목록을 옆에 연다. browser profile이 있으면 Browser 목록 맨 위가
// 기본 profile과 profile들이고 고른 profile로 연다(빠른 실행과 단축키는 기본 profile로 연다).

import { t } from "@lophn/i18n";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import { FileIcon, IconButton } from "@lophn/ui/primitives";
import type { ReactNode } from "react";
import { ProfileMark } from "../browser/browser-chrome.tsx";
import { useBrowserProfiles } from "../browser/profiles.tsx";
import { useKeyLabel } from "../commands/react.tsx";
import { useMachinesView } from "../desktop/machines/context.tsx";
import {
  browserIcons,
  commonIcons,
  paletteIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import type { AgentChoice } from "../parts/agent-session/agent-session.tsx";
import { agentSections, sectionMenuItems } from "../shell/agent-sections.tsx";
import type { QuickHoverItem } from "../shell/quick-launch.tsx";
import {
  type ProjectCommandActions,
  projectCommandsMenuItems,
} from "./project-commands/commands-menu.tsx";
import type { ProjectCommandGroup } from "./project-commands/use-project-commands.ts";

interface NewTabMenuProps {
  onDocument?: () => void;
  onTerminal?: () => void;
  /** project의 명령 목록. 주어지면 Terminal 항목이 옆으로 펼쳐지는 하위 메뉴가 된다. */
  terminalSubmenu?: {
    readonly groups: readonly ProjectCommandGroup[];
    readonly actions: ProjectCommandActions;
  };
  /** 새 browser 탭. profile이 없으면 기본 profile이다. */
  onBrowser?: (profile?: string) => void;
  browserItems?: readonly QuickHoverItem[];
  choices?: readonly AgentChoice[];
  onChoice?: (choice: AgentChoice) => void;
  onAgents?: () => void;
  onSearch?: () => void;
  onAppPanel?: () => void;
  appItems?: readonly QuickHoverItem[];
  onAppScreen?: () => void;
  /** 연결된 다른 기계마다 "Pages on <기계>" 항목이 선다. 그 기계의 browser page 목록 탭을 연다. */
  onPages?: (machine: string) => void;
}

const PROFILE_ITEM = "browser-profile:";

const lead = (icon: Parameters<typeof MenuIcon>[0]["icon"]): ReactNode => (
  <MenuIcon icon={icon} />
);

export function NewTabMenu(props: NewTabMenuProps) {
  const keyLabel = useKeyLabel();
  const machines = useMachinesView()?.machines ?? [];
  const profiles = useBrowserProfiles();
  const keyed = (id: string): { shortcut?: string } => {
    const key = keyLabel(id);
    return key === null ? {} : { shortcut: key };
  };
  const actions = new Map<string, () => void>();
  const rows = (prefix: string, items: readonly QuickHoverItem[]): MenuItem[] =>
    items.map((item, index) => {
      const id = `${prefix}:${index}`;
      actions.set(id, item.onSelect);
      return {
        id,
        label: item.label,
        leading: <MenuIcon>{item.leading}</MenuIcon>,
      };
    });
  const root: MenuItem[] = [];
  if (props.onDocument)
    root.push({
      id: "document",
      label: t("project-workspace.label.menu-document"),
      leading: (
        <MenuIcon>
          <FileIcon name="notes.md" size={16} />
        </MenuIcon>
      ),
      ...keyed("new.document"),
    });
  if (props.onTerminal) {
    if (props.terminalSubmenu !== undefined) {
      const cmdItems = projectCommandsMenuItems(
        props.terminalSubmenu.groups,
        props.terminalSubmenu.actions,
        (id, fn) => actions.set(id, fn),
      );
      root.push({
        id: "terminal-menu",
        label: t("project-workspace.label.menu-terminal"),
        leading: lead(workspaceIcons.terminal),
        items: [
          {
            id: "terminal",
            label: t("left-sidebar.button.quick-terminal"),
            leading: lead(workspaceIcons.terminal),
            ...keyed("new.terminal"),
          },
          ...cmdItems,
        ],
      });
    } else {
      root.push({
        id: "terminal",
        label: t("project-workspace.label.menu-terminal"),
        leading: lead(workspaceIcons.terminal),
        ...keyed("new.terminal"),
      });
    }
  }
  if (props.onBrowser)
    root.push({
      id: "browser-menu",
      label: t("browser.label.menu-browser"),
      leading: lead(browserIcons.globe),
      items: [
        {
          id: "browser",
          ...(profiles.length === 0
            ? { label: t("browser.label.menu-browser") }
            : {
                label: t("browser.label.profile-default"),
                leading: lead(browserIcons.globe),
              }),
          ...keyed("new.browser"),
        },
        ...profiles.map((profile) => ({
          id: `${PROFILE_ITEM}${profile.id}`,
          label: profile.name,
          leading: (
            <MenuIcon>
              <ProfileMark profile={profile} />
            </MenuIcon>
          ),
        })),
        ...rows("bookmark", props.browserItems ?? []).map((item, index) =>
          index === 0 ? { ...item, separatorBefore: true } : item,
        ),
      ],
    });
  if (props.choices !== undefined && props.onChoice) {
    const sections = agentSections(
      props.choices,
      keyLabel("new.agent"),
      props.onChoice,
    );
    for (const section of sections)
      for (const item of section.items) actions.set(item.id, item.onSelect);
    root.push({
      id: "agent",
      label: t("project-workspace.label.menu-agent"),
      leading: lead(commonIcons.agents),
      items: sectionMenuItems(sections),
    });
  }
  if (props.onAgents)
    root.push({
      id: "agents",
      label: t("project-workspace.label.kind-agents"),
      leading: lead(commonIcons.agents),
    });
  if (props.onSearch)
    root.push({
      id: "search",
      label: t("project-workspace.label.menu-search"),
      leading: lead(paletteIcons.search),
      ...keyed("search.open"),
    });
  if (props.onAppScreen)
    root.push({
      id: "app-screen",
      label: t("app-space.label.menu-app-screen"),
      leading: lead(workspaceIcons.appPanel),
    });
  if (props.onPages)
    for (const machine of machines)
      if (machine.status === "connected")
        root.push({
          id: `pages:${machine.id}`,
          label: t("machines.page.menu", { name: machine.name }),
          leading: lead(browserIcons.globe),
        });
  if (props.onAppPanel)
    root.push({
      id: "app-panel-menu",
      label: t("project-workspace.label.menu-app-panel"),
      leading: lead(workspaceIcons.appPanel),
      items: [
        { id: "app-panel", label: t("project-workspace.label.menu-app-panel") },
        ...rows("panel", props.appItems ?? []).map((item, index) =>
          index === 0 ? { ...item, separatorBefore: true } : item,
        ),
      ],
    });
  return (
    <Menu
      trigger={
        <IconButton
          icon={commonIcons.add}
          label={t("project-workspace.button.new-tab")}
          size="sm"
          data-new-tab=""
        />
      }
      items={root}
      onSelect={(id) => {
        if (id === "document") props.onDocument?.();
        else if (id === "terminal") props.onTerminal?.();
        else if (id === "browser") props.onBrowser?.();
        else if (id === "agents") props.onAgents?.();
        else if (id === "search") props.onSearch?.();
        else if (id === "app-screen") props.onAppScreen?.();
        else if (id === "app-panel") props.onAppPanel?.();
        else if (id.startsWith(PROFILE_ITEM))
          props.onBrowser?.(id.slice(PROFILE_ITEM.length));
        else if (id.startsWith("pages:"))
          props.onPages?.(id.slice("pages:".length));
        else actions.get(id)?.();
      }}
    />
  );
}
