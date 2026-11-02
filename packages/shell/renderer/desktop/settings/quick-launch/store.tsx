// 창마다 하나인 빠른 실행 전역 값. Settings 화면과 place 창이 같이 읽고 쓴다. 쓰기는 먼저 화면에 반영하고
// core에 보낸 뒤 거절되면 다시 읽는다. 다른 창이 바꾼 값은 창에 focus가 돌아올 때 다시 읽는다.
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  DEFAULT_QUICK_PREFS,
  type QuickPrefs,
  type QuickPrefsSource,
} from "./source.ts";

export interface QuickPrefsStore {
  snapshot(): QuickPrefs;
  subscribe(listener: () => void): () => void;
  set<K extends keyof QuickPrefs>(key: K, value: QuickPrefs[K]): void;
  /** 처음 읽기와 다시 읽기를 건다. 해제는 반환 함수다. */
  start(): () => void;
}

export function createQuickPrefsStore(
  source: QuickPrefsSource,
): QuickPrefsStore {
  let value = DEFAULT_QUICK_PREFS;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  // 쓰기 전에 떠난 읽기가 늦게 와서 새 값을 덮지 않게 한다.
  let generation = 0;
  const reload = () => {
    const at = ++generation;
    void source.read().then((read) => {
      if (!read.ok || at !== generation) return;
      value = read.value;
      emit();
    });
  };
  return {
    snapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(key, next) {
      generation++;
      value = { ...value, [key]: next };
      emit();
      void source.write(key, next).then((result) => {
        if (!result.ok) reload();
      });
    },
    start() {
      const off = source.watch((state) => {
        if (state.state === "ready") reload();
      });
      const onFocus = () => reload();
      window.addEventListener("focus", onFocus);
      return () => {
        off();
        window.removeEventListener("focus", onFocus);
      };
    },
  };
}

const QuickPrefsContext = createContext<QuickPrefsStore | null>(null);

export function QuickPrefsProvider({
  source,
  children,
}: {
  source: QuickPrefsSource | undefined;
  children: ReactNode;
}) {
  const store = useMemo(
    () => (source === undefined ? null : createQuickPrefsStore(source)),
    [source],
  );
  useEffect(() => store?.start(), [store]);
  return (
    <QuickPrefsContext.Provider value={store}>
      {children}
    </QuickPrefsContext.Provider>
  );
}

const noSubscribe = () => () => {};
const defaultSnapshot = () => DEFAULT_QUICK_PREFS;
const noSet: QuickPrefsStore["set"] = () => {};

/** provider가 없으면(gallery, test) 기본값이고 쓰기는 버린다. */
export function useQuickPrefs(): {
  prefs: QuickPrefs;
  set: QuickPrefsStore["set"];
} {
  const store = useContext(QuickPrefsContext);
  const prefs = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.snapshot ?? defaultSnapshot,
  );
  return { prefs, set: store?.set ?? noSet };
}
