// 탭 줄의 새 탭 menu. Agent·Browser·App panel은 퀵 실행과 같은 목록을 옆에 연다.
import type { ReactNode } from "react";
import type { AgentChoice } from "../parts/agent-session/agent-session.tsx";
import { agentSections, sectionMenuItems } from "../shell/agent-sections.tsx";
import type { QuickHoverItem } from "../shell/quick-launch.tsx";
import { FileIcon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import {
  browserIcons,
  commonIcons,
  paletteIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import { t } from "@lophn/i18n";
import { useKeyLabel } from "../commands/react.tsx";

interface NewTabMenuProps {
  onDocument?: () => void;
  onTerminal?: () => void;
  onBrowser?: () => void;
  browserItems?: readonly QuickHoverItem[];
  choices?: readonly AgentChoice[];
  onChoice?: (choice: AgentChoice) => void;
  onAgents?: () => void;
  onSearch?: () => void;
  onAppPanel?: () => void;
  appItems?: readonly QuickHoverItem[];
  onAppScreen?: () => void;
  /** 다른 기계의 창에서만 준다: 그 기계의 browser page 목록. */
  onPages?: () => void;
}

const lead = (icon: Parameters<typeof MenuIcon>[0]["icon"]): ReactNode => (
  <MenuIcon icon={icon} />
);

export function NewTabMenu(props: NewTabMenuProps) {
  const keyLabel = useKeyLabel();
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
  if (props.onTerminal)
    root.push({
      id: "terminal",
      label: t("project-workspace.label.menu-terminal"),
      leading: lead(workspaceIcons.terminal),
      ...keyed("new.terminal"),
    });
  if (props.onBrowser)
    root.push({
      id: "browser-menu",
      label: t("browser.label.menu-browser"),
      leading: lead(browserIcons.globe),
      items: [
        {
          id: "browser",
          label: t("browser.label.menu-browser"),
          ...keyed("new.browser"),
        },
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
    root.push({
      id: "pages",
      label: t("machines.page.kind"),
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
        else if (id === "pages") props.onPages?.();
        else actions.get(id)?.();
      }}
    />
  );
}
