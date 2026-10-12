// 앱 공간의 agent 칸(shell/app-frame#R36~R39). 앱 화면 옆에 Agent 화면(shell/desktop) 하나나, Manage가 여는 앱 자리의
// agent 관리 화면(project의 Agents 탭과 같은 AgentsPage)을 둔다. 칸은 둘 중 하나만 보이고 닫을 수 있으며, 창이 넓으면
// 앱 화면 옆 열이고 좁으면 앱 화면을 덮는다. 덮는 동안에도 앱 view는 숨지 않고 칸이 덮지 않는 영역으로 준다.
import { type ReactElement, useMemo, useRef } from "react";
import { IconButton, Tooltip, workspaceIcons } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { AgentViewSourceFactory } from "../conversation/agent-source.ts";
import { AgentView, type AgentViewHost } from "../conversation/agent-view.tsx";
import { useConversation } from "../conversation/dock-slot.tsx";
import { DraftStore } from "../conversation/drafts.ts";
import { AgentsPage } from "../workspace/agents/agents-page.tsx";
import type { AgentsSource } from "../workspace/agents/source.ts";
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

/** 칸이 지금 보이는 것. agent는 열린 agent와 그 session(null은 새 session), manage는 editor로 열어 둔 agent다. */
export type AgentPaneState =
  | {
    readonly mode: "agent";
    readonly assignment: string;
    readonly session: string | null;
  }
  | { readonly mode: "manage"; readonly agent: string | null };

export interface AgentPaneProps {
  state: AgentPaneState;
  placement: Exclude<AgentPanePlacement, "hidden">;
  app: string;
  appName: string;
  source: AgentsSource;
  /** 없으면 Agent 화면을 열 수 없다("준비 안 됨"). */
  agentViewSource?: AgentViewSourceFactory;
  onState: (state: AgentPaneState) => void;
  onClose: () => void;
  onOpenResult?: (document: string, version: string | null) => void;
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
  const { state } = props;
  const body = state.mode === "manage"
    ? <ManageBody {...props} agent={state.agent} />
    : props.agentViewSource === undefined
    ? <NotReady onClose={props.onClose} />
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
      aria-label={t("app-space.heading.agents")}
      style={{ width: `${AGENT_PANE_WIDTH}px` }}
    >
      {body}
    </aside>
  );
}

function Head({ onClose }: { onClose: () => void }): ReactElement {
  const label = t("common.button.close");
  return (
    <div className={styles.head}>
      <h2 className={styles.title}>{t("app-space.heading.agents")}</h2>
      <Tooltip content={label}>
        <IconButton
          icon={workspaceIcons.close}
          label={label}
          size="sm"
          data-agent-pane-close=""
          onClick={onClose}
        />
      </Tooltip>
    </div>
  );
}

function NotReady({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <>
      <Head onClose={onClose} />
      <p className={styles.state} data-agent-not-ready="">
        {t("app-space.empty.agent-not-ready")}
      </p>
    </>
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
    ...(props.onOpenResult === undefined
      ? {}
      : { openResult: props.onOpenResult }),
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
    <>
      <Head onClose={props.onClose} />
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
    </>
  );
}
