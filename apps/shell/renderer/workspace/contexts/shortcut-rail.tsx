// 접힌 sidebar의 바로 가기 rail: Terminal · Contexts · Saved views · Search · Agent
// (shell/workspace#R32). 누르면 그 종류의 탭을 열 일을 부른 쪽에 맡기고 단추마다 이름 tooltip이
// 보인다. 구현은 ctx-I51.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.label.rail-agent
//   contexts.label.rail-contexts
//   contexts.label.rail-saved-views
//   contexts.label.rail-search
//   contexts.label.rail-shortcuts
//   contexts.label.rail-terminal
import type { ReactNode } from "react";
import type { Timer } from "@lophn/design/components";

export const RAIL_ACTIONS = [
  "terminal",
  "contexts",
  "saved",
  "search",
  "agent",
] as const;
export type RailAction = typeof RAIL_ACTIONS[number];

export interface ShortcutRailProps {
  readonly onOpen: (action: RailAction) => void;
  /** tooltip이 뜨기까지의 지연을 재는 timer. 시험이 시간을 세우려고 주입한다. */
  readonly timer?: Timer;
}

export function ShortcutRail(_props: ShortcutRailProps): ReactNode {
  return null;
}
