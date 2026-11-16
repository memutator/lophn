// 기계 source를 화면에 건넨다. provider가 없으면 기계 조각은 아무것도 그리지 않는다(한 대만 쓰는 화면, 기계 보기가 없는 gallery page).
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

import type { MachinesSource, MachinesView } from "./source.ts";

const MachinesContext = createContext<MachinesSource | null>(null);

export function MachinesProvider({
  source,
  children,
}: {
  source: MachinesSource;
  children: ReactNode;
}) {
  return (
    <MachinesContext.Provider value={source}>
      {children}
    </MachinesContext.Provider>
  );
}

export function useMachines(): MachinesSource | null {
  return useContext(MachinesContext);
}

/** source가 있으면 지금 목록을 따라간다. */
export function useMachinesView(): MachinesView | null {
  const source = useMachines();
  const subscribe = useCallback(
    (listener: () => void) => source?.subscribe(listener) ?? (() => {}),
    [source],
  );
  return useSyncExternalStore(subscribe, () => source?.get() ?? null);
}
