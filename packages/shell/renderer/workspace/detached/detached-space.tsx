import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Loading, Skeleton } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import type {
  DetachedBounds,
  DetachedTaken,
  LophnDetachedApi,
  TabTransfer,
} from "../../../ipc/detached.ts";
import { slimDetachedTab } from "../../../ipc/detached.ts";
import { TabStateDot } from "../../parts/tab-state-dot/tab-state-dot.tsx";
import { TopBar } from "../../desktop/top-bar/top-bar.tsx";
import { actionIcons, workspaceIcons } from "../../icons/mod.ts";
import { ViewKeepsProvider } from "../../app-frame/embedded-view.tsx";
import { DetachedWindowProvider } from "../../browser/detached-window.ts";
import {
  WebviewHostProvider,
  WebviewLayer,
} from "../../app-frame/webview-host.tsx";
import type { EditorDeps } from "../../editor/document-view.tsx";
import type { TerminalDeps } from "../../terminal/deps.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import type { ProjectView, WorkspaceSource } from "../source.ts";
import { useTabHostSlices } from "../use-tab-host-slices.ts";
import { tabKindOf } from "../kinds/registry.ts";
import type { TabHost } from "../kinds/host.ts";
import { allTabs, type TabItem, type WorkspaceView } from "../model.ts";
import type { WorkspaceProps } from "../workspace.tsx";
import styles from "./detached-space.module.css";

interface DetachedSpaceProps {
  api: LophnDetachedApi;
  workspace: WorkspaceSource;
  editor?: EditorDeps;
  terminal?: TerminalDeps;
  agentViewSource?: AgentTabSourceFactory;
}

// take()는 bounds를 주지 않는다. 이 창에서는 읽는 곳이 없어 자리표시다.
const BOUNDS: DetachedBounds = { x: 0, y: 0, width: 1, height: 1 };

// 상단 바 높이. main/desktop/window.ts의 TOP_BAR_HEIGHT와 같다. features의 크기는 page 영역이라 더한다.
const TOP_BAR_HEIGHT = 36;

// popup을 이 창 가운데에 popup 크기로 연다. 화면 밖으로 나가는 것은 main이 작업 영역 안으로 당긴다.
function centeredOnOpener(size: {
  readonly width: number;
  readonly height: number;
}): DetachedBounds {
  const width = Math.round(size.width);
  const height = Math.round(size.height + TOP_BAR_HEIGHT);
  return {
    x: Math.round(globalThis.screenX + (globalThis.outerWidth - width) / 2),
    y: Math.round(globalThis.screenY + (globalThis.outerHeight - height) / 2),
    width,
    height,
  };
}

type Taken =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; taken: DetachedTaken };

