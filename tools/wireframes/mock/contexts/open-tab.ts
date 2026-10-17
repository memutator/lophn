// body와 children으로 얹은 화면이 탭을 열 때 쓰는 통로. ProjectHost가 값을 준다.
import { createContext, useContext } from "react";

import type { TabSpec } from "../../pages/screens/project-window.tsx";

export type OpenTab = (tab: TabSpec, other?: boolean) => void;

interface Host {
  readonly open: OpenTab;
  /** 탭을 연 횟수. 0보다 크면 toast 같은 처음 상태는 지나간 것이다. */
  readonly opened: number;
}

const HostContext = createContext<Host>({ open: () => {}, opened: 0 });

export const HostProvider = HostContext.Provider;
export const useOpenTab = () => useContext(HostContext).open;
