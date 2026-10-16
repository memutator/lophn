// 앱 공간의 옆 pane. 앱 화면 옆에 agent 탭 하나(Agent 화면, 또는 Manage가 여는 앱 자리의 agent 관리 화면)와, lophn이 연
// coding 터미널이 있을 때만 터미널 탭을 둔다. 창이 넓으면 앱 화면 옆 열이고 좁으면 앱 화면을 덮는다. 덮는 동안에도 앱 view는
// 숨지 않고 pane이 덮지 않는 영역으로 준다.
import {
  type ReactElement,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Avatar,
  IconButton,
  type TabDot,
  type TabItem,
  TabStrip,
  Toast,
  Tooltip,
  VendorIcon,
  vendorOf,
} from "@lophn/design/components";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import type { AgentViewSourceFactory } from "../conversation/agent-source.ts";
import { AgentView, type AgentViewHost } from "../conversation/agent-view.tsx";
import { useConversation } from "../conversation/window-deps.tsx";
import { DraftStore } from "../conversation/drafts.ts";
import { useSessions } from "../desktop/connection/events/hooks.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import { TerminalTab } from "../terminal/terminal-tab.tsx";
import { AgentsPage } from "../workspace/agents/agents-page.tsx";
import type { AgentsSource } from "../workspace/agents/source.ts";
import { STAY } from "./annotate/use-view-toast.ts";
import type { AppSpaceAgent } from "./agent-select.tsx";
import { useViewCover } from "./embedded-view.tsx";
import styles from "./agent-pane.module.css";

export const AGENT_PANE_WIDTH = 480;
/** 칸을 열고도 앱 화면이 이만큼은 남아야 옆 열이다. 아니면 덮는다. */
export const AGENT_PANE_BODY_MIN = 480;

export type AgentPanePlacement = "hidden" | "docked" | "overlay";

export function agentPanePlacement(
  open: boolean,
  contentWidth: number,
): AgentPanePlacement {
  if (!open) return "hidden";
  return contentWidth - AGENT_PANE_WIDTH >= AGENT_PANE_BODY_MIN
    ? "docked"
    : "overlay";
}

/** agent 탭이 보이는 것. agent는 열린 agent와 그 session(null은 새 session), manage는 editor로 열어 둔 agent다. */
export type AgentPaneState =
  | {
    readonly mode: "agent";
    readonly assignment: string;
    readonly session: string | null;
  }
  | { readonly mode: "manage"; readonly agent: string | null };

export type PaneTab = "agent" | "terminal";

/** lophn이 연 coding 터미널 탭. */
export interface PaneTerminal {
  readonly key: string;
  readonly title: string;
  readonly project: string;
  readonly product: string;
  readonly session: string;
  readonly ticket: string;
}

export interface AgentPaneProps {
  state: AgentPaneState;
  placement: Exclude<AgentPanePlacement, "hidden">;
  app: string;
  appName: string;
  source: AgentsSource;
  /** select와 같은 목록. agent 탭의 이름과 avatar를 찾는다. */
  agents: readonly AppSpaceAgent[];
  /** 없으면 Agent 화면을 열 수 없다("준비 안 됨"). */
  agentViewSource?: AgentViewSourceFactory;
  /** 보이는 탭. */
  tab: PaneTab;
  onTab: (tab: PaneTab) => void;
  /** lophn이 연 coding 터미널. 있을 때만 터미널 탭이 있다. */
  coding?: { readonly tab: PaneTerminal; readonly deps: TerminalDeps };
  /** 터미널을 열었다는 알림을 머리 아래에 보인다. */
  opened: boolean;
  onOpenedClose: () => void;
  onState: (state: AgentPaneState) => void;
  onClose: () => void;
  onOpenResult?: (document: string) => void;
  /** app 층 LOPHN.md를 연다. */
  onInstructions?: () => void;
  /** Settings로 간다(기본 model·확장 등록·연결). */
  onSettings?: () => void;
  /** 목록이나 정의가 바뀌었다. select가 다시 읽는다. */
  onChanged: () => void;
}