// detached 창 하나. 탭 하나를 받아 그리고, [Dock]이나 창 닫기가 그 탭을 project 창으로 돌려보낸다.
export function DetachedSpace(props: DetachedSpaceProps): ReactElement {
  const { api } = props;
  const [attempt, setAttempt] = useState(0);
  const [taken, setTaken] = useState<Taken>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setTaken({ state: "loading" });
    api.take().then(
      (value) => live && setTaken({ state: "ready", taken: value }),
      () => live && setTaken({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [api, attempt]);
  // 탭을 받지 못했으면 창은 [Reload]만 두고 dock-request는 듣지 않는다. 창 닫기(dock-request)에 remove를 부르면 project 창이 탭을 버리므로
  // 일시적 실패가 탭을 잃게 한다. 창이 정말 사라지면 main이 저장된 값으로 돌려보낸다.

  if (taken.state === "ready") {
    return <DetachedTab {...props} taken={taken.taken} />;
  }
  return (
    <div className={styles.window}>
      <TopBar />
      <div className={styles.body}>
        <Loading
          loading={taken.state === "loading"}
          placeholder={<Skeleton lines={2} />}
        >
          <div className={styles.failed} data-detached-failed>
            <p>{t("project-workspace.error.load-failed")}</p>
            <Button
              icon={actionIcons.refresh}
              onClick={() => setAttempt((count) => count + 1)}
            >
              {t("common.button.reload")}
            </Button>
          </div>
        </Loading>
      </div>
    </div>
  );
}

function DetachedTab({
  api,
  workspace,
  editor,
  terminal,
  agentViewSource,
  taken,
}: DetachedSpaceProps & { taken: DetachedTaken }) {
  const { project } = taken;
  // DetachedTab은 key와 kind만 적은 모양이라 나머지 칸은 TabItem으로 읽는다.
  const [tab, setTab] = useState(taken.tab as TabItem);
  const tabRef = useRef(tab);
  const def = tabKindOf(tab.kind);

  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  useEffect(() => {
    let live = true;
    void workspace.project(project).then((read) => {
      if (live && read.ok) setProjectView(read.value);
    });
    return () => {
      live = false;
    };
  }, [workspace, project]);

  // 앱 화면을 여는 길(Settings 등)은 이 창에 없다.
  const noop = () => {};
  const { agentView, agents, keeps, webviews } = useTabHostSlices({
    project,
    source: workspace,
    agentViewSource,
    terminalStore: terminal?.store,
    floats: false,
    host: () => hostRef.current,
    onSettings: noop,
  });
  const key = taken.tab.key;
  useEffect(() => () => webviews.release(key), [webviews, key]);
  useEffect(() => () => terminal?.displays.release(key), [terminal, key]);

  const view = useMemo<WorkspaceView>(
    () => ({
      panes: [{ tabs: [], selected: null }],
      layout: "leaf",
      focusedPane: 0,
      floats: [],
      detached: [{ tab, bounds: BOUNDS }],
    }),
    [tab],
  );

  const hostProps: WorkspaceProps = {
    projectId: project,
    source: workspace,
    windowWidth: globalThis.innerWidth,
    onLauncher: noop,
    onSettings: noop,
    editor,
    terminal,
    agentViewSource,
  };

  const host: TabHost = {
    projectId: project,
    projectTitle: projectView?.title,
    explorerRoot: undefined,
    props: hostProps,
    appScreens: false,
    view,
    windowTabs: () => allTabs(view),
    viewKeeps: keeps,
    // 이 창에는 탭 줄이 없다. project 창에 docked로 연다.
    openTab: (next) => {
      void api.openTab({ tab: slimDetachedTab(next) }).catch(() => {});
    },
    // 크기 준 popup(adopt)만 또 하나의 detached 창으로 옮긴다. DevTools 패널 같은 것은 이 창에 둘 수 없다.
    openFloat: (next, size) => {
      const adopt = next.fields?.adopt;
      if (typeof adopt !== "string") return;
      void api
        .open({
          project,
          tab: slimDetachedTab(next),
          transfer: { value: null, views: [adopt] },
          bounds: size === undefined ? null : centeredOnOpener(size),
        })
        .catch(() => {});
    },
    patchTab: (target, patch) => {
      if (target !== tabRef.current.key) return;
      const current = tabRef.current;
      const next = {
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      };
      tabRef.current = next;
      setTab(next);
      void api.changed({ tab: slimDetachedTab(next) }).catch(() => {});
    },
    // DevTools 패널처럼 이 창에 없는 탭을 지우는 호출이 창을 닫지 않게 이 탭의 key만 받는다.
    removeTab: (target) => {
      if (target === tabRef.current.key) void api.remove().catch(() => {});
    },
    document: { noteReadPosition: noop },
    agents,
    agentView,
  };
  const hostRef = useRef(host);
  hostRef.current = host;

  // transfer가 낸 값은 그리기 전에 한 번 받는다.
  const received = useRef(false);
  if (!received.current) {
    received.current = true;
    if (taken.transfer !== null) def?.receive?.(tab, taken.transfer, host);
  }

  // project를 떠나 이 창이 조용히 닫힌 뒤 같은 탭이 다시 열릴 때 main이 쓸 값(terminal의 PTY 참조)을 알린다.
  // 창마다 TerminalStore가 따로라 참조는 여기서만 안다. 탭 값이 아니라 layout에 저장되지 않는다.
  const reportedResume = useRef<string | undefined>(undefined);
  const reportResume = () => {
    const resume = def?.resume?.(tabRef.current, hostRef.current);
    if (resume === undefined) return;
    const json = JSON.stringify(resume);
    if (json === reportedResume.current) return;
    reportedResume.current = json;
    void api
      .changed({ tab: slimDetachedTab(tabRef.current), resume })
      .catch(() => {});
  };
  const reportResumeRef = useRef(reportResume);
  reportResumeRef.current = reportResume;
  const terminalStore = terminal?.store;
  useEffect(() => {
    reportResumeRef.current();
    return terminalStore?.subscribe(() => reportResumeRef.current());
  }, [terminalStore]);

  // [Dock]과 창 닫기는 같은 흐름이다. transfer가 null이거나 dock이 거절되면 창과 탭은 그대로다.
  const docking = useRef(false);
  const dock = async () => {
    if (docking.current) return;
    docking.current = true;
    try {
      const current = hostRef.current;
      const transfer: TabTransfer | null = def?.transfer
        ? await def.transfer(tabRef.current, current)
        : { value: null, views: [] };
      if (transfer === null) return;
      // transfer가 탭을 바꿨을 수 있어 지금 값을 다시 읽는다.
      await api.dock({ tab: slimDetachedTab(tabRef.current), transfer });
    } catch {
      // 거절되면 창을 그대로 둔다.
    } finally {
      docking.current = false;
    }
  };
  const dockRef = useRef(dock);
  dockRef.current = dock;
  useEffect(
    () =>
      api.subscribe((event) => {
        if (event.kind === "dock-request") void dockRef.current();
      }),
    [api],
  );

  const label = t("project-workspace.button.detached-dock");
  const icon =
    def === undefined
      ? undefined
      : (def.iconOf?.(tab, host) ?? (
          <Icon icon={def.icon} pixels={iconPixels("small")} />
        ));
  const dot = def?.dotOf?.(tab, host) ?? null;
  const body =
    def === undefined
      ? null
      : (def.keep?.(tab, true, host) ?? def.render?.(tab, true, host) ?? null);

  return (
    <ViewKeepsProvider value={keeps}>
      <WebviewHostProvider value={webviews}>
        <DetachedWindowProvider value>
          <div className={styles.window}>
            <TopBar
              leading={
                <>
                  {icon}
                  <span className={styles.title} data-detached-title>
                    {tab.title}
                  </span>
                  {dot ? <TabStateDot dot={dot} /> : null}
                </>
              }
              trailing={
                <Tooltip content={label}>
                  <IconButton
                    icon={workspaceIcons.dock}
                    label={label}
                    size="sm"
                    data-detached-action="dock"
                    onClick={() => void dock()}
                  />
                </Tooltip>
              }
            />
            <div className={styles.body}>
              {body}
              <WebviewLayer host={webviews} />
            </div>
          </div>
        </DetachedWindowProvider>
      </WebviewHostProvider>
    </ViewKeepsProvider>
  );
}
