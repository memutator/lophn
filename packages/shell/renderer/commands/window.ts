// 창 하나의 command registry와 keybinding service를 만들고 작업대 단축키 표를 묶는다. entry가 창마다
// 하나 만들고 Desktop이 document에 건다. React 밖에서도 같은 값을 쓴다.
import {
  type KeyOverrides,
  type KeyPlatform,
  resolveBindings,
} from "../../ipc/keybindings.ts";
import {
  createKeybindingService,
  type KeybindingService,
} from "./keybinding-service.ts";
import { type CommandRegistry, createCommandRegistry } from "./registry.ts";

export interface WindowCommands {
  readonly registry: CommandRegistry;
  readonly keybindings: KeybindingService;
  readonly platform: KeyPlatform;
  /** 사람이 바꾼 키(이 기기 platform). 팔레트 hint와 Settings › Keyboard가 읽는다. */
  overrides(): KeyOverrides;
  /** 사람이 바꾼 키를 창의 기본 바인딩에 덮고 main에도 알린다. 듣는 쪽(subscribe)도 부른다. */
  setOverrides(overrides: KeyOverrides): void;
  /** 사람이 바꾼 키가 바뀌면 listener를 부른다. 키 이름을 그리는 화면이 다시 그리게. */
  subscribe(listener: () => void): () => void;
}

/** Settings에서 새 키를 받는 칸. 그 안의 키는 command로 보내지 않는다. */
export const KEY_CAPTURE_ATTRIBUTE = "data-key-capture";

function closest(target: unknown, selector: string): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest(selector) !== null
  );
}

export function createWindowCommands(deps: {
  platform: KeyPlatform;
  log: (message: string, error: unknown) => void;
  /** main이 먼저 받는 키도 바뀐 키를 따르게 알린다. 통로가 없는 창(gallery)에서는 없다. */
  tellMain?: (overrides: KeyOverrides) => void;
}): WindowCommands {
  const registry = createCommandRegistry({ log: deps.log });
  const keybindings = createKeybindingService({
    registry,
    platform: deps.platform,
    inShell: (target) => closest(target, "[data-terminal-screen]"),
    ignores: (target) => closest(target, `[${KEY_CAPTURE_ATTRIBUTE}]`),
  });
  let current: KeyOverrides = {};
  const listeners = new Set<() => void>();
  // 표의 키는 창이 사는 동안 묶여 있다. command 주인이 없으면 키를 넘긴다.
  keybindings.setDefaults(resolveBindings(deps.platform, current));
  return {
    registry,
    keybindings,
    platform: deps.platform,
    overrides: () => current,
    setOverrides(overrides) {
      current = overrides;
      keybindings.setDefaults(resolveBindings(deps.platform, overrides));
      deps.tellMain?.(overrides);
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
