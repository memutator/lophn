// project sidebar의 Agent 쪽. agent마다 열린 session을 들여 쓰고, run이 있으면 Background 묶음, 맨 아래에 Recent session을 둔다.
// 점은 사람을 기다림(경고색)·일하는 중(focus색)이다.
import { Avatar } from "../../parts/avatar/avatar.tsx";
import { IconButton } from "@lophn/ui/primitives";
import { commonIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type {
  AgentGroup,
  AgentPanelView,
  PanelSession,
} from "./use-agent-panel.ts";
import { RunList, SessionItem } from "./run-list.tsx";
import type { SidebarAgent } from "./sidebar-agent.ts";
import styles from "./project-sidebar.module.css";

interface AgentPanelProps {
  view: AgentPanelView;
  onAgent: (agent: SidebarAgent) => void;
  /** hover의 +. 주지 않으면 agent 줄과 같다. */
  onNewSession?: (agent: SidebarAgent) => void;
  onSession: (session: PanelSession) => void;
  onManage: () => void;
}

function Group({
  group,
  onAgent,
  onNewSession,
  onSession,
}: {
  group: AgentGroup;
} & Pick<AgentPanelProps, "onAgent" | "onNewSession" | "onSession">) {
  const { agent, sessions } = group;
  return (
    <li className={styles.agentGroup} data-agent-group={agent.assignment}>
      <div className={`${styles.li} ${styles.agentRow}`}>
        <button
          type="button"
          className={styles.item}
          data-agent={agent.assignment}
          onClick={() => onAgent(agent)}
        >
          <Avatar profile={agent.profile} size="sm" />
          <span className={styles.label}>{agent.name}</span>
        </button>
        <span className={styles.plus}>
          <IconButton
            icon={commonIcons.add}
            label={t("project-workspace.button.new-session-with", {
              agent: agent.name,
            })}
            size="sm"
            onClick={() => (onNewSession ?? onAgent)(agent)}
          />
        </span>
      </div>
      {sessions.length === 0 ? null : (
        <ul className={`${styles.list} ${styles.sessions}`} role="list">
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              onSession={onSession}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AgentPanel({
  view,
  onAgent,
  onNewSession,
  onSession,
  onManage,
}: AgentPanelProps) {
  const rowProps = { onAgent, onNewSession, onSession };
  return (
    <>
      <section className={styles.section} data-agents="">
        <h2 className={`${styles.sectionLabel} ${styles.agentsHead}`}>
          <span>{t("project-workspace.heading.agents")}</span>
          <button
            type="button"
            className={styles.manage}
            data-agents-manage=""
            onClick={onManage}
          >
            {t("project-workspace.button.manage-agents")}
          </button>
        </h2>
        <ul className={styles.list} role="list">
          {view.agents.map((group) => (
            <Group key={group.agent.assignment} group={group} {...rowProps} />
          ))}
        </ul>
      </section>
      {view.runs.length === 0 ? null : (
        <section className={styles.section} data-runs="">
          <h2 className={styles.sectionLabel}>
            {t("run-list.heading.background")}
          </h2>
          <RunList runs={view.runs} onSession={onSession} />
        </section>
      )}
      <section className={styles.section} data-recent="">
        <h2 className={styles.sectionLabel}>
          {t("project-workspace.label.recent")}
        </h2>
        <ul className={styles.list} role="list">
          {view.recent.map(({ session, agentName }) => (
            <SessionItem
              key={session.id}
              session={session}
              agentName={agentName}
              onSession={onSession}
            />
          ))}
        </ul>
      </section>
    </>
  );
}
