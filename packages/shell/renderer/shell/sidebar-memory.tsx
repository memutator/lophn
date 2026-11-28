// 창마다 하나인 왼쪽 sidebar의 마지막 읽기 값. workspace를 옮기면 WorkspaceWindow가 새로 mount되어 sidebar가 빈 목록부터
// 다시 그리고 줄이 비었다 차오르며 깜빡인다. 마지막으로 읽은 값을 여기 들고 있다가 첫 그림에 쓰고, 새로 읽으면 바꾼다.
// 저장하지 않는다. Desktop이 하나 만들어 context로 내리고, 없으면(gallery) hook마다 빈 값에서 시작한다.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import type { TerminalAgentSession } from "../../../protocol/coding-agent/terminals.ts";
import type { SidebarAgent } from "../workspace/sidebar/sidebar-agent.ts";
import type { TabItem } from "./desk-model.ts";
import type {
  LayoutDesks,
  SidebarWaitingWorkflow,
} from "./left-sidebar-workspaces.ts";

export interface SidebarValues {
  readonly agents: readonly SidebarAgent[];
  /** lophn agent id → 이름. 다른 workspace의 이름 없는 session 줄이 쓴다. */
  readonly lophnNames: Readonly<Record<string, string>>;
  /** workspace key → session id → Agent 탭 제목(다른 workspace의 layout, Agent 탭은 이 창 메모리의 것). */
  readonly elsewhereTitles: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** workspace key → 터미널 참조가 있는 터미널 탭(다른 workspace의 layout). */
  readonly elsewhereTerminals: ReadonlyMap<string, readonly TabItem[]>;
  /** workspace key → 그 workspace의 desk(다른 workspace의 layout, Agent 탭은 이 창 메모리의 것). */
  readonly elsewhereDesks: ReadonlyMap<string, LayoutDesks>;
  /** workspace key → core가 저장한 coding agent session. */
  readonly savedTerminals: ReadonlyMap<string, readonly TerminalAgentSession[]>;
  /** project id → 사람 차례를 기다리는 workflow instance. */
  readonly workflows: ReadonlyMap<string, readonly SidebarWaitingWorkflow[]>;
  /** 펼친 Recent의 workspace key. */
  readonly recentExpanded: ReadonlySet<string>;
  /** workspace key → 펼친 Recent의 page 번호(0부터). */
  readonly recentPages: ReadonlyMap<string, number>;
  /** 펼친 다른 기계 묶음의 기계 id. */
  readonly machinesOpen: ReadonlySet<string>;
  /** 탭 줄을 펼친 session id. */
  readonly sessionTabsOpen: ReadonlySet<string>;
  /** 팀 자식 줄을 접은 session id. */
  readonly teamCollapsed: ReadonlySet<string>;
  /** 펼친 session group 묶음의 key(`<workspace>\0<desk>\0<group>`). 기본은 접힘이다. */
  readonly sessionGroupsOpen: ReadonlySet<string>;
}

const EMPTY: SidebarValues = {
  agents: [],
  lophnNames: {},
  elsewhereTitles: new Map(),
  elsewhereTerminals: new Map(),
  elsewhereDesks: new Map(),
  savedTerminals: new Map(),
  workflows: new Map(),
  recentExpanded: new Set(),
  recentPages: new Map(),
  machinesOpen: new Set(),
  sessionTabsOpen: new Set(),
  teamCollapsed: new Set(),
  sessionGroupsOpen: new Set(),
};

export interface SidebarMemory {
  values: SidebarValues;
}

export function createSidebarMemory(): SidebarMemory {
  return { values: EMPTY };
}

const MemoryContext = createContext<SidebarMemory | null>(null);

export function SidebarMemoryProvider({
  memory,
  children,
}: {
  memory: SidebarMemory;
  children: ReactNode;
}) {
  return (
    <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>
  );
}

/** useState와 같지만 처음 값이 창의 마지막 값이고, 바꾸면 창의 값도 바꾼다. */
export function useRemembered<K extends keyof SidebarValues>(
  key: K,
): readonly [
  SidebarValues[K],
  (next: (now: SidebarValues[K]) => SidebarValues[K]) => void,
] {
  const memory = useContext(MemoryContext);
  const [value, setValue] = useState<SidebarValues[K]>(
    () => memory?.values[key] ?? EMPTY[key],
  );
  const latest = useRef(value);
  const set = useCallback(
    (next: (now: SidebarValues[K]) => SidebarValues[K]) => {
      const value = next(latest.current);
      latest.current = value;
      if (memory !== null) memory.values = { ...memory.values, [key]: value };
      setValue(value);
    },
    [memory, key],
  );
  return [value, set];
}
