// core 요청으로 열린 coding 터미널을 호스트(project 창·앱 공간)에 알린다. main이 PTY를
// 이미 만들었고 renderer는 그 runtime에 붙기만 한다. 탭은 focus를 옮기지 않고 열린다.
import { useEffect, useRef } from "react";

import type { TerminalApi, TerminalRuntime } from "../../ipc/terminal.ts";
import { t } from "@lophn/wording";

export interface TerminalOpenRequest {
  tab: { key: string; title: string; folder: string };
  coding: { session: string; app: string; ticket: string; product: string };
  /** core 요청으로 열린 탭은 focus를 옮기지 않는다. */
  focus: false;
  /** main이 만든 runtime. 탭 화면이 이 runtime에 붙는다. */
  runtime: TerminalRuntime;
}

/** coding 탭 key. terminal_ref에서 정한다. */
export function codingTabKey(terminalRef: string): string {
  return `coding-${terminalRef}`;
}

/** 새 `coding_tui` runtime이면 열기 요청으로 옮긴다. 아니면 null이다. */
export function requestOf(
  runtime: TerminalRuntime,
): TerminalOpenRequest | null {
  const coding = runtime.coding_session;
  if (runtime.launch_kind !== "coding_tui" || coding === undefined) return null;
  const product = runtime.product ?? "";
  return {
    tab: {
      key: codingTabKey(runtime.terminal_ref),
      title: runtime.title ??
        (product || t("project-workspace.label.kind-terminal")),
      folder: runtime.folder_ref,
    },
    coding: {
      session: coding.session,
      app: coding.app,
      ticket: coding.ticket,
      product,
    },
    focus: false,
    runtime,
  };
}

/**
 * main이 새 coding 터미널을 알릴 때마다 `open`을 한 번 부른다. 상태가 바뀌어 다시 오는
 * runtime은 부르지 않는다. 호스트가 자기 앱·project의 요청만 골라 쓴다.
 */
export function useTerminalOpenRequests(
  open: (request: TerminalOpenRequest) => void,
  bridge: TerminalApi | null = windowBridge(),
): void {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (!bridge) return;
    const seen = new Set<string>();
    return bridge.onRuntime((runtime) => {
      if (seen.has(runtime.terminal_ref)) return;
      const request = requestOf(runtime);
      if (request === null) return;
      seen.add(runtime.terminal_ref);
      latest.current(request);
    });
  }, [bridge]);
}

function windowBridge(): TerminalApi | null {
  return (globalThis as { lophnTerminal?: TerminalApi }).lophnTerminal ?? null;
}
