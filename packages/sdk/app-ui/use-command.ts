import { useEffect, useRef } from "react";

// 앱 view preload bridge `lophnApp`의 key 부분(protocol/shell/app-bridge-types.ts)의 SDK 쪽 사본.
export interface CommandBridge {
  register(name: string, handler: () => void, when?: () => boolean): () => void;
}

export interface CommandOptions {
  /** 거짓을 돌려주는 동안 key는 삼키지 않고 shell로 넘긴다. 없으면 늘 참이다. */
  when?: () => boolean;
}

// 선언의 key `id` 하나에 handler를 건다. 화면이 mount된 동안만 살고, handler와 when은 부를 때의 가장 최근 것이다.
export function useCommand(
  id: string,
  handler: () => void,
  options?: CommandOptions,
): void {
  const latest = useRef({ handler, when: options?.when });
  latest.current = { handler, when: options?.when };
  useEffect(() => {
    const bridge = (globalThis as { lophnApp?: { commands?: CommandBridge } })
      .lophnApp?.commands;
    if (bridge === undefined) return;
    return bridge.register(
      id,
      () => latest.current.handler(),
      () => latest.current.when?.() ?? true,
    );
  }, [id]);
}
