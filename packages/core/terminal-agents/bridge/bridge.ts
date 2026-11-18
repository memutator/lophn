// browser bridge의 core 쪽 몸통. 소켓은 모르고 deps로만 일한다. 요청 줄의 key로 어느 터미널이 연 것인지 알고, 설정이
// browser 탭이면 그 터미널의 project에 browser 탭을 열어 달라고 하고(`open`) 열렸으면 `pane`으로 답한다. 못 열었으면(shell이
// 붙어 있지 않거나 창이 거절했다) `declined`로 답해 shim이 OS browser로 연다.
import {
  bridgeEnv,
  type LinkPrefs,
  linkTarget,
  parseBridgeRequest,
} from "./policy.ts";

export type BridgeDeps = {
  paths: { socket: string; shim: string };
  env: Readonly<Record<string, string | undefined>>;
  ids: { key(): string };
  readPrefs(): Promise<LinkPrefs>;
  /** 그 터미널의 project에 browser 탭을 열고 열렸는지 답한다. shim 기한(3초) 안에 끝나야 한다. */
  open(terminalRef: string, url: string): Promise<boolean>;
};

export type TerminalBridge = {
  /** 새 shell에 줄 env. 사용자가 BROWSER를 두었으면 null. 이 호출은 key를 만들 뿐 표에 넣지 않는다. */
  issue(): { key: string; env: Record<string, string> } | null;
  /** 열기가 성공한 뒤 key를 그 터미널에 묶는다. 묶이지 않은 key의 요청은 declined다. */
  bind(key: string, terminalRef: string): void;
  /** 터미널이 끝났다. 그 터미널의 key를 버린다. */
  revoke(terminalRef: string): void;
  handleLine(line: string): Promise<"pane" | "declined">;
};

export function createBridge(deps: BridgeDeps): TerminalBridge {
  const keys = new Map<string, string>(); // key -> terminal_ref

  return {
    issue() {
      const key = deps.ids.key();
      const env = bridgeEnv(deps.env as Record<string, string | undefined>, {
        shim: deps.paths.shim,
        socket: deps.paths.socket,
        key,
      });
      return env === null ? null : { key, env };
    },
    bind(key, terminalRef) {
      keys.set(key, terminalRef);
    },
    revoke(terminalRef) {
      for (const [key, ref] of keys) {
        if (ref === terminalRef) keys.delete(key);
      }
    },
    async handleLine(line) {
      const request = parseBridgeRequest(line);
      if (request === null) return "declined";
      const terminalRef = keys.get(request.key);
      if (terminalRef === undefined) return "declined";
      const prefs = await deps.readPrefs();
      if (linkTarget(request.url, prefs) !== "browser_tab") return "declined";
      return (await deps.open(terminalRef, request.url)) ? "pane" : "declined";
    },
  };
}
