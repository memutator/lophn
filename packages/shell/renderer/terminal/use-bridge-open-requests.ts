// terminal 안 프로그램이 연 URL을 browser 탭으로 연다. main이 push하고, 이 창의 terminal이면
// 탭을 연 뒤에만 ack한다. 이 창의 terminal이 아니면 ack하지 않아 다른 창이나 OS browser로 간다.
import { useEffect, useRef } from "react";

import type { TerminalApi } from "../../ipc/terminal.ts";
import type { TabHost } from "../workspace/kinds/host.ts";
import { allTabs, type WorkspaceView } from "../workspace/model.ts";
import type { TerminalStore } from "./store.ts";

interface BridgeOpenRequest {
  terminal_ref: string;
  url: string;
}

let bridgeCount = 0;

/**
 * 새 탭을 넣을 자리. pane이 둘이면 terminal 반대쪽 pane의 마지막 탭 뒤, 하나면 terminal 바로 뒤다.
 * terminal이 floated이거나 pane에 없으면 undefined이고 focus pane 끝에 연다.
 */
export function bridgeAfter(
  view: WorkspaceView,
  terminalKey: string,
): string | undefined {
  const at = view.panes.findIndex((pane) =>
    pane.tabs.some((tab) => tab.key === terminalKey)
  );
  if (at < 0) return undefined;
  if (view.panes.length !== 2) return terminalKey;
  return view.panes[1 - at].tabs.at(-1)?.key;
}

/** 이 창에 그 terminal이 있으면 URL을 browser 탭으로 열고 true. 없으면 false다. */
export function openBridgeUrl(
  host: TabHost,
  store: TerminalStore,
  request: BridgeOpenRequest,
): boolean {
  const terminal = allTabs(host.view).find((tab) =>
    tab.kind === "terminal" &&
    store.get(tab.key)?.terminalRef === request.terminal_ref
  );
  if (terminal === undefined) return false;
  let title = request.url;
  try {
    title = new URL(request.url).host || title;
  } catch {
    // 주소로 읽히지 않으면 url 그대로 이름이다.
  }
  host.openTab({
    key: `browser-bridge-${Date.now().toString(36)}-${++bridgeCount}`,
    kind: "browser",
    title,
    fields: { url: request.url },
  }, { after: bridgeAfter(host.view, terminal.key) });
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
