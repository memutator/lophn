// Keyboard 화면의 가짜 통로. core를 부르지 않고 고른 것을 메모리에 둔다.
import type { KeyboardSource, StoredKeybindings } from "../source.ts";

interface FakeKeyboardOptions {
  value?: StoredKeybindings;
  /** 저장이 거절되는 code. 없으면 저장된다. */
  writeCode?: string;
  readFails?: boolean;
}

export function fakeKeyboard(options: FakeKeyboardOptions = {}) {
  let value: StoredKeybindings = options.value ?? {};
  const source: KeyboardSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    read: () =>
      Promise.resolve(
        options.readFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value },
      ),
    write(next) {
      if (options.writeCode) {
        return Promise.resolve({ ok: false, code: options.writeCode });
      }
      value = next;
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { source };
}
