// terminal 안 프로그램이 연 URL을 browser 탭으로 연다. main이 push하고, 이 창의 terminal(어느
// desk든)이면 탭을 연 뒤에만 ack한다. 이 창의 terminal이 아니면 ack하지 않아 다른 창이나
// OS browser로 간다.
import { useEffect, useRef } from "react";

import type { TerminalApi } from "../../ipc/terminal.ts";
import type { TabHost } from "../workspace/kinds/host.ts";
import { showAfter } from "../workspace/open-policy.ts";
import type { TerminalStore } from "./store.ts";

interface BridgeOpenRequest {
  terminal_ref: string;
  url: string;
}

let bridgeCount = 0;

/** 이 창의 어느 desk에든 그 terminal이 있으면 URL을 browser 탭으로 열고 true. 없으면 false다. 자리는 `showAfter`다. */
export function openBridgeUrl(
  host: TabHost,
  store: TerminalStore,
  request: BridgeOpenRequest,
): boolean {
  const terminal = host
    .windowTabs()
    .find(
      (tab) =>
        tab.kind === "terminal" &&
        store.get(tab.key)?.terminalRef === request.terminal_ref,
    );
  if (terminal === undefined) return false;
  let title = request.url;
  try {
    title = new URL(request.url).host || title;
  } catch {
    // 주소로 읽히지 않으면 url 그대로 이름이다.
  }
  host.openTab(
    {
      key: `browser-bridge-${Date.now().toString(36)}-${++bridgeCount}`,
      kind: "browser",
      title,
      fields: { url: request.url },
    },
    showAfter(host.view, terminal.key),
  );
  return true;
}

/** main이 push한 열기 요청마다 `open`을 부르고, true일 때만 ack한다. */
export function useBridgeOpenRequests(
  bridge: TerminalApi | null,
  open: (request: BridgeOpenRequest) => boolean,
): void {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (!bridge) return;
    return bridge.onBridgeOpen((request) => {
      if (latest.current(request)) {
        void bridge.ackBridgeOpen({ request: request.request, opened: true });
      }
    });
  }, [bridge]);
}
