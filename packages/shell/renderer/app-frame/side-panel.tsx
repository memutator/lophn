// 앱 공간의 오른쪽 패널 하나. 머리는 TabStrip이고 열린 것이 탭이다: App details(운영 패널), Agent(Agent 화면, 또는
// Manage가 여는 앱 자리의 agent 관리 화면). 창이 넓으면 앱 화면 옆 열이고 좁으면 앱 화면을
// 덮는다. 덮는 동안에도 앱 view는 숨지 않고 패널이 덮지 않는 영역으로 준다. 탭 몸은 모두 mount해 두고 고르지 않은 것만
// 숨겨, 탭을 바꿔도 안의 상태(app-detail 탭, 대화 입력)를 잃지 않는다.
import { type ReactElement, type ReactNode, useMemo, useRef } from "react";
import { Avatar } from "../parts/avatar/avatar.tsx";
import { type TabItem, TabStrip } from "../parts/tab-strip/tab-strip.tsx";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { appSpaceIcons, conversationIcons } from "../icons/mod.ts";
import { t } from "@lophn/i18n";

import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { AgentView, type AgentViewHost } from "../conversation/agent-view.tsx";
import { useConversation } from "../conversation/window-deps.tsx";
import { DraftStore } from "../conversation/drafts.ts";
import { AgentsPage } from "../workspace/agents/agents-page.tsx";
import type { AgentsSource } from "../workspace/agents/source.ts";
import { RunList, type RunRow } from "../workspace/sidebar/run-list.tsx";
import type { AppSpaceAgent } from "./agent-select.tsx";
import { useViewCover } from "./embedded-view.tsx";
import type { SettingsPane } from "../desktop/settings/model.ts";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import styles from "./side-panel.module.css";

/** 탭이 무엇이든 폭은 하나다. 탭을 바꿔도 앱 view 자리가 흔들리지 않는다. */
const SIDE_PANEL_WIDTH = 640;
/** 패널을 열고도 앱 화면이 이만큼은 남아야 옆 열이다. 아니면 덮는다. */
const SIDE_PANEL_BODY_MIN = 480;

type SidePanelPlacement = "hidden" | "docked" | "overlay";

export function sidePanelPlacement(
  open: boolean,
  contentWidth: number,
): SidePanelPlacement {
  if (!open) return "hidden";
  return contentWidth - SIDE_PANEL_WIDTH >= SIDE_PANEL_BODY_MIN
    ? "docked"
    : "overlay";
}

/** agent 탭이 보이는 것. agent는 열린 agent와 그 session(null은 새 session), manage는 editor로 열어 둔 agent, runs는 이 앱의 Background 목록이다. */
export type AgentPaneState =
  | {
      readonly mode: "agent";
      readonly assignment: string;
      readonly session: string | null;
    }
  | { readonly mode: "manage"; readonly agent: string | null }
  | { readonly mode: "runs" };

export type PanelTab = "details" | "agent";

interface SidePanelProps {
  /** 열린 탭들. 순서대로 줄에 선다. 비어 있으면 패널이 없다. */
  tabs: readonly PanelTab[];
  /** 보이는 탭. tabs 가운데 하나다. */
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** 탭을 닫았다. */
  onCloseTab: (tab: PanelTab) => void;
  placement: SidePanelPlacement;
  /** App details 탭의 내용. */
  details: ReactNode;
  /** agent 탭이 보이는 것. details만 열려 있으면 없다. */
  state: AgentPaneState | null;
  app: string;
  appName: string;
  /** agent 통로. 없으면 agent 탭을 열 수 없다. */
  source?: AgentsSource;
  /** select와 같은 목록. agent 탭의 이름과 avatar를 찾는다. */
  agents: readonly AppSpaceAgent[];
  /** `runs` mode의 목록. 새것부터다. */
  runs?: readonly RunRow[];
  /** 없으면 Agent 화면을 열 수 없다("준비 안 됨"). */
  agentViewSource?: AgentTabSourceFactory;
  onState: (state: AgentPaneState) => void;
  /** Settings로 간다(기본 model·확장 등록·연결). */
  onSettings?: (pane?: SettingsPane) => void;
  /** 목록이나 정의가 바뀌었다. select가 다시 읽는다. */
  onChanged: () => void;
}

