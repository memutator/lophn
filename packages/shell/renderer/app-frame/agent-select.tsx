// 앱 공간 title bar의 agent select(shell/app-frame#R37~R39). 앱 공간은 lophn sidebar를 쓰지 않으므로
// 이 select가 agent를 여는 유일한 길이다(알림의 [Ask App Engineer]는 select를 거치지 않는다, R40).
// 화면 값은 lophn-agent/agents의 목록 줄에서 부르는 쪽이 만든 view 값이다. renderer는 contracts를
// type check하지 않으므로 id는 문자열로 받는다.
import type { ReactElement } from "react";
import {
  Avatar,
  type AvatarProfile,
  Button,
  Menu,
  type MenuItem,
} from "@lophn/design/components";
import { editorIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./agent-select.module.css";

export type AppSpaceAgentRole =
  | "lophn"
  | "context_engineer"
  | "app_engineer"
  | "operator";

/** select 항목 하나. */
export interface AppSpaceAgent {
  /** `asg_…` */
  readonly assignment: string;
  readonly role: AppSpaceAgentRole;
  /** 항목에 보이는 이름(고정 글자가 아니다. Operator는 사람이 지은 이름). */
  readonly name: string;
  readonly profile: AvatarProfile;
}

export interface AgentSelectProps {
  /**
   * 부르는 쪽이 읽은 agent. 순서는 component가 정한다: lophn, App Engineer, 이 앱의 Operator들(들어온 순서).
   * Context Engineer는 앱 공간에서 부르지 않으므로 들어와도 그리지 않는다(R37).
   */
  agents: readonly AppSpaceAgent[];
  /** agent 항목을 골랐다. 그 agent의 Agent component를 앱 화면 옆 칸에 여는 일은 부르는 쪽 몫이다(R38). */
  onOpenAgent: (assignment: string) => void;
  /** Manage를 골랐다. 같은 칸에 앱 자리의 agent 관리를 여는 일은 부르는 쪽 몫이다(R39). */
  onManage: () => void;
}

/**
 * 약속하는 DOM(test가 단언):
 * - 닫힌 모습: `button[data-agent-select][aria-haspopup="menu"]` 하나(접근 이름 "Agent"). 열기 전에는 `role=menu`가 없다.
 *   앱 view의 상태(crash·멈춤)와 상관없이 props만으로 열린다.
 * - 열면 `role=menu`(portal) 안에 `role=menuitem`이 lophn, App Engineer, Operator들(들어온 순서), Manage 순서로 있다.
 *   agent 항목은 `[data-agent=<assignment>]`이고 안에 avatar(`[data-avatar]`)와 이름 `[data-agent-name]`이 이 순서로
 *   있다. Manage는 `[data-agent-manage]` "Manage"이며 `[data-agent]`가 아니다. Context Engineer 항목은 없다.
 * - agent 항목을 고르면 `onOpenAgent(assignment)` 한 번, Manage를 고르면 `onManage()` 한 번만 부르고 menu는 닫힌다.
 * - 놓을 자리(window controls 바로 옆)는 app bar가 정하고 이 component는 select 하나만 그린다.
 */
export function AgentSelect(
  { agents, onOpenAgent, onManage }: AgentSelectProps,
): ReactElement {
  const items: MenuItem[] = [
    ...visibleAgents(agents).map((agent) => ({
      id: agent.assignment,
      leading: <Avatar profile={agent.profile} size="sm" />,
      label: (
        <span className={styles.name} data-agent-name="">{agent.name}</span>
      ),
      textValue: agent.name,
      data: { "data-agent": agent.assignment } as const,
    })),
    {
      id: MANAGE,
      label: t("app-space.button.manage-agents"),
      data: { "data-agent-manage": "" },
    },
  ];
  return (
    <Menu
      items={items}
      onSelect={(id) => id === MANAGE ? onManage() : onOpenAgent(id)}
      placement="beside"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          icon={editorIcons.detailsClosed}
          data-agent-select=""
        >
          {t("app-space.label.agent-select")}
        </Button>
      }
    />
  );
}

// 항목 id가 assignment(`asg_…`)와 겹치지 않는 Manage의 id.
const MANAGE = "manage";

/** lophn, App Engineer, Operator들(들어온 순서). Context Engineer는 거른다. */
function visibleAgents(agents: readonly AppSpaceAgent[]): AppSpaceAgent[] {
  const pick = (role: AppSpaceAgentRole) =>
    agents.filter((agent) => agent.role === role);
  return [
    ...pick("lophn"),
    ...pick("app_engineer"),
    ...pick("operator"),
  ];
}
