import { useEffect, useRef, useState } from "react";

// 앱 view preload bridge `lophnApp`의 탭 머리 줄 부분의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).

export interface TabHeadItem {
  id: string;
  label: string;
  disabled?: boolean;
}

// lophn이 자기 icon으로 그리는 이름. 모르는 이름은 무시하고 글 단추로 그린다.
export type TabHeadIcon =
  | "refresh"
  | "add"
  | "open"
  | "edit"
  | "delete"
  | "copy"
  | "run"
  | "stop"
  | "download";

export interface TabHeadAction extends TabHeadItem {
  primary?: boolean;
  busy?: boolean;
  // tray popup 머리 줄은 단추를 icon으로만 그린다(label은 tooltip). icon이 없으면 작은 글 단추다.
  icon?: TabHeadIcon;
}

// 탭 머리 줄에 올리는 것. 글과 id만 싣고 그리는 것은 lophn이다.
export interface TabHead {
  crumbs?: string[];
  status?: string;
  tabs?: { items: TabHeadItem[]; selected: string | null };
  actions?: TabHeadAction[];
  menu?: TabHeadItem[];
  nav?: { canBack: boolean; canForward: boolean };
}

export type TabHeadEvent =
  | { type: "shown"; shown: boolean }
  | { type: "tab" | "action" | "menu"; id: string }
  | { type: "back" | "forward" };

export interface TabHeadBridge {
  setTabHead(head: TabHead | null): void;
  onTabHead(listener: (event: TabHeadEvent) => void): () => void;
}

export interface TabHeadHandlers {
  onTab?(id: string): void;
  onAction?(id: string): void;
  onMenu?(id: string): void;
  onBack?(): void;
  onForward?(): void;
}

function tabHeadBridge(): TabHeadBridge | undefined {
  const app = (globalThis as { lophnApp?: Partial<TabHeadBridge> }).lophnApp;
  return app?.setTabHead !== undefined && app.onTabHead !== undefined
    ? (app as TabHeadBridge)
    : undefined;
}

// bridge는 받기 시작할 때 지금 shown을 곧바로 준다. 첫 render부터 맞는 값을 쓰려고 한 번 받고 바로 끊는다.
function shownNow(app: TabHeadBridge | undefined): boolean {
  let shown = false;
  if (app === undefined) return shown;
  const off = app.onTabHead((event) => {
    if (event.type === "shown") shown = event.shown;
  });
  off();
  return shown;
}

/**
 * 이 화면이 열린 lophn 탭의 머리 줄에 head를 올린다. 누름은 handlers가 받는다. lophn이 그 머리 줄을 그리면
 * true이고, 화면이 탭 밖(앱 창, 떠 있는 패널, 세션 카드)이라 그릴 곳이 없으면 false다. false면 같은 조작을
 * 화면이 스스로 그린다. head는 값이 바뀔 때만 다시 올리고 화면이 사라지면 내린다.
 */
export function useTabHead(
  head: TabHead | null,
  handlers: TabHeadHandlers = {},
  app: TabHeadBridge | undefined = tabHeadBridge(),
): boolean {
  const [shown, setShown] = useState(() => shownNow(app));
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (app === undefined) return;
    return app.onTabHead((event) => {
      const on = latest.current;
      if (event.type === "shown") setShown(event.shown);
      else if (event.type === "tab") on.onTab?.(event.id);
      else if (event.type === "action") on.onAction?.(event.id);
      else if (event.type === "menu") on.onMenu?.(event.id);
      else if (event.type === "back") on.onBack?.();
      else if (event.type === "forward") on.onForward?.();
    });
  }, [app]);

  const value = JSON.stringify(head);
  useEffect(() => {
    app?.setTabHead(JSON.parse(value) as TabHead | null);
  }, [app, value]);
  useEffect(() => () => app?.setTabHead(null), [app]);

  return shown;
}
