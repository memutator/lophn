// 창마다 하나인 열린 tray popup. workspace를 옮기면 WorkspaceWindow(그 안의 Tray 단추 줄)가 새로 mount되지만 popup은
// Desktop이 workspace 밖에 놓은 TrayPopupLayer가 이 store를 읽어 그린다. 그래서 pin한 popup은 다시 mount되지 않고 앱 화면도
// 다시 load되지 않는다. 저장하지 않는다. Provider가 없으면(gallery) Tray가 자기 store와 layer를 둔다.
import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";

import type { AppViewOpen } from "../../../ipc/app-frame.ts";
import type { PopupSize } from "./popup-place.ts";

/** popup이 그리는 tray 항목. Tray의 TrayItem과 같은 모양이다. */
export interface TrayPopupItem {
  readonly key: string;
  readonly app: string;
  readonly release: string;
  readonly screen: string;
  readonly title: string;
  readonly label: string;
  readonly size?: PopupSize;
}

export interface TrayOpen {
  readonly item: TrayPopupItem;
  readonly side: "above" | "below";
  /** 항목 단추의 오른쪽 끝(창 기준 px). popup의 가로 자리를 여기서 잰다. */
  readonly right: number;
  readonly pinned: boolean;
  /** 연 때의 workspace. pin한 채 workspace를 옮겨도 바꾸지 않는다(바꾸면 앱 화면이 다시 열린다). */
  readonly workspace: AppViewOpen["workspace"];
  /** 항목 단추들의 묶음. 여기를 누르는 것은 바깥이 아니다. 단추 줄이 내려가 있으면 null이다. */
  readonly anchor: HTMLElement | null;
}

export interface TrayMemory {
  get(): TrayOpen | null;
  set(next: TrayOpen | null): void;
  subscribe(listener: () => void): () => void;
}

export function createTrayMemory(): TrayMemory {
  let open: TrayOpen | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => open,
    set(next) {
      if (next === open) return;
      open = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const MemoryContext = createContext<TrayMemory | null>(null);

export function TrayMemoryProvider({
  memory,
  children,
}: {
  memory: TrayMemory;
  children: ReactNode;
}) {
  return (
    <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>
  );
}

export function useTrayMemory(): TrayMemory | null {
  return useContext(MemoryContext);
}

export function useTrayOpen(memory: TrayMemory): TrayOpen | null {
  return useSyncExternalStore(memory.subscribe, memory.get);
}
