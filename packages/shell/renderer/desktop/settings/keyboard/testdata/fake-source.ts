// Keyboard 화면의 가짜 통로. 값은 가짜 core의 설정 `shell.keybindings`에 두고 고른 것도 거기 쓴다.
import { type FakeCore, fakeCore } from "../../testdata/fake-core.ts";
import { KEYBINDINGS_KEY } from "../core-source.ts";
import type { KeyboardSource, StoredKeybindings } from "../source.ts";

interface FakeKeyboardOptions {
  value?: StoredKeybindings;
  /** 저장이 거절되는 code. 없으면 저장된다. */
  writeCode?: string;
  /** 값을 둘 가짜 core. 없으면 새로 만든다. */
  core?: FakeCore;
}

export function fakeKeyboard(options: FakeKeyboardOptions = {}) {
  const core = options.core ?? fakeCore();
  let value: StoredKeybindings = options.value ?? {};
  core.set(KEYBINDINGS_KEY, value);
  const source: KeyboardSource = {
    read: () => Promise.resolve({ ok: true, value }),
    write(next) {
      if (options.writeCode) {
        return Promise.resolve({ ok: false, code: options.writeCode });
      }
      value = next;
      core.set(KEYBINDINGS_KEY, next);
      core.changed("settings");
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { source, core };
}
