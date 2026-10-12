// 앱 공간 agent select test의 fake. 값은 lophn-agent/agents의 목록 줄 모양을 따른다. id는 고정이다.
import type { AppSpaceAgent } from "../agent-select.tsx";

export function selectAssignment(n: number): string {
  return `asg_01h455vb4pex5v6nkc6gd5fe${String(n).padStart(2, "0")}`;
}

export const LOPHN: AppSpaceAgent = {
  assignment: selectAssignment(1),
  role: "lophn",
  name: "lophn",
  profile: { kind: "icon", icon: "dock" },
};

export const APP_ENGINEER: AppSpaceAgent = {
  assignment: selectAssignment(2),
  role: "app_engineer",
  name: "App Engineer",
  profile: { kind: "icon", icon: "apps" },
};

/** 앱 공간에서는 보이면 안 되는 agent. 부르는 쪽이 실수로 넘겨도 select가 거른다. */
export const CONTEXT_ENGINEER: AppSpaceAgent = {
  assignment: selectAssignment(3),
  role: "context_engineer",
  name: "Context Engineer",
  profile: { kind: "icon", icon: "contexts" },
};

/** Operator 이름은 사람이 지은 것이라 고정 글자와 다른 값으로 이름이 props에서 오는지 본다. */
export const BUDGET_WATCHER: AppSpaceAgent = {
  assignment: selectAssignment(4),
  role: "operator",
  name: "Budget watcher",
  profile: { kind: "icon", icon: "search" },
};

export const MONTH_CLOSER: AppSpaceAgent = {
  assignment: selectAssignment(5),
  role: "operator",
  name: "Month closer",
  profile: { kind: "initial", text: "MC" },
};

/** 일부러 섞인 순서이고 Context Engineer가 끼어 있다. */
export const APP_AGENTS_SHUFFLED: readonly AppSpaceAgent[] = [
  BUDGET_WATCHER,
  CONTEXT_ENGINEER,
  APP_ENGINEER,
  MONTH_CLOSER,
  LOPHN,
];
