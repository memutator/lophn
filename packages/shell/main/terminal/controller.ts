// terminal 채널을 ipcMain과 창에 붙인다. 채널 이름과 guard 검사는 ipc.ts가
// 정하고, 이 모듈은 Electron의 ipcMain·BrowserWindow만 본다. shell tsc는
// packages를 보지 않으므로 호출 모양만 여기서 맞춘다.
import type { BrowserWindow } from "electron";

import {
  TERMINAL_CLOSE_CHANNEL,
  TERMINAL_FOCUS_CHANNEL,
  TERMINAL_FOCUS_SESSION_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
  TERMINAL_RESIZE_CHANNEL,
  TERMINAL_RESTART_CHANNEL,
  TERMINAL_SNAPSHOT_CHANNEL,
} from "../../ipc/terminal.ts";

import type { TerminalIpc } from "./ipc.ts";

/** ipcMain 등록 모양. 테스트는 이 이름으로 대역을 끼운다. */
export interface MainIpc {
  handle(
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

/**
 * terminal 채널 여덟 개를 ipcMain에 등록한다. sender·frame·URL·입력 검사는
 * TerminalIpc가 본다.
 */
export function registerTerminalIpc(
  register: MainIpc,
  ipc: TerminalIpc,
): void {
  for (
    const [channel, method] of [
      [TERMINAL_OPEN_CHANNEL, "open"],
      [TERMINAL_INPUT_CHANNEL, "input"],
      [TERMINAL_RESIZE_CHANNEL, "resize"],
      [TERMINAL_CLOSE_CHANNEL, "close"],
      [TERMINAL_RESTART_CHANNEL, "restart"],
      [TERMINAL_SNAPSHOT_CHANNEL, "snapshot"],
      [TERMINAL_FOCUS_CHANNEL, "focus"],
      [TERMINAL_FOCUS_SESSION_CHANNEL, "focusSession"],
    ] as const
  ) {
    const invoke = ipc[method] as unknown as (
      event: never,
      input: never,
    ) => Promise<unknown>;
    register.handle(channel, (event, input) => {
      // Electron의 IpcMainInvokeEvent는 guardIpc가 보는 sender 모양을 이미 갖는다.
      return invoke(event as never, input as never);
    });
  }
}

export function removeTerminalIpc(register: MainIpc): void {
  for (
    const channel of [
      TERMINAL_OPEN_CHANNEL,
      TERMINAL_INPUT_CHANNEL,
      TERMINAL_RESIZE_CHANNEL,
      TERMINAL_CLOSE_CHANNEL,
      TERMINAL_RESTART_CHANNEL,
      TERMINAL_SNAPSHOT_CHANNEL,
      TERMINAL_FOCUS_CHANNEL,
      TERMINAL_FOCUS_SESSION_CHANNEL,
    ]
  ) {
    register.removeHandler(channel);
  }
}

/** desktop renderer를 창마다 registry에 등록하고 닫힐 때 뺀다. */
export function attachTerminalSurface(
  registry: { register(entry: never): void; unregister(id: number): void },
  window: BrowserWindow,
): void {
  const shell = window.webContents;
  registry.register({
    contents: shell,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  } as never);
  window.once("closed", () => registry.unregister(shell.id));
}

/**
 * 사람이 누른 터미널 tab의 webContents 표. 탭 화면이 focus·blur에 쓰고,
 * main은 입력·resize·restart 검사에 본다. 표에 없는
 * terminal_ref의 입력은 통과하지 않는다.
 */
export class TerminalFocusTable {
  readonly #focused = new Map<
    string,
    { contents: number; generation: number | undefined }
  >();
  readonly #waiting = new Map<string, Array<() => void>>();

  /**
   * 사람이 terminal_ref 탭을 골랐다. webContents id는 그때의 frame이고
   * generation은 renderer가 본 runtime이다.
   */
  focus(contentsId: number, terminalRef: string, generation?: number): void {
    this.#focused.set(terminalRef, { contents: contentsId, generation });
  }

  /** 탭을 떠났다. 그 webContents의 표시만 지운다. */
  blur(contentsId: number, terminalRef: string): void {
    if (this.#focused.get(terminalRef)?.contents === contentsId) {
      this.#focused.delete(terminalRef);
      this.#release(terminalRef);
    }
  }

  /** 창이 닫혔다. 그 webContents가 고른 탭을 모두 놓는다. */
  forget(contentsId: number): void {
    for (const [terminalRef, entry] of [...this.#focused]) {
      if (entry.contents !== contentsId) continue;
      this.#focused.delete(terminalRef);
      this.#release(terminalRef);
    }
  }

  /** 사람이 그 탭에 focus해 있지 않을 때 풀린다. 이미 아니면 바로 풀린다. */
  whenFree(terminalRef: string): Promise<void> {
    if (!this.#focused.has(terminalRef)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiting = this.#waiting.get(terminalRef) ?? [];
      waiting.push(resolve);
      this.#waiting.set(terminalRef, waiting);
    });
  }

  #release(terminalRef: string): void {
    const waiting = this.#waiting.get(terminalRef);
    this.#waiting.delete(terminalRef);
    for (const resolve of waiting ?? []) resolve();
  }

  /** generation을 주면 renderer가 focus를 알린 그 generation일 때만 맞다. */
  focused(
    contentsId: number,
    terminalRef: string,
    generation?: number,
  ): boolean {
    const entry = this.#focused.get(terminalRef);
    if (!entry || entry.contents !== contentsId) return false;
    return generation === undefined || entry.generation === undefined ||
      entry.generation === generation;
  }
}
