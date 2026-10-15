// project sidebar의 Agent 쪽. agent마다 그 agent의 열린 session을 아래에 들여 쓰고, 맨 아래에 최근 session을 둔다.
// session을 누르면 그 session 탭이 열린다. session 목록은 agents-data.ts의 것을 그대로 쓴다.
import { IconButton } from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import sideStyles from "../../../../../packages/shell/renderer/workspace/sidebar/sidebar.module.css";
import { ProfileAvatar } from "../agent-avatar.tsx";
import {
  AGENT_ROWS,
  type AgentRow,
  type SessionRow,
  SESSIONS,
  sessionsOf,
} from "../agents-data.ts";
import agentStyles from "../agents.module.css";
import styles from "./files.module.css";

/** lophn은 전체에 하나, Project Manager는 project마다 하나다. 그 아래에 사람이 만든 Operators가 온다. */
const AGENTS: readonly AgentRow[] = AGENT_ROWS.filter((row) =>
  row.operator !== true
);
export const OPERATORS: readonly AgentRow[] = AGENT_ROWS.filter((row) =>
  row.operator === true && row.id !== "operators"
);

// 탭이 열려 있는 session과 최근에 쓴(닫힌) session.
const OPEN = new Set([
  "weekly",
  "harness",
  "failing",
  "week41",
  "next-experiments",
]);
const RECENT = ["release-check", "release-ctx", "c049", "recipe-gap"];

const openSessionsOf = (agent: string) =>
  sessionsOf(agent).filter((row) => OPEN.has(row.id));

const RECENT_ROWS: readonly SessionRow[] = RECENT.flatMap((id) =>
  SESSIONS.filter((row) => row.id === id)
);

function SessionItem(
  { row, onSession, withAgent = false }: {
    row: SessionRow;
    onSession: (row: SessionRow) => void;
    withAgent?: boolean;
  },
) {
  return (
    <li className={sideStyles.li}>
      <button
        type="button"
        className={`${sideStyles.item} ${styles.sessionItem}`}
        onClick={() => onSession(row)}
      >
        <span
          className={`${styles.sessionDot} ${
            row.state === "idle" ? "" : styles[`state_${row.state}`]
          }`}
          role={row.state === "idle" ? undefined : "img"}
          aria-label={row.state === "waiting"
            ? "Waiting for you"
            : row.state === "working"
            ? "Working"
            : undefined}
        />
        <span className={styles.sessionText}>
          <span className={sideStyles.label}>{row.title}</span>
          {withAgent
            ? (
              <span className={styles.sessionMeta}>
                {row.agent} · {row.when}
              </span>
            )
            : null}
        </span>
        {withAgent
          ? null
          : <span className={styles.sessionWhen}>{row.when}</span>}
      </button>
    </li>
  );
}

function AgentGroup(
  { agent, hover, onAgent, onSession }: {
    agent: AgentRow;
    hover: boolean;
    onAgent: (agent: string) => void;
    onSession: (row: SessionRow) => void;
  },
) {
  const sessions = openSessionsOf(agent.name);
  return (
    <li className={styles.agentGroup}>
      <div
        className={`${sideStyles.li} ${agentStyles.agentRow}`}
        data-hover={hover ? "" : undefined}
      >
        <button
          type="button"
          className={sideStyles.item}
          onClick={() => onAgent(agent.id)}
        >
          <ProfileAvatar profile={agent.profile} size="sm" />
          <span className={sideStyles.label}>{agent.name}</span>
        </button>
        <span className={agentStyles.plus}>
          <IconButton
            icon={lophnSpaceIcons.add}
            label={`New session with ${agent.name}`}
            size="sm"
            onClick={() => onAgent(agent.id)}
          />
        </span>
      </div>
      {sessions.length === 0
        ? null
        : (
          <ul className={`${sideStyles.list} ${styles.sessions}`} role="list">
            {sessions.map((row) => (
              <SessionItem key={row.id} row={row} onSession={onSession} />
            ))}
          </ul>
        )}
    </li>
  );
}

export function AgentsPanel(
  { hoverAgent, onAgent, onManage, onSession }: {
    hoverAgent?: string;
    onAgent: (agent: string) => void;
    onManage: () => void;
    onSession: (row: SessionRow) => void;
  },
) {
  return (
    <>
      <section className={sideStyles.section}>
        <h2 className={`${sideStyles.sectionLabel} ${agentStyles.agentsHead}`}>
          <span>Agents</span>
          <button
            type="button"
            className={agentStyles.manage}
            onClick={onManage}
          >
            Manage
          </button>
        </h2>
        <ul className={sideStyles.list} role="list">
          {AGENTS.map((agent) => (
            <AgentGroup
              key={agent.id}
              agent={agent}
              hover={hoverAgent === agent.id}
              onAgent={onAgent}
              onSession={onSession}
            />
          ))}
          {OPERATORS.length === 0
            ? null
            : <li className={agentStyles.subLabel}>Operators</li>}
          {OPERATORS.map((agent) => (
            <AgentGroup
              key={agent.id}
              agent={agent}
              hover={hoverAgent === agent.id}
              onAgent={onAgent}
              onSession={onSession}
            />
          ))}
        </ul>
      </section>
      <section className={sideStyles.section}>
        <h2 className={sideStyles.sectionLabel}>Recent</h2>
        <ul className={sideStyles.list} role="list">
          {RECENT_ROWS.map((row) => (
            <SessionItem
              key={row.id}
              row={row}
              onSession={onSession}
              withAgent
            />
          ))}
        </ul>
      </section>
    </>
  );
}
