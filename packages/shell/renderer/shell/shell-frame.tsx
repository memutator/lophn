// 새 shell의 창 틀. title bar(왼쪽 구역, tab 줄, 오른쪽 구역)와 몸통(왼쪽 sidebar, 둥근 card가 서는 stage, 오른쪽 sidebar),
// 맨 아래 작업 표시줄(선택)이다.
// 내용은 모두 slot으로 받는다: 틀은 칸의 폭, 접힘, 창 끌기 영역과 OS별 자리만 안다.

import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";

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
  /** 없으면 오른쪽 sidebar 단추를 그리지 않는다(오른쪽 sidebar가 없는 Settings). */
  onToggleRight?: () => void;
  /** 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
  /** 창 단추 통로. 기본은 preload가 둔 통로이고 없으면 단추를 그리지 않는다. */
  windowApi?: WindowControlsApi;
  /** 왼쪽 구역의 desk 단추(DeskSwitcher). project workspace에만 둔다. */
  deskSwitcher?: ReactNode;
  /** 가운데 tab 줄(TabStrip). */
  tabs: ReactNode;
  /** 오른쪽 구역의 panel icon tab(PanelTabs). */
  panelTabs?: ReactNode;
  /**
   * 작업 표시줄이 꺼져 있을 때 tray 항목(Tray). 오른쪽 sidebar가 열려 있으면 그 아래 끝(작업 표시줄의 tray와 같은 구석)에,
   * 닫혀 있으면 title bar 오른쪽 구역의 sidebar 단추 옆에 선다. side는 popup이 열리는 쪽이다.
   */
  tray?: (side: "above" | "below") => ReactNode;
  leftSidebar: ReactNode;
  rightSidebar?: ReactNode;
  /** 몸통(title bar 아래, 양쪽 sidebar 포함) 전체를 덮는 층(webview 그릇과 FloatLayer). float 패널이 sidebar 위로도 간다. */
  floats?: ReactNode;
  /** 창 맨 아래 작업 표시줄(Taskbar). 있으면 몸통 아래 마지막 줄이 되고 stage의 아래 여백이 없어진다. */
  taskbar?: ReactNode;
  /** 작업 표시줄의 왼쪽 끝(빠른 실행). 왼쪽 sidebar가 펼쳐져 있으면 그 폭과 같아서 `taskbar`는 card가 시작하는 곳에서 시작한다. */
  taskbarStart?: ReactNode;
  /** 가운데 card(ContentCard). */
  children: ReactNode;
}

type Side = "left" | "right";

// 폭은 창 UI 설정이라 사용자 data가 아니다. 쪽마다 localStorage에 둔다.
const WIDTH_KEY = (side: Side) => `lophn.shell.sidebar-width.${side}`;

// 오른쪽은 workspace마다 따로 기억한다(workspace key가 붙는다). 왼쪽은 workspace와 무관하게 하나다.
const OPEN_KEY = (side: Side, workspace?: string) =>
  workspace === undefined
    ? `lophn.shell.sidebar-open.${side}`
    : `lophn.shell.sidebar-open.${side}.${workspace}`;

