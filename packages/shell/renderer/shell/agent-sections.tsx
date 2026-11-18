// "새 agent session" 목록 하나. 왼쪽 sidebar workspace 줄의 + hover 목록과 탭 줄 + menu의 Agent ▸ 단계가 이 값 하나로
// 그린다: 묶음(lophn agent + 새 agent 키, Coding agents = Settings의 즐겨찾기)과 줄 아이콘과 고르면 하는 일을 여기서만 정한다.
// 두 곳은 같은 묶음을 popover 줄(HoverSection)이나 menu 항목(sectionMenuItems)으로 옮겨 그리기만 한다.
import { t } from "@lophn/i18n";
import { MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import { Kbd } from "@lophn/ui/primitives";
import type { ReactNode } from "react";

import { HARNESS_ADAPTERS } from "../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../protocol/coding-agent/harness-id.ts";
import { isCodingBuiltin } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  type AgentChoice,
  AgentFaceIcon,
} from "../parts/agent-session/agent-session.tsx";
import { codingFace } from "../parts/agent-session/coding.ts";
import type { SidebarAgent } from "../workspace/sidebar/sidebar-agent.ts";
import type { QuickHoverItem } from "./quick-launch.tsx";

/** hover 목록·menu의 한 묶음. 묶음 사이에는 divider가 들어간다. */
export interface HoverSection {
  id: string;
  heading: string;
  /** 머리 글 뒤에 붙일 키. */
  keys?: string | null;
  items: readonly QuickHoverItem[];
}

/** 이름 뒤에 키를 붙인 tooltip·목록 머리 글. */
export function Keyed({ label, keys }: { label: string; keys: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {label}
      <Kbd keys={[keys]} />
    </span>
  );
}

/** 설정한 명령어가 없으면 harness의 첫 명령어다. */
export function codingCommand(
  commands: Readonly<Partial<Record<HarnessId, string>>>,
  id: HarnessId,
): string | undefined {
  return commands[id] ?? HARNESS_ADAPTERS[id].commands[0];
}

/**
 * 고를 수 있는 agent: lophn agent 먼저, 그 뒤에 즐겨찾기 coding agent.
 * 내장 coding agent(`coding_<harness>`)는 lophn이 부르는 headless 주소라 뺀다. 사람은 아래 Coding agents 줄로 같은 CLI를 TUI로 연다.
 */
export function agentChoices(
  agents: readonly SidebarAgent[],
  favorites: readonly HarnessId[],
): AgentChoice[] {
  return [
    ...agents
      .filter((agent) => !isCodingBuiltin(agent.assignment))
      .map((agent) => ({
        kind: "lophn" as const,
        id: agent.assignment,
        name: agent.name,
        face: { kind: "lophn" as const, profile: agent.profile },
      })),
    ...favorites.map((id) => ({
      kind: "coding" as const,
      id,
      name: HARNESS_ADAPTERS[id].label,
      face: codingFace(id),
    })),
  ];
}

/** 빈 묶음도 돌려 준다. 그리는 쪽이 건너뛴다. */
export function agentSections(
  choices: readonly AgentChoice[],
  newKeys: string | null,
  onChoose: (choice: AgentChoice) => void,
): HoverSection[] {
  const items = (kind: AgentChoice["kind"]): QuickHoverItem[] =>
    choices
      .filter((choice) => choice.kind === kind)
      .map((choice) => ({
        id: `${choice.kind}:${choice.id}`,
        label: choice.name,
        leading: <AgentFaceIcon face={choice.face} />,
        onSelect: () => onChoose(choice),
      }));
  return [
    {
      id: "lophn",
      heading: t("left-sidebar.heading.lophn-agents"),
      keys: newKeys,
      items: items("lophn"),
    },
    {
      id: "coding",
      heading: t("left-sidebar.heading.coding-agents"),
      items: items("coding"),
    },
  ];
}

/** 묶음을 Menu 항목으로. 머리 글은 묶음 첫 줄 위에, 둘째 묶음부터 그 위에 구분선이 선다. */
export function sectionMenuItems(
  sections: readonly HoverSection[],
): MenuItem[] {
  return sections
    .filter((section) => section.items.length > 0)
    .flatMap((section, index) =>
      section.items.map(
        (item, row): MenuItem => ({
          id: item.id,
          label: item.label,
          textValue: item.label,
          leading: <MenuIcon>{item.leading}</MenuIcon>,
          ...(row === 0
            ? {
                heading: sectionHeading(section),
                ...(index === 0 ? {} : { separatorBefore: true }),
              }
            : {}),
        }),
      ),
    );
}

/** 묶음 머리 글(키가 있으면 키를 붙인다). */
export function sectionHeading(section: HoverSection): ReactNode {
  return section.keys == null ? (
    section.heading
  ) : (
    <Keyed label={section.heading} keys={section.keys} />
  );
}
