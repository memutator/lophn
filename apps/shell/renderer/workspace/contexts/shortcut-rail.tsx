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
import {
  conversationIcons,
  IconButton,
  type IconProps,
  lophnSpaceIcons,
  paletteIcons,
  type Timer,
  Tooltip,
  workspaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./shortcut-rail.module.css";

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

// 아이콘은 design이 고른 것만 쓴다. 화면이 lucide를 직접 들이지 않는다.
const ICONS: Readonly<Record<RailAction, IconProps["icon"]>> = {
  terminal: workspaceIcons.terminal,
  contexts: workspaceIcons.context,
  saved: lophnSpaceIcons.savedView,
  search: paletteIcons.search,
  agent: conversationIcons.dock,
};

export function ShortcutRail({ onOpen, timer }: ShortcutRailProps): ReactNode {
  const labels: Readonly<Record<RailAction, string>> = {
    terminal: t("contexts.label.rail-terminal"),
    contexts: t("contexts.label.rail-contexts"),
    saved: t("contexts.label.rail-saved-views"),
    search: t("contexts.label.rail-search"),
    agent: t("contexts.label.rail-agent"),
  };
  return (
    <div
      className={styles.rail}
      role="toolbar"
      aria-label={t("contexts.label.rail-shortcuts")}
    >
      <hr className={styles.rule} />
      {RAIL_ACTIONS.map((action) => (
        <Tooltip key={action} content={labels[action]} timer={timer}>
          <IconButton
            icon={ICONS[action]}
            label={labels[action]}
            data-rail-action={action}
            onClick={() =>
              onOpen(action)}
          />
        </Tooltip>
      ))}
    </div>
  );
}
