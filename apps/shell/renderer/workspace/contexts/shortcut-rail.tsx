// 접힌 sidebar의 바로 가기 rail: Terminal · Contexts · Saved views · Search · Agent
// (shell/workspace#R32). 누르면 그 종류의 탭을 열 일을 부른 쪽에 맡기고 단추마다 이름 tooltip이
// 보인다. 구현은 ctx-I51.
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
