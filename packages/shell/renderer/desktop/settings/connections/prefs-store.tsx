// 기계마다 하나인 coding agent 설정 provider(`shell.coding_agents`). `MachineScope`가 그 기계의 `EventsProvider` 안에서
// 내려 주므로 Settings › Coding agents와 workspace의 + / Terminal hover가 모두 지금 범위 기계의 core를 읽고 쓴다.
import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";

import { useStateChanged } from "../../connection/core-read.ts";
import {
  type CodingPrefs,
  type CodingPrefsStore,
  DEFAULT_CODING_PREFS,
} from "./prefs.ts";

const CodingPrefsContext = createContext<CodingPrefsStore | null>(null);

export function CodingPrefsProvider({
  store,
  children,
}: {
  store: CodingPrefsStore | null | undefined;
  children: ReactNode;
}) {
  useStateChanged(["settings"], () => store?.reload());
  return (
    <CodingPrefsContext.Provider value={store ?? null}>
      {children}
    </CodingPrefsContext.Provider>
  );
}

const noSubscribe = () => () => {};
const defaultSnapshot = () => DEFAULT_CODING_PREFS;
const noSet: CodingPrefsStore["set"] = () => {};

/** 지정한 기계의 coding agent 설정 store를 구독한다. store가 없으면 기본값이고 쓰기는 버린다. */
export function useCodingPrefsStore(
  store: CodingPrefsStore | null | undefined,
): {
  coding: CodingPrefs;
  set: CodingPrefsStore["set"];
} {
  const coding = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.snapshot ?? defaultSnapshot,
  );
  return { coding, set: store?.set ?? noSet };
}

/** 지금 범위 기계의 coding agent 설정. provider가 없으면(gallery, test) 기본값이고 쓰기는 버린다. */
export function useCodingPrefs(): {
  coding: CodingPrefs;
  set: CodingPrefsStore["set"];
} {
  return useCodingPrefsStore(useContext(CodingPrefsContext));
}