export function SidePanel(props: SidePanelProps): ReactElement | null {
  const ref = useRef<HTMLElement>(null);
  useViewCover(ref, props.placement === "overlay");
  const { state, tab } = props;
  if (props.tabs.length === 0) return null;
  const agentBody =
    state === null ? null : state.mode === "manage" ? (
      <ManageBody {...props} agent={state.agent} />
    ) : state.mode === "runs" ? (
      <RunsBody {...props} />
    ) : props.agentViewSource === undefined ? (
      <NotReady />
    ) : (
      <AgentBody
        key={state.assignment}
        {...props}
        factory={props.agentViewSource}
        assignment={state.assignment}
        session={state.session}
      />
    );
  const shown = (name: PanelTab) => (tab === name ? "" : styles.hidden);
  return (
    <aside
      ref={ref}
      className={`${styles.pane} ${
        props.placement === "overlay" ? styles.overlay : ""
      } ${props.placement === "hidden" ? styles.hidden : ""}`}
      data-side-panel={props.placement}
      data-side-panel-tab={tab}
      style={{ width: `${SIDE_PANEL_WIDTH}px` }}
    >
      <Head {...props} />
      {props.tabs.includes("details") ? (
        <div className={`${styles.details} ${shown("details")}`}>
          {props.details}
        </div>
      ) : null}
      {agentBody === null ? null : (
        <div className={`${styles.body} ${shown("agent")}`}>{agentBody}</div>
      )}
    </aside>
  );
}

function Head(props: SidePanelProps): ReactElement {
  const { state, agents } = props;
  const agent =
    state?.mode === "agent"
      ? agents.find((item) => item.assignment === state.assignment)
      : undefined;
  const items: Record<PanelTab, TabItem | null> = {
    details: {
      key: "details",
      title: t("app-space.heading.app-details"),
      icon: (
        <Icon icon={appSpaceIcons.appDetails} pixels={iconPixels("small")} />
      ),
    },
    agent:
      state === null
        ? null
        : {
            key: "agent",
            title:
              state.mode === "manage"
                ? t("app-space.button.manage-agents")
                : state.mode === "runs"
                  ? t("run-list.heading.background")
                  : (agent?.name ?? t("app-space.heading.agents")),
            icon:
              agent === undefined ? (
                <Icon
                  icon={conversationIcons.dock}
                  pixels={iconPixels("small")}
                />
              ) : (
                <Avatar profile={agent.profile} size="sm" />
              ),
          },
  };
  const tabs = props.tabs.flatMap((name) => items[name] ?? []);
  return (
    <TabStrip
      tabs={tabs}
      selected={props.tab}
      onSelect={(key) => props.onTab(key as PanelTab)}
      onClose={(key) => props.onCloseTab(key as PanelTab)}
    />
  );
}

function NotReady(): ReactElement {
  return (
    <p className={styles.state} data-agent-not-ready="">
      {t("app-space.empty.agent-not-ready")}
    </p>
  );
}

function AgentBody(
  props: SidePanelProps & {
    factory: AgentTabSourceFactory;
    assignment: string;
    session: string | null;
  },
): ReactElement {
  const { factory, assignment, app, onState } = props;
  const source = useMemo(
    () => factory({ assignment, place: { kind: "app", id: app } }),
    [factory, assignment, app],
  );
  // 창마다 하나인 입력 메모리가 있으면 그것을 쓴다. 없는 창은 이 칸이 하나 쥔다.
  const shared = useConversation()?.drafts;
  const local = useMemo(() => new DraftStore(), []);
  const host: AgentViewHost = {
    // 권한 요약은 같은 칸의 관리 화면으로 간다.
    openPermissions: () => onState({ mode: "manage", agent: null }),
    openAgentSettings: () => props.onSettings?.("tools"),
    // Fork가 만든 session은 같은 칸에서 연다.
    openForked: (session) => onState({ mode: "agent", assignment, session }),
    // 이 앱의 session이면 이 칸, 아니면 그 session의 창으로 간다(toast의 [Open]과 같은 길).
    openSession: (session) => runToastAction({ kind: "session", session }),
    // 사용량 화면은 아직 이 칸에 없다.
    showUsage: () => {},
    closeTab: () => props.onCloseTab("agent"),
    ...(props.onSettings === undefined
      ? {}
      : {
          openConnections: () => props.onSettings?.("providers"),
        }),
  };
  return (
    <div className={styles.agent}>
      <AgentView
        source={source}
        drafts={shared ?? local}
        session={props.session}
        onSessionChange={(session) =>
          onState({ mode: "agent", assignment, session })
        }
        host={host}
      />
    </div>
  );
}

function ManageBody(props: SidePanelProps & { agent: string | null }) {
  if (props.source === undefined) return null;
  return (
    <div className={styles.manage}>
      <AgentsPage
        project={props.app}
        projectName={props.appName}
        source={props.source}
        agent={props.agent}
        onAgent={(agent) => props.onState({ mode: "manage", agent })}
        onAddExtension={() => props.onSettings?.("tools")}
        onChanged={props.onChanged}
      />
    </div>
  );
}

// session 줄을 누르면 같은 칸에 그 agent의 Agent 화면이 그 session으로 열린다.
function RunsBody(props: SidePanelProps) {
  const runs = props.runs ?? [];
  return (
    <div className={styles.runs} data-runs-pane="">
      {runs.length === 0 ? (
        <p className={styles.state} data-runs-empty="">
          {t("run-list.empty.none")}
        </p>
      ) : (
        <RunList
          runs={runs}
          onSession={(session) =>
            props.onState({
              mode: "agent",
              assignment: session.agent,
              session: session.id,
            })
          }
        />
      )}
    </div>
  );
}
