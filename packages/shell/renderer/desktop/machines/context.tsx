// 기계 source를 화면에 건넨다. provider가 없으면 기계 조각은 아무것도 그리지 않는다(한 대만 쓰는 화면, 기계 보기가 없는 gallery page).
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { MachineRef } from "./scope.tsx";
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

// 화면이 지금 그리는 기계. `MachineScope`가 준다.
const ScopeMachineContext = createContext<MachineRef | undefined>(undefined);

export const ScopeMachineProvider = ScopeMachineContext.Provider;

/**
 * 범위의 기계. null이면 이 컴퓨터다. 범위 밖(범위를 두지 않고 그리는 gallery page)이면 창이 보는 기계다.
 * `scope.tsx`가 이 이름으로 내놓는다.
 */
export function useScopeMachine(): MachineRef {
  const scope = useContext(ScopeMachineContext);
  const source = useMachines();
  return scope === undefined ? (source?.thisWindow()?.id ?? null) : scope;
}

/**
 * 명단의 기계 하나. 목록을 아직 모르면(starting) 붙는 중이고, 아는 목록에 없으면 명단에서 빠진 것(removed)이다.
 * 이름을 모르면 창이 처음 받은 그 기계의 이름이다.
 */
export function machineItemOf(
  source: MachinesSource | null,
  view: MachinesView | null,
  machine: string,
): MachineItem {
  const win = source?.thisWindow() ?? null;
  return (
    view?.machines.find((one) => one.id === machine) ?? {
      id: machine,
      name: win?.id === machine ? win.name : "",
      status: view?.state === "ready" ? "removed" : "connecting",
      update: null,
      path: null,
      lastSeenAt: null,
    }
  );
}

/**
 * 범위의 다른 기계. null이면 이 컴퓨터다. 그 기계에서 부를 수 없는 기능을 감추고 그 자리에 기계 이름을 보이는 쪽이 쓴다.
 */
export function useWindowMachine(): MachineItem | null {
  const machine = useScopeMachine();
  const source = useMachines();
  const view = useMachinesView();
  return machine === null ? null : machineItemOf(source, view, machine);
}

/** 그 기계가 이 컴퓨터에 사람의 route(설정, provider, project 더하기)를 열었는지 묻는다. 거절(forbidden)이면 false다. */
export type MachineGrantCheck = () => Promise<boolean>;

const GrantContext = createContext<MachineGrantCheck | null>(null);

export function MachineGrantProvider({
  check,
  children,
}: {
  check: MachineGrantCheck;
  children: ReactNode;
}) {
  return (
    <GrantContext.Provider value={check}>{children}</GrantContext.Provider>
  );
}

/**
 * 범위의 기계 설정을 바꿀 수 있는지. 묻는 길은 범위가 준다(그 기계 묶음의 `grant()`). 이 컴퓨터의 범위와 묻는 길이 없는
 * 화면(gallery)은 granted다. 허락은 사람이 아무 컴퓨터에서나
 * 바꾸므로 쓰는 화면이 열릴 때마다(`open`이 켜질 때마다, Settings는 항목을 열 때마다 `at`이 바뀐다) 다시 묻는다. 다시 묻는 동안은
 * 앞의 답을 그대로 보인다.
 */
export function useMachineGrant(
  open = true,
  at?: string,
): "checking" | "granted" | "denied" {
  const machine = useWindowMachine();
  const check = useContext(GrantContext);
  const asks = open && machine !== null && check !== null;
  const [state, setState] = useState<"checking" | "granted" | "denied">(
    asks ? "checking" : "granted",
  );
  useEffect(() => {
    if (!asks) return;
    let live = true;
    void check().then((granted) => {
      if (live) setState(granted ? "granted" : "denied");
    });
    return () => {
      live = false;
    };
  }, [asks, check, at]);
  return asks ? state : "granted";
}
