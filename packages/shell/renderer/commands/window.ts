// 창 하나의 command registry와 keybinding service를 만들고 작업대 단축키 표를 묶는다. entry가 창마다
// 하나 만들고 Desktop이 document에 건다. React 밖에서도 같은 값을 쓴다.
import { KEYBINDINGS, type KeyPlatform } from "../../ipc/keybindings.ts";
import {
  createKeybindingService,
  type KeybindingService,
} from "./keybinding-service.ts";
import { type CommandRegistry, createCommandRegistry } from "./registry.ts";

export interface WindowCommands {
  readonly registry: CommandRegistry;
  readonly keybindings: KeybindingService;
}

export function createWindowCommands(deps: {
  platform: KeyPlatform;
  log: (message: string, error: unknown) => void;
}): WindowCommands {
  const registry = createCommandRegistry({ log: deps.log });
  const keybindings = createKeybindingService({
    registry,
    platform: deps.platform,
    inShell: (target) =>
      typeof Element !== "undefined" &&
      target instanceof Element &&
      target.closest("[data-terminal-screen]") !== null,
  });
  // 표의 키는 창이 사는 동안 묶여 있다. command 주인이 없으면 키를 넘긴다.
  for (const binding of KEYBINDINGS) keybindings.register(binding);
  return { registry, keybindings };
}
