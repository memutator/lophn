// 터미널 안 harness hook이 shell main에 닿는 길의 몸통. socket도 Electron도 protocol도 모르고 deps로만
// 일한다(browser-bridge/bridge.ts와 같은 꼴). 줄 하나의 key로 어느 터미널의 hook인지 알고, 답은 없다.
// 모르는 key, 너무 긴 줄, 깨진 줄은 조용히 버린다.

export type HookLine = {
  key: string;
  harness: string;
  event: string;
  payload: unknown;
};

export type RoutedHook = {
  terminal_ref: string;
  harness: string;
  event: string;
  payload: unknown;
};

/** terminal IPC가 hook 길을 부르는 모양. */
export interface TerminalHooks {
  /** 새 터미널에 줄 env. 길이 꺼져 있으면 null. key를 만들 뿐 표에 넣지 않는다. */
  issue(): { key: string; env: Record<string, string> } | null;
  /** open이 성공한 뒤 key를 그 터미널에 묶는다. 묶이지 않은 key의 줄은 버린다. */
  bind(key: string, terminalRef: string): void;
  /** 터미널이 닫혔다. 그 터미널의 key를 버린다. */
  revoke(terminalRef: string): void;
}

export type IngressDeps = {
  socket: string;
  /** env 이름. */
  envName: string;
  maxBytes: number;
  newKey(): string;
  /** JSON으로 읽은 값이 계약의 줄이면 그 값, 아니면 null. */
  parse(value: unknown): HookLine | null;
  onHook(hook: RoutedHook): void;
};

export function createHookIngress(
  deps: IngressDeps,
): TerminalHooks & { handleLine(line: string): void } {
  const routes = new Map<string, { terminal_ref: string }>();

  return {
    issue() {
      const key = deps.newKey();
      return {
        key,
        env: {
          [deps.envName]: JSON.stringify({ socket: deps.socket, key }),
        },
      };
    },
    bind(key, terminalRef) {
      routes.set(key, { terminal_ref: terminalRef });
    },
    revoke(terminalRef) {
      for (const [key, route] of routes) {
        if (route.terminal_ref === terminalRef) routes.delete(key);
      }
    },
    handleLine(line) {
      if (new TextEncoder().encode(line).length > deps.maxBytes) return;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return;
      }
      const parsed = deps.parse(value);
      if (parsed === null) return;
      const route = routes.get(parsed.key);
      if (route === undefined) return;
      deps.onHook({
        ...route,
        harness: parsed.harness,
        event: parsed.event,
        payload: parsed.payload,
      });
    },
  };
}
