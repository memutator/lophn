// 앱 공간 오른쪽 패널의 모양을 앱마다 기억한다. project는 layout file이 있지만 앱 place에는 없어 창이 기억하는 값
// (localStorage, panel-width.ts와 같은 방식)으로 둔다. 다른 place로 갔다 와도 열린 탭·고른 탭·보던 agent와 session이 그대로다.
// 폭은 앱마다가 아니라 panel-width.ts의 값 하나를 쓴다.
import type { AgentPaneState, PanelTab } from "./side-panel.tsx";

export interface AppLayout {
  readonly panelOpen: boolean;
  readonly panelTab: PanelTab;
  readonly detailsOpen: boolean;
  /** manage(editor로 연 agent)는 저장하지 않는다. 돌아오면 닫혀 있다. */
  readonly pane: Exclude<AgentPaneState, { mode: "manage" }> | null;
}

const KEY_PREFIX = "lophn.app-layout.";

function parsePane(value: unknown): AppLayout["pane"] {
  if (typeof value !== "object" || value === null) return null;
  const pane = value as Record<string, unknown>;
  if (pane.mode === "runs") return { mode: "runs" };
  if (
    pane.mode === "agent" &&
    typeof pane.assignment === "string" &&
    (pane.session === null || typeof pane.session === "string")
  ) {
    return {
      mode: "agent",
      assignment: pane.assignment,
      session: pane.session,
    };
  }
  return null;
}

/** 저장한 layout. 없거나 깨졌으면 null이라 부르는 쪽의 처음 값을 쓴다. */
export function readAppLayout(app: string): AppLayout | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY_PREFIX + app);
    if (raw == null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const saved = value as Record<string, unknown>;
    return {
      panelOpen: saved.panelOpen === true,
      panelTab: saved.panelTab === "details" ? "details" : "agent",
      detailsOpen: saved.detailsOpen === true,
      pane: parsePane(saved.pane),
    };
  } catch {
    return null;
  }
}

/** 저장을 못 해도 화면은 그대로다. */
export function saveAppLayout(app: string, layout: AppLayout): void {
  try {
    globalThis.localStorage?.setItem(KEY_PREFIX + app, JSON.stringify(layout));
  } catch {
    // 저장하지 못해도 화면은 그대로다.
  }
}