/** sidebar 열림. 저장한 값이 있으면 그것이 이기고 없으면 fallback이다. workspace를 주면 그 workspace만의 값이다. */
export function useSidebarOpen(
  side: Side,
  fallback: boolean,
  workspace?: string,
): [boolean, (open: boolean | ((open: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(() => {
    const stored = globalThis.localStorage?.getItem(OPEN_KEY(side, workspace));
    return stored === null || stored === undefined
      ? fallback
      : stored === "true";
  });
  const set = useCallback(
    (next: boolean | ((open: boolean) => boolean)) =>
      setOpen((current) => {
        const value = typeof next === "function" ? next(current) : next;
        globalThis.localStorage?.setItem(
          OPEN_KEY(side, workspace),
          String(value),
        );
        return value;
      }),
    [side, workspace],
  );
  return [open, set];
}

function loadWidth(side: Side): number | null {
  const value = Number(globalThis.localStorage?.getItem(WIDTH_KEY(side)));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** 안쪽 가장자리의 폭 끌기 손잡이. 폭의 범위는 CSS가 clamp하고 여기서는 같은 값으로 끌기를 멈춘다. */
function Resizer({
  side,
  width,
  onWidth,
}: {
  side: Side;
  /** 끌기 시작 때 sidebar의 실제 폭을 읽는 칸. */
  width: RefObject<HTMLElement | null>;
  onWidth: (px: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width: 0, min: 0, max: 0 });
  const bounds = (box: HTMLElement) => {
    // 범위의 정본은 token(--layout-sidebar-min/max)과 칸의 CSS min-width다.
    const style = getComputedStyle(box);
    const token = (name: string, fallback: number) => {
      const value = Number.parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    return {
      min: Math.max(
        token("--layout-sidebar-min", 200),
        Number.parseFloat(style.minWidth) || 0,
      ),
      max: token("--layout-sidebar-max", 400),
    };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const { x, width: from, min, max } = start.current;
    const delta = event.clientX - x;
    const next = side === "left" ? from + delta : from - delta;
    onWidth(Math.round(Math.min(max, Math.max(min, next))));
  };
  return (
    <div
      className={styles.resizer}
      data-side={side}
      data-dragging={dragging || undefined}
      data-sidebar-resizer={side}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(event) => {
        const box = width.current;
        if (box === null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = {
          x: event.clientX,
          width: box.getBoundingClientRect().width,
          ...bounds(box),
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (dragging) move(event);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    />
  );
}

export function ShellFrame({
  left,
  onToggleLeft,
  right,
  onToggleRight,
  platform = currentPlatform(),
  windowApi = bridge(),
  deskSwitcher,
  tabs,
  panelTabs,
  tray,
  leftSidebar,
  rightSidebar,
  floats,
  taskbar,
  taskbarStart,
  children,
}: ShellFrameProps) {
  const [widths, setWidths] = useState<Record<Side, number | null>>(() => ({
    left: loadWidth("left"),
    right: loadWidth("right"),
  }));
  const leftBox = useRef<HTMLElement>(null);
  const rightBox = useRef<HTMLElement>(null);
  const setWidth = (side: Side) => (px: number) => {
    setWidths((current) => ({ ...current, [side]: px }));
    globalThis.localStorage?.setItem(WIDTH_KEY(side), String(px));
  };
  // 저장된 폭이 범위를 벗어나도 CSS clamp가 token 범위로 되돌린다. 오른쪽의 하한은 CSS min-width다.
  const widthOf = (side: Side) =>
    widths[side] === null
      ? undefined
      : `clamp(var(--layout-sidebar-min), ${widths[side]}px, var(--layout-sidebar-max))`;
  const leftWidth = widthOf("left");
  const rightWidth = widthOf("right");
  const titleLeftWidth =
    leftWidth === undefined || platform !== "mac"
      ? leftWidth
      : `calc(${leftWidth} + var(--space-12))`;
  return (
    <div
      className={styles.shell}
      data-platform={platform}
      data-left={left ? "open" : "closed"}
      data-right={right ? "open" : "closed"}
      data-has-taskbar={taskbar === undefined ? undefined : ""}
    >
      <header className={styles.titlebar}>
        <div
          className={styles.titleLeft}
          style={left ? { width: titleLeftWidth } : undefined}
        >
          <IconButton
            icon={shellIcons.leftPanel}
            label={t("shell.button.toggle-left")}
            size="sm"
            onClick={onToggleLeft}
          />
          {left ? (
            <span className={styles.brand}>
              <Avatar
                look={{ kind: "character", shape: "square", color: "coral" }}
                size="sm"
              />
              <span className={styles.brandName}>lophn</span>
            </span>
          ) : null}
          <span className={styles.grow} />
          {deskSwitcher}
        </div>

        <div className={styles.tabs}>{tabs}</div>

        <div
          className={styles.titleRight}
          style={right ? { width: rightWidth } : undefined}
        >
          {right ? panelTabs : null}
          <span className={styles.grow} />
          {taskbar === undefined && !right ? tray?.("below") : null}
          {onToggleRight ? (
            <IconButton
              icon={shellIcons.rightPanel}
              label={t("shell.button.toggle-right")}
              size="sm"
              onClick={onToggleRight}
            />
          ) : null}
          {platform === "mac" || !windowApi ? null : (
            <span className={styles.windowControls}>
              <WindowButtons api={windowApi} />
            </span>
          )}
        </div>
      </header>

      <div className={styles.body}>
        {left ? (
          <nav
            ref={leftBox}
            className={styles.left}
            style={{ width: leftWidth }}
          >
            {leftSidebar}
            <Resizer side="left" width={leftBox} onWidth={setWidth("left")} />
          </nav>
        ) : null}
        <main className={styles.stage}>{children}</main>
        {right ? (
          <aside
            ref={rightBox}
            className={styles.right}
            style={{ width: rightWidth }}
          >
            {rightSidebar}
            {taskbar === undefined && tray !== undefined ? (
              <div className={styles.rightTray}>{tray("above")}</div>
            ) : null}
            <Resizer
              side="right"
              width={rightBox}
              onWidth={setWidth("right")}
            />
          </aside>
        ) : null}
        {floats}
      </div>

      {taskbar === undefined ? null : (
        <footer
          className={styles.taskbar}
          data-taskbar=""
          aria-label={t("shell.label.taskbar")}
        >
          <div
            className={styles.taskbarStart}
            style={left ? { minWidth: leftWidth } : undefined}
          >
            {taskbarStart}
          </div>
          <div className={styles.taskbarMain}>{taskbar}</div>
        </footer>
      )}
    </div>
  );
}
