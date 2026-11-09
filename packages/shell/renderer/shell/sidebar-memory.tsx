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

import type { TerminalAgentSession } from "../../ipc/terminal.ts";
import type { AppRow } from "../apps/source.ts";
import type { ProjectItem } from "../desktop/workspaces/projects/source.ts";
import type { SidebarAgent } from "../workspace/sidebar/sidebar-agent.ts";
import type { TabItem } from "./desk-model.ts";
import type { KnownSessions, LayoutDesks } from "./left-sidebar-workspaces.ts";

export interface SidebarValues {
  readonly projects: readonly ProjectItem[];
  readonly apps: readonly AppRow[];
  readonly agents: readonly SidebarAgent[];
  /** lophn agent id → 이름. 다른 workspace의 이름 없는 session 줄이 쓴다. */
  readonly lophnNames: Readonly<Record<string, string>>;
  readonly known: KnownSessions;
  /** workspace key → session id → Agent 탭 제목(다른 workspace의 저장된 layout). */
  readonly elsewhereTitles: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** workspace key → coding agent가 돈 적이 있는 터미널 탭(다른 workspace의 저장된 layout). */
  readonly elsewhereTerminals: ReadonlyMap<string, readonly TabItem[]>;
  /** workspace key → 그 workspace의 desk(다른 workspace의 저장된 layout). */
  readonly elsewhereDesks: ReadonlyMap<string, LayoutDesks>;
  /** project id → main이 저장한 coding agent session. */
  readonly savedTerminals: ReadonlyMap<string, readonly TerminalAgentSession[]>;
  /** project id → 사람 차례를 기다리는 workflow 이름. */
  readonly workflows: ReadonlyMap<string, readonly string[]>;
}

const EMPTY: SidebarValues = {
  projects: [],
  apps: [],
  agents: [],
  lophnNames: {},
  known: new Map(),
  elsewhereTitles: new Map(),
  elsewhereTerminals: new Map(),
  elsewhereDesks: new Map(),
  savedTerminals: new Map(),
  workflows: new Map(),
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
