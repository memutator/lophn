// Agents 묶음 test의 fake. 값은 lophn-agent/agents의 목록 줄 모양을 따른다. id는 고정이다.
import type { SidebarAgent } from "../agents-section.tsx";

export function sidebarAssignment(n: number): string {
  return `asg_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export const LOPHN: SidebarAgent = {
  assignment: sidebarAssignment(1),
  role: "lophn",
  name: "lophn",
  profile: { kind: "icon", icon: "dock" },
  waiting: false,
};

export const CONTEXT_ENGINEER: SidebarAgent = {
  assignment: sidebarAssignment(2),
  role: "context_engineer",
  name: "Context Engineer",
  profile: { kind: "icon", icon: "contexts" },
  waiting: false,
};

/** Operator 이름은 사람이 지은 것이라 고정 글자와 다른 값으로 이름이 props에서 오는지 본다. */
export const EVAL_ANALYST: SidebarAgent = {
  assignment: sidebarAssignment(3),
  role: "operator",
  name: "Eval analyst",
  profile: { kind: "icon", icon: "search" },
  waiting: false,
};

export const RELEASE_WATCHER: SidebarAgent = {
  assignment: sidebarAssignment(4),
  role: "operator",
  name: "Release watcher",
  profile: { kind: "initial", text: "RW" },
  waiting: false,
};

/** 일부러 섞인 순서다. component가 lophn, Context Engineer, Operator들(들어온 순서)로 놓는다. */
export const AGENTS_SHUFFLED: readonly SidebarAgent[] = [
  EVAL_ANALYST,
  LOPHN,
  RELEASE_WATCHER,
  CONTEXT_ENGINEER,
];

/** 같은 agent에서 답을 기다리는 session이 있는 것으로 바꾼다. */
export function waiting(agent: SidebarAgent): SidebarAgent {
  return { ...agent, waiting: true };
}
