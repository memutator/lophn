// 동작하는 project 화면. 칸마다 탭 줄이 있고, 바로 가기 rail·sidebar·검색 결과의 링크가 탭을 열면 탭 줄에
// 그 탭이 생기고 선택된다(이미 열린 탭이면 그 탭을 고른다). 실제 TopBar·Breadcrumbs를 쓰고 sidebar·tab strip은
// project-window.tsx의 look-alike다.
import { type ReactNode, useRef, useState } from "react";

import { TopBar } from "../../../../apps/shell/renderer/desktop/top-bar/top-bar.tsx";
import { Breadcrumbs } from "../../../../apps/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import { LauncherButton } from "../../../../apps/shell/renderer/workspace/launcher-button.tsx";
import { IconButton, paletteIcons } from "@lophn/design/components";

import {
  ContextsBody,
  Conversation,
  documentTab,
  ObjectBody,
  SearchBody,
  TerminalBody,
} from "./bodies.tsx";
import { ContextBody, type SubTab } from "./context-body.tsx";
import {
  DocumentBody,
  ProjectSidebar,
  type RailAction,
  type SidebarSpec,
  TabBar,
  type TabSpec,
} from "./project-window.tsx";
import styles from "./compose.module.css";

export interface PaneInit {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
}

export interface ProjectAppProps {
  readonly panes: readonly PaneInit[];
  readonly sidebar?: SidebarSpec;
  /** 첫 칸 위에 얹는 것(열린 메뉴). */
  readonly overlay?: ReactNode;
  /** 창 위에 얹는 것(toast). */
  readonly children?: ReactNode;
}

const FLUSH = new Set(["search", "conversation", "terminal"]);

function crumbsOf(tab: TabSpec | undefined): string[] {
  if (tab === undefined) return ["phroner"];
  switch (tab.kind) {
    case "document":
      return ["phroner", ...(tab.sub ?? tab.title).split("/")];
    case "context":
      return ["phroner", tab.title, "Context"];
    case "contexts":
      return ["phroner", "Contexts"];
    case "search":
      return ["phroner", "Search"];
    case "terminal":
      return ["phroner", "Terminal"];
    case "conversation":
      return ["phroner", "lophn"];
    case "object":
      return ["phroner", "eval", tab.label ?? "Object", tab.title];
  }
}

export function ProjectApp(
  { panes: initial, sidebar = {}, overlay, children }: ProjectAppProps,
) {
  const [panes, setPanes] = useState(
    initial.map((pane) => ({ tabs: [...pane.tabs], selected: pane.selected })),
  );
  const [collapsed, setCollapsed] = useState(sidebar.collapsed ?? false);
  const terminals = useRef(1);

  // 이미 열린 탭이면 그 칸에서 고르고, 아니면 첫 칸 끝에 더해 고른다.
  const open = (tab: TabSpec) =>
    setPanes((current) => {
      const at = current.findIndex((pane) =>
        pane.tabs.some((item) => item.key === tab.key)
      );
      const target = at === -1 ? 0 : at;
      return current.map((pane, index) =>
        index !== target ? pane : {
          tabs: at === -1 ? [...pane.tabs, tab] : pane.tabs,
          selected: tab.key,
        }
      );
    });

  const close = (key: string) =>
    setPanes((current) =>
      current.map((pane) => {
        const index = pane.tabs.findIndex((tab) => tab.key === key);
        if (index === -1) return pane;
        const tabs = pane.tabs.filter((tab) => tab.key !== key);
        const selected = pane.selected !== key
          ? pane.selected
          : (tabs[index] ?? tabs[index - 1])?.key ?? "";
        return { tabs, selected };
      })
    );

  const rail = (action: RailAction) => {
    if (action === "terminal") {
      terminals.current += 1;
      open({
        key: `terminal:${terminals.current}`,
        kind: "terminal",
        title: "phroner",
      });
    } else if (action === "search" || action === "saved") {
      open({ key: "search", kind: "search", title: "phroner" });
    } else if (action === "contexts") {
      open({ key: "contexts", kind: "contexts", title: "phroner" });
    } else {
      open({ key: "chat", kind: "conversation", title: "lophn" });
    }
  };

  const body = (tab: TabSpec): ReactNode => {
    switch (tab.kind) {
      case "document":
        return <DocumentBody name={tab.title} />;
      case "context":
        return (
          <ContextBody
            name={tab.title}
            initial={(tab.sub as SubTab | undefined) ?? "overview"}
          />
        );
      case "contexts":
        return <ContextsBody open={open} />;
      case "search":
        return (
          <SearchBody
            initial={tab.sub === "experiments" ? "experiments" : "findings"}
            typed={tab.sub === "typed"}
            open={open}
          />
        );
      case "terminal":
        return <TerminalBody />;
      case "conversation":
        return <Conversation />;
      case "object":
        return <ObjectBody target={tab.sub ?? ""} open={open} />;
    }
  };

  const focusTab = panes[0]?.tabs.find((tab) => tab.key === panes[0].selected);
  const crumbs = crumbsOf(focusTab);
  return (
    <div className={styles.window}>
      <ProjectSidebar
        {...sidebar}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        onRail={rail}
        onOpenFile={(id) => open(documentTab(id))}
        onOpenContext={(name) =>
          open({
            key: `context:${name}`,
            kind: "context",
            title: name,
            sub: "overview",
          })}
      />
      <div className={styles.main}>
        <div className={styles.topBar}>
          <TopBar
            platform="linux"
            leading={
              <div className={styles.leading}>
                {collapsed ? <LauncherButton onLauncher={() => {}} /> : null}
                <Breadcrumbs crumbs={crumbs.map((label) => ({ label }))} />
              </div>
            }
            trailing={
              <IconButton
                icon={paletteIcons.search}
                label="Search documents"
                variant="secondary"
              />
            }
          />
        </div>
        <div className={styles.panes}>
          {panes.map((pane, index) => (
            <section key={index} className={styles.pane}>
              <TabBar
                tabs={pane.tabs}
                selected={pane.selected}
                focused={index === 0}
                onSelect={(key) =>
                  setPanes((current) =>
                    current.map((item, at) =>
                      at === index ? { ...item, selected: key } : item
                    )
                  )}
                onClose={close}
              />
              {pane.tabs.map((tab) => (
                <div
                  key={tab.key}
                  hidden={tab.key !== pane.selected}
                  className={`${styles.body} ${
                    FLUSH.has(tab.kind) ? styles.flush : ""
                  }`}
                >
                  {body(tab)}
                </div>
              ))}
              {index === 0 ? overlay : null}
            </section>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
