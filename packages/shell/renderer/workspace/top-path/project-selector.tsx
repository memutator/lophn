import { t } from "@lophn/wording";

import { commonIcons } from "../../icons/mod.ts";
import { PathMenu } from "./desk-selector.tsx";

export interface ProjectOption {
  /** prj_… */
  readonly id: string;
  /** project 이름. */
  readonly label: string;
}

export interface ProjectSelectorProps {
  /** 목록을 못 읽었거나 읽는 중이면 지금 project 하나뿐이다. */
  readonly options: readonly ProjectOption[];
  /** 지금 project id. */
  readonly active: string;
  readonly onSelect: (id: string) => void;
}

// 상단 바 왼쪽 경로의 project 조각. 고르면 그 project를 이 창에서 연다.
export function ProjectSelector(
  { options, active, onSelect }: ProjectSelectorProps,
) {
  return (
    <PathMenu
      kind="project"
      label={t("project-workspace.label.project-selector")}
      icon={commonIcons.projects}
      items={options}
      active={active}
      onSelect={onSelect}
    />
  );
}
