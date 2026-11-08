// 창마다 하나인 tray pin 기억. workspace를 옮기면 WorkspaceWindow가 새로 mount되어 Tray의 지역 state가 사라지므로,
// pin한 popup의 항목 key(TrayItem.key)를 여기 들고 있다가 새 Tray가 다시 pin해서 연다. 저장하지 않는다.
// Desktop이 하나 만들어 context로 내리고, 없으면(gallery) 기억하지 않는다.
import { createContext, type ReactNode, useContext } from "react";

export interface TrayMemory {
  pinned: string | null;
}

export function createTrayMemory(): TrayMemory {
  return { pinned: null };
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
