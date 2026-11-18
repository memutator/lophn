// 터미널 탭이 쓰는 통로 묶음. 기계마다 `machine-deps.ts`가 그 기계의 core 연결과 preload 통로로 만들고, 테스트는 가짜를 준다.
import type { TerminalApi } from "../../ipc/terminal.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import { t } from "@lophn/i18n";

import { centerAnchor, overlayConsumer } from "../overlay/consumer.ts";
import type { TerminalCore } from "./core.ts";
import { endingOf, phaseOfRuntime } from "./model.ts";
import type { TerminalStore } from "./store.ts";
import type { TerminalView } from "./xterm-view.ts";
import { TerminalDisplays } from "./displays.ts";

export interface TerminalDeps {
  /** core의 `terminals/*` route와 터미널 event. 없으면 터미널을 열지 않는다. */
  readonly core: TerminalCore | null;
  /** 입력·다시 시작·focus·clipboard·link 통로. 이 컴퓨터는 shell main, 다른 기계는 그 기계의 core다. 없으면 치지 못한다. */
  readonly bridge: TerminalApi | null;
  readonly store: TerminalStore;
  readonly displays: TerminalDisplays;
  /** edge는 host 둘레 여백을 덮는 canvas다(xterm-view `paintEdges`). */
  readonly createView: (
    host: HTMLElement,
    edge: HTMLCanvasElement,
  ) => TerminalView;
  /** 살아 있는 터미널 닫기를 사람에게 묻는다. true일 때만 닫는다. */
  readonly confirmClose: () => Promise<boolean>;
  /**
   * 다른 기계의 터미널이다(`screen-copy.ts`). 화면 사본을 그 PTY 크기로 그리고, PTY 크기는 사람이 이 탭을 고르거나 누르거나 칠
   * 때만 잡는다(폰처럼 마지막에 잡은 쪽이 이긴다).
   */
  readonly screenCopy?: true;
  /** 그 기계가 이 컴퓨터의 입력이나 다시 시작을 거절했다(터미널 입력 허락이 없다). 해지를 돌려준다. */
  readonly onRefused?: (listener: (terminal: string) => void) => () => void;
  /** 그 기계가 이 컴퓨터의 입력을 받아들였다(거절한 뒤 허락이 켜졌다). 해지를 돌려준다. */
  readonly onAccepted?: (listener: (terminal: string) => void) => () => void;
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
  const consumer = overlayConsumer(
    api,
    (result) => {
      if (result.type === "pointer") return;
      const resolve = waiting.get(result.requestId);
      if (!resolve) return;
      waiting.delete(result.requestId);
      resolve(result.type === "selected" && result.choiceId === CLOSE_CHOICE);
    },
    () => {
      for (const resolve of waiting.values()) resolve(false);
      waiting.clear();
    },
  );
  return async () => {
    const requestId = `terminal-close-${++requests}`;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : document.body;
    const answer = new Promise<boolean>((resolve) => {
      waiting.set(requestId, resolve);
    });
    const opened = await consumer.open(
      {
        requestId,
        kind: "dialog",
        anchorRect: centerAnchor(),
        model: {
          label: t("terminal.title.close"),
          text: t("terminal.dialog.close-text"),
          choices: [
            { id: KEEP_CHOICE, label: t("terminal.button.keep-open") },
            { id: CLOSE_CHOICE, label: t("terminal.button.close-terminal") },
          ],
        },
      },
      opener,
    );
    if (!opened.ok) {
      waiting.delete(requestId);
      return false;
    }
    return await answer;
  };
}

/** 창의 overlay 통로로 닫기 확인을 붙여 묶음을 만든다. 입력 통로가 없으면 bridge는 null이다. */
export function windowTerminalDeps(
  core: TerminalCore,
  store: TerminalStore,
  bridge: TerminalApi | null,
  createView: TerminalDeps["createView"],
  other: Pick<TerminalDeps, "screenCopy" | "onRefused" | "onAccepted"> = {},
): TerminalDeps {
  const overlay = (globalThis as { lophnShell?: OverlayApi }).lophnShell;
  return {
    core,
    bridge,
    store,
    displays: new TerminalDisplays(store, core, bridge),
    createView,
    confirmClose: overlay
      ? overlayCloseConfirm(overlay)
      : () => Promise.resolve(false),
    ...other,
  };
}

// 살아 있는 터미널의 ref. 탭 화면이 숨어 있던 사이 끝났을 수 있어 지금 상태를 읽는다. 없거나 끝났으면 null이다.
async function liveRef(deps: TerminalDeps, key: string) {
  const entry = deps.store.get(key);
  const core = deps.core;
  if (!entry || entry.terminalRef === null || !core) return null;
  const terminal = entry.terminalRef;
  const current = await core.snapshot(terminal, Number.MAX_SAFE_INTEGER);
  const live =
    current.ok &&
    (entry.generation === 0 ||
      current.value.runtime.generation === entry.generation) &&
    endingOf(current.value.runtime) === null;
  return live && current.ok
    ? { core, terminal, generation: current.value.runtime.generation }
    : null;
}

/** 터미널 탭을 닫으면 사람에게 물을지(shell이 아직 살아 있다). 여러 탭을 닫을 때 한 번에 묻는 데 쓴다. */
export async function terminalLive(
  deps: TerminalDeps,
  key: string,
): Promise<boolean> {
  return (await liveRef(deps, key)) !== null;
}

/**
 * 탭 닫기. 살아 있는 터미널은 사람이 확인해야 닫고(이미 확인했으면 `confirmed`), 취소하면 터미널과 출력을
 * 유지한다. 종료 확인에 실패하면 탭을 남겨 결과 불명을 보인다. true면 탭을 뺀다.
 */
export async function closeTerminalTab(
  deps: TerminalDeps,
  key: string,
  confirmed = false,
): Promise<boolean> {
  const live = await liveRef(deps, key);
  if (live === null) {
    deps.store.delete(key);
    return true;
  }
  if (!confirmed && !(await deps.confirmClose())) return false;
  const reply = await live.core.close(live.terminal, live.generation);
  if (reply.ok) {
    if (endingOf(reply.value) === "stop_unconfirmed") {
      deps.store.update(key, { phase: phaseOfRuntime(reply.value) });
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
