import { type MouseEvent, type ReactElement, useRef, useState } from "react";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import type { TabItem as StripTab } from "../../parts/tab-strip/tab-strip.tsx";
import { TabStateDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";
import { workspaceIcons } from "../../icons/mod.ts";
import type { FloatItem, TabItem } from "../model.ts";
import styles from "./minimized-bar.module.css";

// 한 칸의 폭. 개수를 세는 값이자 칸의 style 폭이다.
const CHIP_WIDTH = 140;
const MORE_WIDTH = 40;

interface MinimizedBarProps {
  /** 접힌 항목만. floats 순서(아래가 먼저). */
  items: readonly FloatItem[];
  stripTab: (tab: TabItem) => StripTab;
  onRestore(key: string): void;
  onDock(key: string): void;
  onClose(key: string): void;
}

export function MinimizedBar(props: MinimizedBarProps): ReactElement | null {
  if (props.items.length === 0) return null;
  return <Row {...props} />;
}

type OpenMenu =
  | { kind: "chip"; key: string; x: number; y: number }
  | { kind: "more"; x: number; y: number };

function Row(
  { items, stripTab, onRestore, onDock, onClose }: MinimizedBarProps,
) {
  const root = useRef<HTMLDivElement>(null);
  const width = useObservedSize(root)?.width ?? 0;
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  // 모두 들어가면 +N이 없다. 아니면 +N 한 칸을 남기고 나머지를 칸이 나눈다.
  const fit = items.length * CHIP_WIDTH <= width
    ? items.length
    : Math.max(0, Math.floor((width - MORE_WIDTH) / CHIP_WIDTH));
  const shown = items.slice(0, fit);
  const hidden = items.slice(fit);

  const chipTab = menu?.kind === "chip"
    ? items.find((item) => item.tab.key === menu.key)
    : undefined;
  const menuItems = menu?.kind === "more"
    ? hidden.map(({ tab }) => ({
      id: tab.key,
      label: tab.title,
      leading: <MenuIcon>{stripTab(tab).icon}</MenuIcon>,
    }))
    : chipTab === undefined
    ? []
    : [
      {
        id: "restore",
        label: t("project-workspace.button.float-restore"),
        leading: <MenuIcon icon={workspaceIcons.restore} />,
      },
      {
        id: "dock",
        label: t("project-workspace.button.float-dock"),
        leading: <MenuIcon icon={workspaceIcons.dock} />,
      },
      {
        id: "close",
        label: t("project-workspace.button.float-close"),
        leading: <MenuIcon icon={workspaceIcons.close} />,
      },
    ];
  const choose = (id: string) => {
    if (menu?.kind === "more") onRestore(id);
    else if (chipTab === undefined) return;
    else if (id === "restore") onRestore(chipTab.tab.key);
    else if (id === "dock") onDock(chipTab.tab.key);
    else if (id === "close") onClose(chipTab.tab.key);
  };

  const below = (event: MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: box.left, y: box.bottom };
  };

  return (
    <div
      ref={root}
      className={styles.row}
      role="group"
      aria-label={t("project-workspace.label.minimized")}
      data-minimized-bar=""
    >
      {shown.map(({ tab }) => {
        const strip = stripTab(tab);
        return (
          <div
            key={tab.key}
            className={styles.chip}
            style={{ width: CHIP_WIDTH }}
            data-minimized-chip={tab.key}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({
                kind: "chip",
                key: tab.key,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <button
              type="button"
              className={styles.restore}
              onClick={() => onRestore(tab.key)}
            >
              <span className={styles.icon}>{strip.icon}</span>
              <span className={styles.title}>{tab.title}</span>
              {strip.dot ? <TabStateDot dot={strip.dot} /> : null}
            </button>
            <IconButton
              icon={workspaceIcons.close}
              label={t("project-workspace.button.minimized-close", {
                title: tab.title,
              })}
              size="sm"
              onClick={() => onClose(tab.key)}
            />
          </div>
        );
      })}
      {hidden.length === 0 ? null : (
        <Tooltip
          content={t("project-workspace.button.minimized-more", {
            count: hidden.length,
          })}
        >
          <button
            type="button"
            className={styles.more}
            style={{ width: MORE_WIDTH }}
            data-minimized-more=""
            aria-label={t("project-workspace.button.minimized-more", {
              count: hidden.length,
            })}
            onClick={(event) => setMenu({ kind: "more", ...below(event) })}
          >
            {t("project-workspace.button.minimized-count", {
              count: String(hidden.length),
            })}
          </button>
        </Tooltip>
      )}
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
            choose(id);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}
