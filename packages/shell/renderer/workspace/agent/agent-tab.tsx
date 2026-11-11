// Agent 탭의 본문. agent 하나의 source를 factory로 얻어 Agent 화면에 넘긴다. 보는 session은 탭이 쥐고 화면은 바꾸자고
// 말하기만 한다. 탭 제목은 창이 아는 session 제목(`slice.titleOf`)이 정본이다: 이 화면이 읽은 제목은 창에 알리고
// (`slice.titled`), 탭 제목은 그 값으로 맞춘다. 이 화면만 아는 값으로 탭을 쓰면 그려지지 않은 탭의 이름이 갈라진다.

import { t } from "@lophn/i18n";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AgentView,
  type AgentViewHost,
} from "../../conversation/agent-view.tsx";
import type { AgentViewSlice } from "../kinds/host.ts";
import { sourceWorkspaceOf } from "./tab-fields.ts";
import styles from "./agent-tab.module.css";

interface AgentTabProps {
  /** agent id. lophn이거나 `agt_…`다. */
  agent: string;
  /** 탭을 연 project나 앱. 그 탭 session의 workspace다. Home이면 null. */
  workspace: string | null;
  slice: AgentViewSlice;
  session: string | null;
  onSession: (session: string | null) => void;
  host: AgentViewHost;
  /** 지금 탭 제목. session 제목(없으면 agent 이름)과 다를 때만 고친다. */
  title: string;
  onTitle: (name: string) => void;
}

export function AgentTab(props: AgentTabProps) {
  const { agent, workspace, slice, title, onTitle } = props;
  // 같은 agent와 자리의 탭은 하나의 source를 쥔다. 다시 그려도 새로 만들지 않는다.
  const source = useMemo(
    () =>
      slice.factory({
        assignment: agent,
        workspace: sourceWorkspaceOf(workspace),
      }),
    [slice.factory, agent, workspace],
  );
  const latest = useRef({ title, onTitle });
  latest.current = { title, onTitle };
  const [agentName, setAgentName] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const { session } = props;
  useEffect(() => {
    if (session !== null && sessionTitle !== null) {
      slice.titled(session, sessionTitle);
    }
  }, [session, sessionTitle, slice.titled]);
  useEffect(() => {
    let live = true;
    void source.agent().then((read) => {
      if (live && read.ok) setAgentName(read.value.name);
    });
    return () => {
      live = false;
    };
  }, [source]);
  // desired가 바뀔 때만 맞춘다. 탭 줄에서 이름을 바꾼 직후의 title로 되돌리지 않고, 고친 뒤 루프도 없다.
  const desired =
    (session === null ? null : slice.titleOf(session)) ??
    sessionTitle ??
    agentName;
  useEffect(() => {
    if (desired !== null && desired !== latest.current.title) {
      latest.current.onTitle(desired);
    }
  }, [desired]);
  return (
    <AgentView
      source={source}
      drafts={slice.drafts}
      session={props.session}
      onSessionChange={props.onSession}
      onSessionTitle={setSessionTitle}
      host={props.host}
      {...(slice.now === undefined ? {} : { now: slice.now })}
    />
  );
}

/** agentViewSource가 없는 작업대에서 Agent 탭이 보이는 안내. */
export function AgentNotReady() {
  return (
    <p className={styles.notReady} data-agent-not-ready="">
      {t("project-workspace.notice.agent-not-ready")}
    </p>
  );
}
