// Agent 탭의 본문(shell/workspace#R33). agent 하나의 source를 factory로 얻어 Agent 화면에 넘기고, 화면이 읽은
// agent 이름을 탭 제목으로 알린다. 보는 session은 탭이 쥐고 화면은 바꾸자고 말하기만 한다.
import { useEffect, useMemo, useRef } from "react";
import { t } from "@lophn/wording";

import {
  AgentView,
  type AgentViewHost,
} from "../../conversation/agent-view.tsx";
import type { ContextChipView } from "../../conversation/composer/agent-composer.tsx";
import type { AgentViewSlice } from "../kinds/host.ts";
import styles from "./agent-tab.module.css";

export interface AgentTabProps {
  /** `asg_…` */
  agent: string;
  /** 탭을 연 project. agent의 자리다. */
  place: string;
  slice: AgentViewSlice;
  session: string | null;
  onSession: (session: string | null) => void;
  host: AgentViewHost;
  /** 지금 탭 제목. source가 읽은 agent 이름과 다를 때만 고친다. */
  title: string;
  onTitle: (name: string) => void;
  chips?: readonly ContextChipView[];
  hint?: string;
}

export function AgentTab(props: AgentTabProps) {
  const { agent, place, slice, title, onTitle } = props;
  // 같은 agent와 자리의 탭은 하나의 source를 쥔다. 다시 그려도 새로 만들지 않는다.
  const source = useMemo(
    () =>
      slice.factory({
        assignment: agent,
        place: { kind: "project", id: place },
      }),
    [slice.factory, agent, place],
  );
  const latest = useRef({ title, onTitle });
  latest.current = { title, onTitle };
  useEffect(() => {
    let live = true;
    void source.agent().then((read) => {
      if (live && read.ok && read.value.name !== latest.current.title) {
        latest.current.onTitle(read.value.name);
      }
    });
    return () => {
      live = false;
    };
  }, [source]);
  return (
    <AgentView
      source={source}
      drafts={slice.drafts}
      session={props.session}
      onSessionChange={props.onSession}
      host={props.host}
      {...(props.chips === undefined ? {} : { contextChips: props.chips })}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(slice.ticks === undefined ? {} : { ticks: slice.ticks })}
      {...(slice.now === undefined ? {} : { now: slice.now })}
    />
  );
}

/** agentViewSource가 없는 작업대에서 저장된 Agent 탭이 보이는 안내. */
export function AgentNotReady() {
  return (
    <p className={styles.notReady} data-agent-not-ready="">
      {t("project-workspace.notice.agent-not-ready")}
    </p>
  );
}
