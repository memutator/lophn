// 자리(desk) selector를 가진 project 창. 실제 Workspace 전체는 wiring 전이라 쓰지 않고, 실제 TopBar(`center`)·DeskSelector·
// Breadcrumbs·MinimizedBar·Floats·TabStrip과 본문 조각으로 그린다. 탭·floated·접힘 규칙은 workspace/model.ts의 같은 함수다.
// 자리를 바꾸면 pane의 탭, floated 패널, 접힌 span이 그 자리 것으로 통째로 바뀐다.
import { type ReactNode, useRef, useState } from "react";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import {
  PaletteButton,
  TopBar,
} from "../../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import type { WindowPlatform } from "../../../../../packages/shell/renderer/desktop/top-bar/platform.ts";
import { LauncherButton } from "../../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import { Breadcrumbs } from "../../../../../packages/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import {
  type DeskOption,
  DeskSelector,
} from "../../../../../packages/shell/renderer/workspace/top-path/desk-selector.tsx";
import { MinimizedBar } from "../../../../../packages/shell/renderer/workspace/minimized/minimized-bar.tsx";
import { Floats } from "../../../../../packages/shell/renderer/workspace/floats/floats.tsx";
import { TabStrip } from "../../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import {
  breadcrumbs,
  closeFloat,
  closeTab,
  dockTab,
  minimizeFloat,
  raiseFloat,
  restoreFloat,
  setFloatRect,
  type TabItem,
  type WorkspaceView,
} from "../../../../../packages/shell/renderer/workspace/model.ts";
import workspace from "../../../../../packages/shell/renderer/workspace/workspace.module.css";
import paneStyles from "../../../../../packages/shell/renderer/workspace/panes/panes.module.css";
import { GalleryConnectHost } from "../../../mock/connect-host.tsx";
import { TerminalBody } from "../bodies.tsx";
import { DocumentPane } from "../documents.tsx";
import { PageSidebar, stripTabsOf, type TabSpec } from "../project-window.tsx";
import { DEFAULT_KEY, LAYOUTS } from "./desks.ts";

const specOf = (tab: TabItem): TabSpec => ({
  key: tab.key,
  kind: tab.kind === "terminal" ? "terminal" : "document",
  title: tab.title,
  sub: tab.key,
});
const stripTab = (tab: TabItem) => stripTabsOf([specOf(tab)])[0]!;

/** 상단 바. 가운데에 selector를 놓는다. 왼쪽과 platform은 부르는 쪽이 정한다. */
export function DeskBar(
  { platform, leading, center }: {
    platform: WindowPlatform;
    leading: ReactNode;
    center?: ReactNode;
  },
) {
  return (
    <div className={workspace.topBar}>
      <TopBar
        platform={platform}
        leading={<div className={workspace.leading}>{leading}</div>}
        center={center}
        trailing={
          <div className={workspace.trailing}>
            <PaletteButton />
          </div>
        }
      />
    </div>
  );
}

export interface DeskWindowProps {
  readonly options: readonly DeskOption[];
  /** 시작할 때 켜진 자리. */
  readonly active?: string;
  /** 접힌 sidebar로 시작한다. */
  readonly collapsed?: boolean;
  /** 창 폭(px). 없으면 gallery 창 전체다. */
  readonly width?: number;
  readonly platform?: WindowPlatform;
}

export function DeskWindow(
  {
    options,
    active: first = DEFAULT_KEY,
    collapsed: firstCollapsed = false,
    width,
    platform = "linux",
  }: DeskWindowProps,
) {
  const [active, setActive] = useState(first);
  const [collapsed, setCollapsed] = useState(firstCollapsed);
  const [views, setViews] = useState(LAYOUTS);
  const view = views[active]!;
  const update = (next: (current: WorkspaceView) => WorkspaceView) =>
    setViews((current) => ({ ...current, [active]: next(current[active]!) }));
  const content = useRef<HTMLDivElement>(null);
  const area = useObservedSize(content);

  const renderTab = (tab: TabItem): ReactNode =>
    tab.kind === "terminal" ? <TerminalBody /> : (
      <DocumentPane
        path={tab.key}
        info={null}
        editing={false}
        onEditing={() => {}}
      />
    );

  // 고를 것이 없으면(기본 자리뿐) selector를 두지 않는다.
  const center = options.length > 1
    ? (
      <DeskSelector
        options={options}
        active={active}
        onSelect={setActive}
      />
    )
    : undefined;

  return (
    <GalleryConnectHost>
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          overflow: "hidden",
          background: "var(--color-surface-base)",
          ...(width === undefined ? { right: 0 } : {
            width,
            borderRight: "var(--border-width) solid var(--color-border-base)",
          }),
        }}
      >
        <PageSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          onRail={() => {}}
          onOpenFile={() => {}}
          onAgent={() => {}}
          onManage={() => {}}
        />
        <div className={workspace.main}>
          <DeskBar
            platform={platform}
            center={center}
            leading={
              <>
                {collapsed ? <LauncherButton onLauncher={() => {}} /> : null}
                <Breadcrumbs crumbs={breadcrumbs("phroner", view)} />
                <MinimizedBar
                  items={view.floats.filter((item) => item.minimized)}
                  stripTab={stripTab}
                  onRestore={(key) => update((v) => restoreFloat(v, key))}
                  onDock={(key) => update((v) => dockTab(v, key))}
                  onClose={(key) => update((v) => closeFloat(v, key))}
                />
              </>
            }
          />
          <div ref={content} className={workspace.content}>
            <div className={paneStyles.panes}>
              {view.panes.map((pane, index) => {
                const tab = pane.tabs.find((item) =>
                  item.key === pane.selected
                );
                return (
                  <section key={index} className={paneStyles.pane}>
                    <TabStrip
                      tabs={stripTabsOf(pane.tabs.map(specOf))}
                      selected={pane.selected ?? ""}
                      focused={index === view.focusedPane}
                      onSelect={(key) =>
                        update((v) => ({
                          ...v,
                          focusedPane: index,
                          panes: v.panes.map((item, at) =>
                            at === index ? { ...item, selected: key } : item
                          ),
                        }))}
                      onClose={(key) => update((v) => closeTab(v, index, key))}
                    />
                    <div className={`${paneStyles.body} ${paneStyles.flush}`}>
                      {tab === undefined
                        ? <p>{t("project-workspace.empty.no-tabs")}</p>
                        : renderTab(tab)}
                    </div>
                  </section>
                );
              })}
            </div>
            <Floats
              floats={view.floats}
              focused
              area={area}
              stripTab={stripTab}
              renderTab={renderTab}
              renderKept={() => null}
              onRaise={(key) => update((v) => raiseFloat(v, key))}
              onRect={(key, rect) => area === undefined
                ? undefined
                : update((v) => setFloatRect(v, key, rect, area))}
              onMinimize={(key) => update((v) => minimizeFloat(v, key))}
              onDock={(key) => update((v) => dockTab(v, key))}
              onClose={(key) => update((v) => closeFloat(v, key))}
            />
          </div>
        </div>
      </div>
    </GalleryConnectHost>
  );
}
