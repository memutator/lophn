// 새 shell의 창 틀. title bar(왼쪽 구역, tab 줄, 오른쪽 구역)와 몸통(왼쪽 sidebar, 둥근 card가 서는 stage, 오른쪽 sidebar)이다.
// 내용은 모두 slot으로 받는다: 틀은 칸의 폭, 접힘, 창 끌기 영역과 OS별 자리만 안다.
import type { ReactNode } from "react";
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";

import type { WindowControlsApi } from "../../ipc/window-controls.ts";
import {
  currentPlatform,
  type WindowPlatform,
} from "../desktop/top-bar/platform.ts";
import { shellIcons } from "../icons/mod.ts";
import { Avatar } from "../parts/avatar/avatar.tsx";
import styles from "./shell-frame.module.css";
import { bridge, WindowButtons } from "./window-buttons.tsx";

export interface ShellFrameProps {
  /** 왼쪽 sidebar가 펼쳐져 있다. 접히면 slot을 그리지 않는다. */
  left: boolean;
  onToggleLeft: () => void;
  /** 오른쪽 sidebar가 펼쳐져 있다. 접히면 panelTabs와 slot을 그리지 않는다. */
  right: boolean;
  onToggleRight: () => void;
  /** 검색 단추. 왼쪽 sidebar가 펼쳐져 있을 때만 보인다. */
  onSearch?: () => void;
  /** 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
  /** 창 단추 통로. 기본은 preload가 둔 통로이고 없으면 단추를 그리지 않는다. */
  windowApi?: WindowControlsApi;
  /** 왼쪽 구역의 desk 단추(DeskSwitcher). project place에만 둔다. */
  deskSwitcher?: ReactNode;
  /** 가운데 tab 줄(TabStrip). */
  tabs: ReactNode;
  /** 오른쪽 구역의 panel icon tab(PanelTabs). */
  panelTabs?: ReactNode;
  leftSidebar: ReactNode;
  rightSidebar?: ReactNode;
  /** stage 위에 얹는 층(FloatLayer). */
  floats?: ReactNode;
  /** 가운데 card(ContentCard). */
  children: ReactNode;
}

export function ShellFrame({
  left,
  onToggleLeft,
  right,
  onToggleRight,
  onSearch,
  platform = currentPlatform(),
  windowApi = bridge(),
  deskSwitcher,
  tabs,
  panelTabs,
  leftSidebar,
  rightSidebar,
  floats,
  children,
}: ShellFrameProps) {
  return (
    <div
      className={styles.shell}
      data-platform={platform}
      data-left={left ? "open" : "closed"}
      data-right={right ? "open" : "closed"}
    >
      <header className={styles.titlebar}>
        <div className={styles.titleLeft}>
          <IconButton
            icon={shellIcons.leftPanel}
            label={t("shell.button.toggle-left")}
            size="sm"
            onClick={onToggleLeft}
          />
          {left ? (
            <span className={styles.brand}>
              <Avatar
                profile={{ kind: "character", shape: "square", color: "coral" }}
                size="sm"
              />
              lophn
            </span>
          ) : null}
          {deskSwitcher}
          {left ? (
            <>
              <span className={styles.grow} />
              <IconButton
                icon={shellIcons.search}
                label={t("shell.button.search")}
                size="sm"
                onClick={onSearch}
              />
            </>
          ) : null}
        </div>

        <div className={styles.tabs}>{tabs}</div>

        <div className={styles.titleRight}>
          {right ? panelTabs : null}
          <span className={styles.grow} />
          <IconButton
            icon={shellIcons.rightPanel}
            label={t("shell.button.toggle-right")}
            size="sm"
            onClick={onToggleRight}
          />
          {platform === "mac" || !windowApi ? null : (
            <span className={styles.windowControls}>
              <WindowButtons api={windowApi} />
            </span>
          )}
        </div>
      </header>

      <div className={styles.body}>
        {left ? <nav className={styles.left}>{leftSidebar}</nav> : null}
        <main className={styles.stage}>
          {children}
          {floats}
        </main>
        {right ? <aside className={styles.right}>{rightSidebar}</aside> : null}
      </div>
    </div>
  );
}
