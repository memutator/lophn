// 터미널 탭이 쓰는 통로 묶음. entry가 창의 preload 통로로 만들고, 테스트는 가짜를 준다.
import type { TerminalApi } from "../../ipc/terminal.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import { t } from "@lophn/wording";

import { overlayConsumer } from "../overlay/consumer.ts";
import { endingOf, phaseOfRuntime } from "./model.ts";
import type { TerminalStore } from "./store.ts";
import type { TerminalView } from "./xterm-view.ts";

export interface TerminalDeps {
  /** preload 통로. 없으면 터미널을 열지 않는다. */
  readonly bridge: TerminalApi | null;
  readonly store: TerminalStore;
  readonly createView: (host: HTMLElement) => TerminalView;
  /** 살아 있는 터미널 닫기를 사람에게 묻는다. true일 때만 닫는다. */
  readonly confirmClose: () => Promise<boolean>;
  /** 출력 당겨 읽기 간격. */
  readonly pollMs?: number;
}

/**
 * dialog는 창 본문 전체에 그려지지만 main은 연 자리가 본문 안인지 본다. 누른 닫기
 * 버튼 자리를 쓰고, 모르면 창 가운데를 쓴다.
 */
function anchorOf(
  element: HTMLElement,
): { x: number; y: number; width: number; height: number } {
  const box = element === document.body
    ? null
    : element.getBoundingClientRect();
  if (box && box.width > 0 && box.height > 0) {
    return {
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
    };
  }
  return {
    x: Math.max(0, Math.round(globalThis.innerWidth / 2)),
    y: Math.max(0, Math.round(globalThis.innerHeight / 2)),
    width: 1,
    height: 1,
  };
}

const CLOSE_CHOICE = "close-terminal";
const KEEP_CHOICE = "keep-open";
let requests = 0;

/**
 * overlay dialog로 닫기를 묻는다. 닫기를 고른 때만 true다. 창 닫힘·Escape·overlay
 * 실패는 결정이 아니라 유지다.
 */
function overlayCloseConfirm(api: OverlayApi): () => Promise<boolean> {
  const waiting = new Map<string, (value: boolean) => void>();
  const consumer = overlayConsumer(api, (result) => {
    if (result.type === "pointer") return;
    const resolve = waiting.get(result.requestId);
    if (!resolve) return;
    waiting.delete(result.requestId);
    resolve(result.type === "selected" && result.choiceId === CLOSE_CHOICE);
  }, () => {
    for (const resolve of waiting.values()) resolve(false);
    waiting.clear();
  });
  return async () => {
    const requestId = `terminal-close-${++requests}`;
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.body;
    const answer = new Promise<boolean>((resolve) => {
      waiting.set(requestId, resolve);
    });
    const opened = await consumer.open({
      requestId,
      kind: "dialog",
      anchorRect: anchorOf(opener),
      model: {
        label: t("terminal.title.close"),
        text: t("terminal.dialog.close-text"),
        choices: [
          { id: KEEP_CHOICE, label: t("terminal.button.keep-open") },
          { id: CLOSE_CHOICE, label: t("terminal.button.close-terminal") },
        ],
      },
    }, opener);
    if (!opened.ok) {
      waiting.delete(requestId);
      return false;
    }
    return await answer;
  };
}

/** 창의 preload 통로로 묶음을 만든다. 통로가 없으면 bridge는 null이다. */
export function windowTerminalDeps(
  store: TerminalStore,
  createView: (host: HTMLElement) => TerminalView,
): TerminalDeps {
  const scope = globalThis as {
    lophnTerminal?: TerminalApi;
    lophnShell?: OverlayApi;
  };
  const overlay = scope.lophnShell;
  return {
    bridge: scope.lophnTerminal ?? null,
    store,
    createView,
    confirmClose: overlay
      ? overlayCloseConfirm(overlay)
      : () => Promise.resolve(false),
  };
}

/**
 * 탭 닫기. 살아 있는 터미널은 사람이 확인해야 닫고, 취소하면 runtime과 출력을
 * 유지한다. 종료 확인에 실패하면 탭을 남겨 결과 불명을 보인다. true면 탭을 뺀다.
 */
export async function closeTerminalTab(
  deps: TerminalDeps,
  key: string,
): Promise<boolean> {
  const entry = deps.store.get(key);
  const bridge = deps.bridge;
  if (!entry || entry.terminalRef === null || !bridge) {
    deps.store.delete(key);
    return true;
  }
  const ref = { terminal_ref: entry.terminalRef, generation: entry.generation };
  // 탭 화면이 숨어 있던 사이 끝났을 수 있다. 지금 상태를 먼저 읽는다.
  const current = await bridge.snapshot({
    terminal_ref: ref.terminal_ref,
    after_seq: Number.MAX_SAFE_INTEGER,
  });
  const live = current.ok && current.value.ok && "output" in current.value &&
    current.value.runtime.generation === ref.generation &&
    endingOf(current.value.runtime) === null;
  if (!live) {
    deps.store.delete(key);
    return true;
  }
  if (!(await deps.confirmClose())) return false;
  const reply = await bridge.close(ref);
  if (reply.ok && reply.value.ok) {
    const runtime = reply.value.runtime;
    if (endingOf(runtime) === "stop_unconfirmed") {
      deps.store.update(key, { phase: phaseOfRuntime(runtime) });
      return false;
    }
    deps.store.delete(key);
    return true;
  }
  // 닫기 답을 받지 못했다. 종료를 확인하지 못했으니 결과 불명으로 남긴다.
  deps.store.update(key, {
    phase: { kind: "ended", ending: "stop_unconfirmed", runtime: null },
  });
  return false;
}
