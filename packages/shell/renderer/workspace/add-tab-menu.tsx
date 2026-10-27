// 탭 줄 끝의 새 탭(+) menu. Document · Terminal · Browser · Agent ▸ · Search · App panel이고 항목마다
// 아이콘이 붙는다. Agent는 같은 menu가 그 목록으로 바뀐다(Radix menu는 한 번에 한 단계만 보인다).
// 부르는 쪽이 통로가 있는 항목의 핸들러만 준다. 핸들러가 없는 항목은 두지 않는다.
import { type ReactNode, useRef, useState } from "react";
import { Avatar, type AvatarProfile } from "../parts/avatar/avatar.tsx";
import { FileIcon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import {
  browserIcons,
  commonIcons,
  paletteIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./add-tab-menu.module.css";

interface NewTabAgent {
  readonly id: string;
  readonly name: string;
  readonly profile: AvatarProfile;
}

interface NewTabMenuProps {
  onDocument?: () => void;
  onTerminal?: () => void;
  onBrowser?: () => void;
  /** 주면 Agent ▸ 항목이 있고 이 목록으로 바뀐다. */
  agents?: readonly NewTabAgent[];
  onAgent?: (agent: string) => void;
  onSearch?: () => void;
  onAppPanel?: () => void;
}

type Level = "root" | "agent";

const lead = (icon: Parameters<typeof MenuIcon>[0]["icon"]): ReactNode => (
  <MenuIcon icon={icon} />
);

export function NewTabMenu(props: NewTabMenuProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>("root");
  // 다음 단계로 가는 항목을 고르면 Radix가 닫으려 하지만 같은 menu를 이어 연다.
  const stay = useRef(false);
  const label = t("project-workspace.button.new-tab");

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
    });
  }
  if (props.onTerminal) {
    root.push({
      id: "terminal",
      label: t("project-workspace.label.menu-terminal"),
      leading: lead(workspaceIcons.terminal),
    });
  }
  if (props.onBrowser) {
    root.push({
      id: "browser",
      label: t("browser.label.menu-browser"),
      leading: lead(browserIcons.globe),
    });
  }
  if (props.agents !== undefined && props.onAgent) {
    root.push({
      id: "agent",
      label: (
        <span className={styles.more}>
          {t("project-workspace.label.menu-agent")}
        </span>
      ),
      textValue: t("project-workspace.label.menu-agent"),
      leading: lead(commonIcons.roles),
    });
  }
  if (props.onSearch) {
    root.push({
      id: "search",
      label: t("project-workspace.label.menu-search"),
      leading: lead(paletteIcons.search),
    });
  }
  if (props.onAppPanel) {
    root.push({
      id: "app-panel",
      label: t("project-workspace.label.menu-app-panel"),
      leading: lead(workspaceIcons.appPanel),
    });
  }

  const items: MenuItem[] =
    level === "agent"
      ? (props.agents ?? []).map((agent) => ({
          id: `agent:${agent.id}`,
          label: agent.name,
          textValue: agent.name,
          leading: (
            <MenuIcon>
              <Avatar profile={agent.profile} size="sm" />
            </MenuIcon>
          ),
        }))
      : root;

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
    else if (id === "app-panel") props.onAppPanel?.();
    else if (id.startsWith("agent:")) props.onAgent?.(id.slice(6));
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
