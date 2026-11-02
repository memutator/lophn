// 메모리에만 쥐는 빠른 실행 값. dev mock과 gallery가 쓴다.
import {
  DEFAULT_QUICK_PREFS,
  type QuickPrefs,
  type QuickPrefsSource,
} from "../source.ts";

export function memoryQuickPrefsSource(
  initial: QuickPrefs = DEFAULT_QUICK_PREFS,
): QuickPrefsSource {
  let value = initial;
  return {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    read: () => Promise.resolve({ ok: true, value }),
    write(key, next) {
      value = { ...value, [key]: next };
      return Promise.resolve({ ok: true, value: null });
    },
  };
}
