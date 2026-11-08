// 탭마다 agent가 다루는 중인지(agent)와 사람이 가져왔는지(held). shell main 메모리에만 있고 core는 모른다.
export interface ControlState {
  agent: boolean;
  held: boolean;
}

export function createTabControl(
  push: (tab: string, state: ControlState) => void,
) {
  const states = new Map<string, ControlState>();
  const set = (tab: string, state: ControlState) => {
    states.set(tab, state);
    push(tab, state);
  };
  return {
    /** agent가 그 탭을 불렀다. 첫 호출부터 다루는 중이다. */
    touch(tab: string): void {
      if (!states.has(tab)) set(tab, { agent: true, held: false });
    },
    held: (tab: string): boolean => states.get(tab)?.held === true,
    take(tab: string): void {
      if (states.get(tab)?.agent === true)
        set(tab, { agent: true, held: true });
    },
    release(tab: string): void {
      if (states.get(tab)?.held === true)
        set(tab, { agent: true, held: false });
    },
    /** 탭이 닫혔다. */
    forget(tab: string): void {
      states.delete(tab);
    },
    current: (tab: string): ControlState | undefined => states.get(tab),
  };
}

export type TabControl = ReturnType<typeof createTabControl>;
