// project sidebar의 Agent 쪽. agent마다 열린 session을 들여 쓰고 맨 아래에 Recent session을 둔다.
// 점은 사람을 기다림(경고색)·일하는 중(focus색)이다.
import { Avatar } from "../../parts/avatar/avatar.tsx";
import { IconButton } from "@lophn/ui/primitives";
import { lophnSpaceIcons } from "../../icons/mod.ts";
import { formatRelativeTime, t } from "@lophn/wording";

import type {
  AgentGroup,
  AgentPanelView,
  PanelSession,
} from "./use-agent-panel.ts";
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

function Dot({ status }: { status: PanelSession["status"] }) {
  const label = status === "waiting"
    ? t("project-workspace.label.agent-waiting")
    : status === "working"
    ? t("common.label.tab-working")
    : undefined;
  return (
    <span
      className={styles.sessionDot}
      data-state={status === "idle" ? undefined : status}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
    />
  );
}

function SessionItem(
  { session, agentName, onSession }: {
    session: PanelSession;
    /** 있으면 제목 아래에 "agent · 시각"을 보인다(Recent). */
    agentName?: string;
    onSession: (session: PanelSession) => void;
  },
) {
  const when = formatRelativeTime(new Date(session.at), new Date());
  return (
    <li className={styles.li}>
      <button
        type="button"
        className={`${styles.item} ${styles.sessionItem}`}
        data-session={session.id}
        onClick={() => onSession(session)}
      >
        <Dot status={session.status} />
        <span className={styles.sessionText}>
          <span className={styles.label}>{session.title}</span>
          {agentName === undefined
            ? null
            : <span className={styles.sessionMeta}>{agentName} · {when}</span>}
        </span>
        {agentName === undefined
          ? <span className={styles.sessionWhen}>{when}</span>
          : null}
      </button>
    </li>
  );
}

function Group(
  { group, onAgent, onNewSession, onSession }: {
    group: AgentGroup;
  } & Pick<AgentPanelProps, "onAgent" | "onNewSession" | "onSession">,
) {
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
            icon={lophnSpaceIcons.add}
            label={t("project-workspace.button.new-session-with", {
              agent: agent.name,
            })}
            size="sm"
            onClick={() => (onNewSession ?? onAgent)(agent)}
          />
        </span>
      </div>
      {sessions.length === 0
        ? null
        : (
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

export function AgentPanel(
  { view, onAgent, onNewSession, onSession, onManage }: AgentPanelProps,
) {
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
          {view.builtins.map((group) => (
            <Group key={group.agent.assignment} group={group} {...rowProps} />
          ))}
          {view.operators.length === 0 ? null : (
            <li className={styles.subLabel}>
              {t("project-workspace.label.role-operators")}
            </li>
          )}
          {view.operators.map((group) => (
            <Group key={group.agent.assignment} group={group} {...rowProps} />
          ))}
        </ul>
      </section>
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