export function AgentPane(props: AgentPaneProps): ReactElement {
  const ref = useRef<HTMLElement>(null);
  useViewCover(ref, props.placement === "overlay");
  const { state, coding } = props;
  const vendor = coding === undefined
    ? undefined
    : vendorOf(coding.tab.product);
  const tab: PaneTab = coding === undefined ? "agent" : props.tab;
  const agentBody = state.mode === "manage"
    ? <ManageBody {...props} agent={state.agent} />
    : props.agentViewSource === undefined
    ? <NotReady />
    : (
      <AgentBody
        key={state.assignment}
        {...props}
        factory={props.agentViewSource}
        assignment={state.assignment}
        session={state.session}
      />
    );
  return (
    <aside
      ref={ref}
      className={`${styles.pane} ${
        props.placement === "overlay" ? styles.overlay : ""
      }`}
      data-agent-pane={state.mode}
      data-agent-placement={props.placement}
      data-agent-pane-tab={tab}
      aria-label={t("app-space.heading.agents")}
      style={{ width: `${AGENT_PANE_WIDTH}px` }}
    >
      <Head {...props} tab={tab} />
      <div className={`${styles.body} ${tab === "agent" ? "" : styles.hidden}`}>
        {agentBody}
      </div>
      {coding !== undefined && tab === "terminal"
        ? (
          <div className={styles.body}>
            <TerminalTab
              key={coding.tab.key}
              tabKey={coding.tab.key}
              project={coding.tab.project}
              folderRef={null}
              active
              deps={coding.deps}
              coding={{
                product: coding.tab.product,
                session: coding.tab.session,
                app: props.app,
              }}
            />
          </div>
        )
        : null}
      {props.opened && coding !== undefined
        ? (
          <div className={styles.toast} data-agent-pane-toast="">
            <Toast
              title={t("app-space.title.coding-opened", {
                product: coding.tab.product,
                ticket: coding.tab.ticket,
              })}
              lead={vendor === undefined
                ? undefined
                : <VendorIcon vendor={vendor} size={16} />}
              actions={[{
                id: "show",
                label: t("app-space.button.show-terminal"),
              }]}
              onAction={() => {
                props.onTab("terminal");
                props.onOpenedClose();
              }}
              onClose={props.onOpenedClose}
              timer={STAY}
            />
          </div>
        )
        : null}
    </aside>
  );
}

// 터미널 탭의 점. 물음을 기다리면 waiting, 끝났으면 ended다.
function useTerminalDot(coding: PaneTerminal | undefined, deps?: TerminalDeps) {
  const { sessions } = useSessions();
  const store = deps?.store;
  const phase = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => (coding === undefined ? undefined : store?.get(coding.key))?.phase,
  );
  if (coding === undefined) return null;
  const entry = sessions.find((item) => item.session === coding.session);
  const dot: TabDot | null = phase?.kind === "ended" ||
      (entry !== undefined && entry.ended !== null)
    ? "ended"
    : entry?.state === "waiting"
    ? "waiting"
    : null;
  return dot;
}

function Head(props: AgentPaneProps & { tab: PaneTab }): ReactElement {
  const { state, agents, coding } = props;
  const dot = useTerminalDot(coding?.tab, coding?.deps);
  const agent = state.mode === "agent"
    ? agents.find((item) => item.assignment === state.assignment)
    : undefined;
  const tabs: TabItem[] = [{
    key: "agent",
    title: state.mode === "manage"
      ? t("app-space.button.manage-agents")
      : agent?.name ?? t("app-space.heading.agents"),
    ...(agent === undefined
      ? {}
      : { icon: <Avatar profile={agent.profile} size="sm" /> }),
  }];
  if (coding !== undefined) {
    const vendor = vendorOf(coding.tab.product);
    tabs.push({
      key: "terminal",
      title: coding.tab.title,
      ...(vendor === undefined
        ? {}
        : { icon: <VendorIcon vendor={vendor} size={14} /> }),
      dot,
    });
  }
  const label = t("common.button.close");
  return (
    <TabStrip
      tabs={tabs}
      selected={props.tab}
      onSelect={(key) => props.onTab(key as PaneTab)}
      end={
        <Tooltip content={label}>
          <IconButton
            icon={workspaceIcons.close}
            label={label}
            size="sm"
            data-agent-pane-close=""
            onClick={props.onClose}
          />
        </Tooltip>
      }
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
  props: AgentPaneProps & {
    factory: AgentViewSourceFactory;
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
    ...(props.onOpenResult === undefined ? {} : {
      openResult: (document) => props.onOpenResult?.(document),
    }),
    // 권한 요약은 같은 칸의 관리 화면으로 간다.
    openPermissions: () => onState({ mode: "manage", agent: null }),
    openAgentSettings: () => props.onSettings?.(),
    // Fork가 만든 session은 같은 칸에서 연다.
    openForked: (session) => onState({ mode: "agent", assignment, session }),
    // 사용량 화면과 첨부 통로는 아직 이 칸에 없다.
    showUsage: () => {},
    closeTab: props.onClose,
    attach: () => {},
    ...(props.onSettings === undefined
      ? {}
      : { openConnections: props.onSettings }),
  };
  return (
    <div className={styles.agent}>
      <AgentView
        source={source}
        drafts={shared ?? local}
        session={props.session}
        onSessionChange={(session) =>
          onState({ mode: "agent", assignment, session })}
        host={host}
      />
    </div>
  );
}

function ManageBody(props: AgentPaneProps & { agent: string | null }) {
  return (
    <div className={styles.manage}>
      <AgentsPage
        project={props.app}
        projectName={props.appName}
        source={props.source}
        agent={props.agent}
        onAgent={(agent) => props.onState({ mode: "manage", agent })}
        contexts={[]}
        onEditInstructions={() => props.onInstructions?.()}
        onChangeDefaults={() => props.onSettings?.()}
        onAddExtension={() => props.onSettings?.()}
        onChanged={props.onChanged}
      />
    </div>
  );
}
