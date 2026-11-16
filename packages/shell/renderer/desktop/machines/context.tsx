// 기계 source를 화면에 건넨다. provider가 없으면 기계 조각은 아무것도 그리지 않는다(한 대만 쓰는 화면, 기계 보기가 없는 gallery page).
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

import type { MachineItem, MachinesSource, MachinesView } from "./source.ts";

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

/**
 * 이 창이 보는 다른 기계. null이면 이 컴퓨터의 창이다. 다른 기계의 창은 이 값으로 그 기계에서 부를 수 없는 기능을 감추고
 * 그 자리에 기계 이름을 보인다. 목록에 아직 없으면(starting) 붙는 중으로 본다.
 */
export function useWindowMachine(): MachineItem | null {
  const source = useMachines();
  const view = useMachinesView();
  const win = source?.thisWindow() ?? null;
  if (win === null) return null;
  return (
    view?.machines.find((one) => one.id === win.id) ?? {
      id: win.id,
      name: win.name,
      announcedName: null,
      alias: null,
      status: "connecting",
      path: null,
      lastSeenAt: null,
    }
  );
}
