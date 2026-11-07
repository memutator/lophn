// 탭 줄 끝의 새 탭(+) menu. Document · Terminal · Browser · Agent ▸ · Search · App panel이고 항목마다
// 아이콘이 붙는다. Agent는 같은 menu가 그 목록으로 바뀐다(Radix menu는 한 번에 한 단계만 보인다). 그 목록은 sidebar + hover 목록과 같은 묶음이다.
// 부르는 쪽이 통로가 있는 항목의 핸들러만 준다. 핸들러가 없는 항목은 두지 않는다.
import { type ReactNode, useRef, useState } from "react";
import type { AgentChoice } from "../parts/agent-session/agent-session.tsx";
import { agentSections, sectionMenuItems } from "../shell/agent-sections.tsx";
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

import styles from "./add-tab-menu.module.css";

interface NewTabMenuProps {
  onDocument?: () => void;
  onTerminal?: () => void;
  onBrowser?: () => void;
  /** 주면 Agent ▸ 항목이 있고 sidebar + hover 목록과 같은 묶음(`agentSections`)으로 바뀐다. */
  choices?: readonly AgentChoice[];
  onChoice?: (choice: AgentChoice) => void;
  onSearch?: () => void;
  onAppPanel?: () => void;
  /** 앱 workspace에서만 있다. 닫은 앱 화면 탭을 다시 연다. */
  onAppScreen?: () => void;
}

type Level = "root" | "agent";

const lead = (icon: Parameters<typeof MenuIcon>[0]["icon"]): ReactNode => (
  <MenuIcon icon={icon} />
);

/** + menu의 앱 항목. 핸들러가 없는 항목은 없고, 둘 다 없으면 items가 비어 있다. */
function appTabEntries(
  props: Pick<NewTabMenuProps, "onAppScreen" | "onAppPanel">,
): { items: MenuItem[]; select: (id: string) => void } {
  const items: MenuItem[] = [];
  if (props.onAppScreen) {
    items.push({
      id: "app-screen",
      label: t("app-space.label.menu-app-screen"),
      leading: lead(workspaceIcons.appPanel),
    });
  }
  if (props.onAppPanel) {
    items.push({
      id: "app-panel",
      label: t("project-workspace.label.menu-app-panel"),
      leading: lead(workspaceIcons.appPanel),
    });
  }
  return {
    items,
    select: (id) => {
      if (id === "app-screen") props.onAppScreen?.();
      else if (id === "app-panel") props.onAppPanel?.();
    },
  };
}

export function NewTabMenu(props: NewTabMenuProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>("root");
  // 다음 단계로 가는 항목을 고르면 Radix가 닫으려 하지만 같은 menu를 이어 연다.
  const stay = useRef(false);
  const label = t("project-workspace.button.new-tab");
  const keyLabel = useKeyLabel();
  // 키가 없는 항목은 shortcut을 달지 않는다.
  const keyed = (id: string): { shortcut?: string } => {
    const key = keyLabel(id);
    return key === null ? {} : { shortcut: key };
  };

  const root: MenuItem[] = [];
  if (props.onDocument) {
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
  }
  if (props.onTerminal) {
    root.push({
      id: "terminal",
      label: t("project-workspace.label.menu-terminal"),
      leading: lead(workspaceIcons.terminal),
      ...keyed("new.terminal"),
    });
  }
  if (props.onBrowser) {
    root.push({
      id: "browser",
      label: t("browser.label.menu-browser"),
      leading: lead(browserIcons.globe),
      ...keyed("new.browser"),
    });
  }
  if (props.choices !== undefined && props.onChoice) {
    root.push({
      id: "agent",
      label: (
        <span className={styles.more}>
          {t("project-workspace.label.menu-agent")}
        </span>
      ),
      textValue: t("project-workspace.label.menu-agent"),
      leading: lead(commonIcons.agents),
    });
  }
  if (props.onSearch) {
    root.push({
      id: "search",
      label: t("project-workspace.label.menu-search"),
      leading: lead(paletteIcons.search),
      ...keyed("search.open"),
    });
  }
  const app = appTabEntries(props);
  root.push(...app.items);

  const agentLevel = agentSections(
    props.choices ?? [],
    keyLabel("new.agent"),
    (choice) => props.onChoice?.(choice),
  );
  const items: MenuItem[] =
    level === "agent" ? sectionMenuItems(agentLevel) : root;

  const select = (id: string) => {
    if (id === "agent") {
      stay.current = true;
      setLevel(id);
      return;
    }
    if (id === "document") props.onDocument?.();
    else if (id === "terminal") props.onTerminal?.();
    else if (id === "browser") props.onBrowser?.();
    else if (id === "search") props.onSearch?.();
    else if (id === "app-screen" || id === "app-panel") app.select(id);
    else
      agentLevel
        .flatMap((section) => section.items)
        .find((item) => item.id === id)
        ?.onSelect();
  };

  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        if (!next && stay.current) {
          stay.current = false;
          return;
        }
        if (next) setLevel("root");
        setOpen(next);
      }}
      trigger={
        <IconButton
          icon={commonIcons.add}
          label={label}
          size="sm"
          data-new-tab=""
        />
      }
      items={items}
      onSelect={select}
    />
  );
}
