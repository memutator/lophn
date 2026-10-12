// project sidebar의 Agents 묶음(shell/workspace#R34·R35)과 접힌 rail의 Agent 단추(shell/workspace#R32).
// 화면 값은 lophn-agent/agents의 목록 줄과 lophn-agent/sessions의 상태에서 부르는 쪽이 만든 view 값이다.
// renderer는 contracts를 type check하지 않으므로 id는 문자열로 받는다.
import type { ReactElement } from "react";
import {
  Avatar,
  type AvatarProfile,
  IconButton,
  Tooltip,
} from "@lophn/design/components";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./agents-section.module.css";

/** project sidebar에 보이는 역할. App Engineer는 앱 공간의 agent라 여기에 없다. */
export type SidebarAgentRole = "lophn" | "context_engineer" | "operator";

/** Agents 묶음의 줄 하나. */
export interface SidebarAgent {
  /** `asg_…` */
  readonly assignment: string;
  readonly role: SidebarAgentRole;
  /** 줄에 보이는 이름(고정 글자가 아니다. Operator는 사람이 지은 이름). */
  readonly name: string;
  readonly profile: AvatarProfile;
  /** 이 agent에 답을 기다리는 session이 하나라도 있다(R35). 점은 저장하지 않는 표시 상태다. */
  readonly waiting: boolean;
}

export interface AgentsSectionProps {
  /**
   * 이 project의 agent. 순서는 component가 정한다: lophn, Context Engineer, Operator들(들어온 순서).
   * session 목록은 sidebar에 두지 않으므로 session 값은 받지 않는다.
   */
  agents: readonly SidebarAgent[];
  /** agent 줄을 눌렀다. 그 agent의 새 session을 가진 새 Agent 탭을 여는 일은 부르는 쪽 몫이다. */
  onOpenAgent: (assignment: string) => void;
  /** Manage를 눌렀다. Agents 탭을 연다. */
  onManage: () => void;
}

/**
 * 약속하는 DOM(test가 단언):
 * - 바깥 `section[data-agents]` 안에 제목 `h2` "Agents".
 * - agent 줄: `button[data-agent=<assignment>]`. 안에 avatar(`[data-avatar]`)와 이름 `[data-agent-name]`이
 *   이 순서로 있고, 기다리는 session이 있으면 같은 button 안에 상태 점 `[role=img][aria-label="Waiting for you"]`이
 *   있다(없으면 점 자체가 없다). 줄은 lophn, Context Engineer, Operator들 순서로 `[data-agent]`가 차례로 놓인다.
 * - 마지막에 `button[data-agents-manage]` "Manage". 줄을 누르면 `onOpenAgent(assignment)`, Manage는 `onManage()`만 부른다.
 * - session 목록·`+` 단추·"New session" 같은 session 말은 이 묶음에 없다.
 */
export function AgentsSection(
  { agents, onOpenAgent, onManage }: AgentsSectionProps,
): ReactElement {
  return (
    <section className={styles.section} data-agents="">
      <h2 className={styles.heading}>
        {t("project-workspace.heading.agents")}
      </h2>
      <ul className={styles.list} role="list">
        {inOrder(agents).map((agent) => (
          <li key={agent.assignment} className={styles.li}>
            <button
              type="button"
              className={styles.item}
              data-agent={agent.assignment}
              onClick={() =>
                onOpenAgent(agent.assignment)}
            >
              <Avatar profile={agent.profile} size="sm" />
              <span className={styles.name} data-agent-name="">
                {agent.name}
              </span>
              {agent.waiting
                ? (
                  <span
                    className={styles.dot}
                    role="img"
                    aria-label={t("project-workspace.label.agent-waiting")}
                  />
                )
                : null}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.manage}
        data-agents-manage=""
        onClick={onManage}
      >
        {t("project-workspace.button.manage-agents")}
      </button>
    </section>
  );
}

const ROLE_ORDER: Record<SidebarAgentRole, number> = {
  lophn: 0,
  context_engineer: 1,
  operator: 2,
};

// lophn, Context Engineer, Operator들 순서. 같은 역할 안에서는 들어온 순서를 지킨다(sort는 stable).
function inOrder(agents: readonly SidebarAgent[]): SidebarAgent[] {
  return [...agents].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

export interface AgentRailButtonProps {
  /** 접힌 rail의 Agent 단추를 눌렀다. lophn의 새 Agent 탭을 여는 일은 부르는 쪽 몫이다. */
  onOpenLophn: () => void;
}

/**
 * 접힌 sidebar의 바로 가기 rail에 놓는 단추(R32). `button[aria-label="Agent"][data-rail="agent"]` 하나이고
 * 누르면 `onOpenLophn()`을 한 번 부른다. rail의 다른 단추와 줄은 이 component 밖이다.
 */
export function AgentRailButton(
  { onOpenLophn }: AgentRailButtonProps,
): ReactElement {
  const label = t("project-workspace.button.agent");
  return (
    <Tooltip content={label}>
      <IconButton
        icon={conversationIcons.dock}
        label={label}
        data-rail="agent"
        onClick={onOpenLophn}
      />
    </Tooltip>
  );
}
