// 앱 공간 위쪽 바의 agent select. 앱 공간은 lophn sidebar를 쓰지 않으므로
// 이 select가 agent를 여는 유일한 길이다(알림의 [Ask Project Manager]는 select를 거치지 않는다).
// 화면 값은 lophn-agent/agents의 목록 줄에서 부르는 쪽이 만든 view 값이다. renderer는 protocol을
// type check하지 않으므로 id는 문자열로 받는다.
import type { ReactElement } from "react";
import { Avatar, type AvatarProfile } from "../parts/avatar/avatar.tsx";
import { Button, Icon } from "@lophn/ui/primitives";
import { Menu, type MenuItem, Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { conversationIcons, editorIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import type { AgentListRow } from "../workspace/agents/source.ts";

import styles from "./agent-select.module.css";

// select는 lophn, Project Manager, Operator만 보인다.
type AppSpaceAgentRole = AgentListRow["role"];

/** select 항목 하나. */
export interface AppSpaceAgent {
  /** agent key. 내장 role은 role 이름이고 Operator는 `agt_…`다. */
  readonly assignment: string;
  readonly role: AppSpaceAgentRole;
  /** 항목에 보이는 이름(고정 글자가 아니다. Operator는 사람이 지은 이름). */
  readonly name: string;
  readonly profile: AvatarProfile;
}

interface AgentSelectProps {
  /**
   * 부르는 쪽이 읽은 agent. 순서는 component가 정한다: lophn, Project Manager, 이 앱 project의 Operator들(들어온 순서).
   */
  agents: readonly AppSpaceAgent[];
  /** 옆 pane이 열려 있으면 단추가 눌린 모양이다. */
  paneOpen: boolean;
  /** agent 항목을 골랐다. 그 agent의 Agent component를 앱 화면 옆 칸에 여는 일은 부르는 쪽 몫이다. */
  onOpenAgent: (assignment: string) => void;
  /** Manage를 골랐다. 같은 칸에 앱 자리의 agent 관리를 여는 일은 부르는 쪽 몫이다. */
  onManage: () => void;
}

/**
 * 약속하는 DOM(test가 단언):
 * - 닫힌 모습: 글자 없는 아이콘 단추 `button[data-agent-select][aria-haspopup="menu"]` 하나(Agent 아이콘과 chevron, 접근 이름 "Agent").
 *   열기 전에는 `role=menu`가 없다. 앱 view의 상태(crash·멈춤)와 상관없이 props만으로 열린다. 옆 pane이 열려 있으면 `aria-pressed`다.
 * - 열면 `role=menu`(portal) 안에 `role=menuitem`이 lophn, Project Manager, Operator들(들어온 순서), Manage 순서로 있다.
 *   agent 항목은 `[data-agent=<assignment>]`이고 안에 avatar(`[data-avatar]`)와 이름 `[data-agent-name]`이 이 순서로
 *   있다. Manage는 `[data-agent-manage]` "Manage"이며 `[data-agent]`가 아니다.
 * - agent 항목을 고르면 `onOpenAgent(assignment)` 한 번, Manage를 고르면 `onManage()` 한 번만 부르고 menu는 닫힌다.
 * - 놓을 자리(window controls 바로 옆)는 app bar가 정하고 이 component는 select 하나만 그린다.
 */
export function AgentSelect(
  { agents, paneOpen, onOpenAgent, onManage }: AgentSelectProps,
): ReactElement {
  const items: MenuItem[] = [
    ...ordered(agents).map((agent) => ({
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
  const label = t("app-space.label.agent-select");
  return (
    <Tooltip content={label}>
      <span className={styles.anchor}>
        <Menu
          items={items}
          onSelect={(id) => id === MANAGE ? onManage() : onOpenAgent(id)}
          placement="beside"
          trigger={
            <Button
              variant="ghost"
              icon={conversationIcons.dock}
              aria-label={label}
              aria-pressed={paneOpen}
              data-agent-select=""
            >
              <Icon
                icon={editorIcons.detailsClosed}
                pixels={iconPixels("small")}
              />
            </Button>
          }
        />
      </span>
    </Tooltip>
  );
}

// 항목 id가 assignment(`asg_…`)와 겹치지 않는 Manage의 id.
const MANAGE = "manage";

/** lophn, Project Manager, Operator들(들어온 순서). */
function ordered(agents: readonly AppSpaceAgent[]): AppSpaceAgent[] {
  const pick = (role: AppSpaceAgentRole) =>
    agents.filter((agent) => agent.role === role);
  return [
    ...pick("lophn"),
    ...pick("project_manager"),
    ...pick("operator"),
  ];
}
