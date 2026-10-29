// command 표의 React 쪽. 등록과 해제의 때만 맡고 판정은 registry·keybinding service가 한다.
import { createContext, useContext, useEffect, useRef } from "react";

import type { CommandHandler, CommandOptions } from "./registry.ts";
import type { WindowCommands } from "./window.ts";

const CommandsContext = createContext<WindowCommands | null>(null);

export const CommandsProvider = CommandsContext.Provider;

/** 창의 command 표. Desktop 밖(provider 없음)에서는 null이다. */
export function useWindowCommands(): WindowCommands | null {
  return useContext(CommandsContext);
}

/**
 * 화면이 mount되어 있는 동안 command를 올린다. handler는 그릴 때마다 새로 넘겨도 되고 부를 때
 * 가장 최근 것을 쓴다. 올리는 id가 바뀔 때만 다시 등록한다.
 */
export function useCommands(
  handlers: Readonly<Record<string, CommandHandler>>,
  options?: CommandOptions,
): void {
  const commands = useContext(CommandsContext);
  const latest = useRef({ handlers, options });
  latest.current = { handlers, options };
  const ids = Object.keys(handlers).join("\n");
  useEffect(() => {
    if (commands === null || ids === "") return;
    const all = ids
      .split("\n")
      .map((id) =>
        commands.registry.register(
          id,
          (arg) => latest.current.handlers[id]?.(arg),
          { when: () => latest.current.options?.when?.() ?? true },
        ),
      );
    return () => {
      for (const one of all) one.dispose();
    };
  }, [commands, ids]);
}
