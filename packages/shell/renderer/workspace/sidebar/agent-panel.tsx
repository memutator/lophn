// project sidebar의 Agent 쪽. 위에서부터 Agents(lophn agent, hover의 +로 새 session), Current(이 창에 탭이 열린 lophn
// session과 터미널 coding agent session), Background(run), Recent(탭을 닫은 lophn session과 저장한 터미널 session)다.
// Current와 Recent 줄은 둘 다 한 줄 [아이콘][제목]이고, Current만 오른쪽 끝에 탭 줄과 같은 상태 점이 온다.

import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";
import { useState } from "react";
import { commonIcons, workspaceIcons } from "../../icons/mod.ts";
import { Avatar } from "../../parts/avatar/avatar.tsx";
import { TabStateDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../parts/vendor-icon/vendor-icon.tsx";
import styles from "./project-sidebar.module.css";
import { RunList } from "./run-list.tsx";
import type { SidebarAgent } from "./sidebar-agent.ts";
import type {
  AgentPanelView,
  PanelItem,
  PanelSession,
  PanelTerminal,
} from "./use-agent-panel.ts";

interface AgentPanelProps {
  view: AgentPanelView;
  onAgent: (agent: SidebarAgent) => void;
  /** hover의 +. 주지 않으면 agent 줄과 같다. */
  onNewSession?: (agent: SidebarAgent) => void;
  onSession: (session: PanelSession) => void;
  onTerminal: (terminal: PanelTerminal) => void;
  /** Recent 줄을 목록에서 지운다. transcript는 지우지 않는다. */
  onRemove: (item: PanelItem) => void;
  onManage: () => void;
}

// Current와 Recent의 한 줄. 아이콘 자리는 avatar sm 폭으로 고정이라 두 종류의 제목이 같은 줄에 선다.
function PanelRow({
  item,
  recent,
  onSession,
  onTerminal,
  onMenu,
}: {
  item: PanelItem;
  recent: boolean;
  onMenu: (item: PanelItem, at: { x: number; y: number }) => void;
} & Pick<AgentPanelProps, "onSession" | "onTerminal">) {
  const session = item.kind === "session";
  const title = session ? item.session.title : item.terminal.title;
  const dot = session ? item.session.dot : item.terminal.dot;
  const vendor = session ? undefined : harnessVendorOf(item.terminal.harness);
  return (
    <li className={styles.li}>
      <button
        type="button"
        className={`${styles.item} ${styles.sessionItem}`}
        data-session={session ? item.session.id : undefined}
        data-terminal={session ? undefined : item.terminal.key}
        onClick={() =>
          session ? onSession(item.session) : onTerminal(item.terminal)
        }
        onContextMenu={(event) => {
          if (!recent) return;
          event.preventDefault();
          onMenu(item, { x: event.clientX, y: event.clientY });
        }}
      >
        <span className={styles.rowIcon}>
          {session ? (
            <Avatar profile={item.agent.profile} size="sm" />
          ) : vendor === undefined ? null : (
            <VendorIcon vendor={vendor} size={iconPixels("large")} />
          )}
        </span>
        <span className={styles.label}>{title}</span>
        {recent || dot === null ? null : <TabStateDot dot={dot} />}
      </button>
    </li>
  );
}

export function AgentPanel({
  view,
  onAgent,
  onNewSession,
  onSession,
  onTerminal,
  onRemove,
  onManage,
}: AgentPanelProps) {
  const [menu, setMenu] = useState<{
    readonly item: PanelItem;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const rowProps = {
    onSession,
    onTerminal,
    onMenu: (item: PanelItem, at: { x: number; y: number }) =>
      setMenu({ item, ...at }),
  };
  const menuItems: readonly MenuItem[] = [
    {
      id: "remove",
      label: t("project-workspace.button.remove-recent"),
      leading: <MenuIcon icon={workspaceIcons.trash} />,
    },
  ];
  return (
    <>
      <section className={styles.section} data-agents="">
        <h2 className={`${styles.sectionLabel} ${styles.agentsHead}`}>
          <span>{t("project-workspace.heading.agents")}</span>
          <button
            type="button"
            className={styles.manage}
            data-agents-manage=""
            onClick={onManage}
          >
            {t("project-workspace.button.manage-agents")}
          </button>
        </h2>
        <ul className={styles.list} role="list">
          {view.agents.map((agent) => (
            <li
              key={agent.assignment}
              className={`${styles.li} ${styles.agentRow}`}
            >
              <button
                type="button"
                className={styles.item}
                data-agent={agent.assignment}
                onClick={() => onAgent(agent)}
              >
                <Avatar profile={agent.profile} size="sm" />
                <span className={styles.label}>{agent.name}</span>
              </button>
              <span className={styles.plus}>
                <IconButton
                  icon={commonIcons.add}
                  label={t("project-workspace.button.new-session-with", {
                    agent: agent.name,
                  })}
                  size="sm"
                  onClick={() => (onNewSession ?? onAgent)(agent)}
                />
              </span>
            </li>
          ))}
        </ul>
      </section>
      {view.current.length === 0 ? null : (
        <section className={styles.section} data-current="">
          <h2 className={styles.sectionLabel}>
            {t("project-workspace.heading.current")}
          </h2>
          <ul className={styles.list} role="list">
            {view.current.map((item) => (
              <PanelRow
                key={
                  item.kind === "session"
                    ? `session:${item.session.id}`
                    : `terminal:${item.terminal.key}`
                }
                item={item}
                recent={false}
                {...rowProps}
              />
            ))}
          </ul>
        </section>
      )}
      {view.runs.length === 0 ? null : (
        <section className={styles.section} data-runs="">
          <h2 className={styles.sectionLabel}>
            {t("run-list.heading.background")}
          </h2>
          <RunList runs={view.runs} onSession={onSession} />
        </section>
      )}
      <section className={styles.section} data-recent="">
        <h2 className={styles.sectionLabel}>
          {t("project-workspace.label.recent")}
        </h2>
        <ul className={styles.list} role="list">
          {view.recent.map((item) => (
            <PanelRow
              key={
                item.kind === "session"
                  ? `session:${item.session.id}`
                  : `terminal:${item.terminal.key}`
              }
              item={item}
              recent
              {...rowProps}
            />
          ))}
        </ul>
      </section>
      {menu === null ? null : (
        <Menu
          open
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
          trigger={
            <span
              className={styles.menuAnchor}
              style={{ left: menu.x, top: menu.y }}
            />
          }
          items={menuItems}
          onSelect={(id) => {
            if (id === "remove") onRemove(menu.item);
            setMenu(null);
          }}
        />
      )}
    </>
  );
}
