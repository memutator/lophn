// 터미널 안 harness hook이 core에 닿는 길의 몸통. socket도 Electron도 protocol도 모르고 deps로만
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

/** 터미널 열기가 hook 길을 부르는 모양. */
export interface TerminalHooks {
  /** 새 터미널에 줄 env. 길이 꺼져 있으면 null. key를 만들 뿐 표에 넣지 않는다. */
  issue(): { key: string; env: Record<string, string> } | null;
  /** open이 성공한 뒤 key를 그 터미널에 묶는다. 묶이지 않은 key의 줄은 버린다. */
  bind(key: string, terminalRef: string): void;
  /** 터미널이 닫혔다. 그 터미널의 key를 버린다. */
  revoke(terminalRef: string): void;
  /** 그 터미널에 준 hook env. GUI가 띄운 CLI도 같은 탭으로 hook을 보내게 한다. 모르면 null. */
  envOf(terminalRef: string): Record<string, string> | null;
}

export type IngressDeps = {
  socket: string;
  /** env 이름. */
  envName: string;
  maxBytes: number;
  newKey(): string;
  /** 탭 요청(`<harness> gui`)의 event 이름. 이 event는 tracker가 아니라 `onGui`로 간다. */
  guiEvent: string;
  /** JSON으로 읽은 값이 계약의 줄이면 그 값, 아니면 null. */
  parse(value: unknown): HookLine | null;
  onHook(hook: RoutedHook): void;
  onGui(hook: RoutedHook): void;
};

export function createHookIngress(
  deps: IngressDeps,
): TerminalHooks & { handleLine(line: string): void } {
  const routes = new Map<string, { terminal_ref: string }>();
  // key를 준 env. bind 전에는 어느 터미널의 것인지 모른다.
  const issued = new Map<string, Record<string, string>>();
  const envs = new Map<string, Record<string, string>>(); // terminal_ref -> env

  return {
    issue() {
      const key = deps.newKey();
      const env = {
        [deps.envName]: JSON.stringify({ socket: deps.socket, key }),
      };
      issued.set(key, env);
      return { key, env };
    },
    bind(key, terminalRef) {
      routes.set(key, { terminal_ref: terminalRef });
      const env = issued.get(key);
      issued.delete(key);
      if (env !== undefined) envs.set(terminalRef, env);
    },
    revoke(terminalRef) {
      for (const [key, route] of routes) {
        if (route.terminal_ref === terminalRef) routes.delete(key);
      }
      envs.delete(terminalRef);
    },
    envOf: (terminalRef) => envs.get(terminalRef) ?? null,
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
      const routed = {
        ...route,
        harness: parsed.harness,
        event: parsed.event,
        payload: parsed.payload,
      };
      if (parsed.event === deps.guiEvent) deps.onGui(routed);
      else deps.onHook(routed);
    },
  };
}
