// browser bridge의 main 쪽 몸통. 소켓도 Electron도 모르고 deps로만 일한다.
// 요청 줄의 key로 어느 terminal이 연 것인지 알고, 설정이 browser 탭이면 창에 열어 달라고 push해
// 그 창의 ack가 와야 `pane`으로 답한다. 못 열었으면 `declined`로 답해 shim이 OS browser로 연다.
import {
  TERMINAL_BRIDGE_OPEN_CHANNEL,
  type TerminalBridgeOpen,
} from "../../ipc/terminal.ts";
import {
  bridgeEnv,
  isRelayableUrl,
  type LinkPrefs,
  linkTarget,
  parseBridgeRequest,
} from "./policy.ts";
import type { TerminalBridge } from "./types.ts";

// shim의 SOCKET_TIMEOUT_MS(3000)보다 짧아야 declined 답이 shim 시간 안에 간다.
const ACK_TIMEOUT_MS = 1500;

export type BridgeDeps = {
  paths: { socket: string; shim: string };
  env: Readonly<Record<string, string | undefined>>;
  ids: { key(): string; request(): string };
  readPrefs(): Promise<LinkPrefs>;
  windows(): readonly { send(channel: string, payload: unknown): void }[];
  openExternal(url: string): void;
  timers: { after(ms: number, run: () => void): () => void };
  log(message: string): void;
};

export function createBridge(
  deps: BridgeDeps,
): TerminalBridge & {
  handleLine(line: string): Promise<"pane" | "declined">;
} {
  const keys = new Map<string, string>(); // key -> terminal_ref
  const pending = new Map<string, (opened: boolean) => void>();

  function offer(terminalRef: string, url: string): Promise<boolean> {
    const windows = deps.windows();
    if (windows.length === 0) return Promise.resolve(false);
    const request = deps.ids.request();
    return new Promise((resolve) => {
      const cancel = deps.timers.after(ACK_TIMEOUT_MS, () => settle(false));
      // 먼저 온 쪽이 이기고, 끝난 request의 늦은 ack는 pending에 없어 버려진다.
      function settle(opened: boolean) {
        if (!pending.delete(request)) return;
        cancel();
        resolve(opened);
      }
      pending.set(request, settle);
      const open: TerminalBridgeOpen = {
        request,
        terminal_ref: terminalRef,
        url,
      };
      for (const window of windows) {
        window.send(TERMINAL_BRIDGE_OPEN_CHANNEL, open);
      }
    });
  }

  return {
    issue() {
      const key = deps.ids.key();
      const env = bridgeEnv(
        deps.env as Record<string, string | undefined>,
        { shim: deps.paths.shim, socket: deps.paths.socket, key },
      );
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
    async openLink({ terminal_ref, url }) {
      if (!isRelayableUrl(url)) return;
      if (![...keys.values()].includes(terminal_ref)) {
        deps.openExternal(url);
        return;
      }
      const prefs = await deps.readPrefs();
      if (
        linkTarget(url, prefs) === "browser_tab" &&
        await offer(terminal_ref, url)
      ) return;
      deps.openExternal(url);
    },
    ack(request, opened) {
      if (opened) pending.get(request)?.(true);
    },
    async handleLine(line) {
      const request = parseBridgeRequest(line);
      if (request === null) return "declined";
      const terminalRef = keys.get(request.key);
      if (terminalRef === undefined) return "declined";
      const prefs = await deps.readPrefs();
      if (linkTarget(request.url, prefs) !== "browser_tab") return "declined";
      return await offer(terminalRef, request.url) ? "pane" : "declined";
    },
  };
}
