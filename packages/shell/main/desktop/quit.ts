// 명시 종료. 창 닫기는 종료가 아니다. tray의 Quit과 second-instance `--quit`만
// main과 그 아래 core를 멈춘다. 진행 중 터미널·저장이 있으면 먼저 사람에게 확인한다.
// 일반 preload·renderer에 종료 통로를 두지 않는다.
import { type PlainKey, word } from "./wording.ts";

/** 끄기 전에 볼 진행 중인 일. */
export interface QuitWork {
  /** 살아 있는 PTY 수(starting·running). */
  runningTerminals(): number;
  /** 아직 디스크·기록 확인이 끝나지 않은 문서 저장 수. */
  pendingSaves(): number;
}

export type QuitPrompt = {
  title: string;
  detail: string;
  quit: string;
  cancel: string;
};

/** 진행 중인 일이 있으면 확인 문구, 없으면 undefined. */
export function quitPrompt(work: QuitWork): QuitPrompt | undefined {
  const terminals = work.runningTerminals() > 0;
  const saves = work.pendingSaves() > 0;
  if (!terminals && !saves) return undefined;
  const detail: PlainKey = terminals && saves
    ? "common.quit.terminals-and-saves"
    : terminals
    ? "common.quit.terminals"
    : "common.quit.saves";
  return {
    title: word("common.title.quit"),
    detail: word(detail),
    quit: word("common.button.quit"),
    cancel: word("common.button.cancel"),
  };
}

export interface QuitFlowOptions {
  work: QuitWork;
  /** 사람에게 묻는다. Quit을 고른 때만 true. 닫기·Esc·실패는 false. */
  confirm(prompt: QuitPrompt): Promise<boolean>;
  /** 터미널 host와 core의 정상 종료 순서(stop frame). 한 번만 부른다. */
  stop(): void;
  /** Electron 종료. stop 뒤에 부른다. */
  quitApp(): void;
  log?: (message: string) => void;
}

export type QuitOutcome = "quit" | "cancelled" | "busy";

export interface QuitFlow {
  /** tray Quit. 진행 중인 일이 있으면 확인한 뒤 멈춘다. */
  request(): Promise<QuitOutcome>;
  /** 확인 없이 멈춘다. 확인할 창이 없는 `--quit`이 쓴다. */
  stopNow(): void;
  /** 이미 끄는 중인지. */
  readonly quitting: boolean;
}

export function createQuitFlow(options: QuitFlowOptions): QuitFlow {
  let asking = false;
  let quitting = false;

  function stopNow(): void {
    if (quitting) return;
    quitting = true;
    options.stop();
    options.quitApp();
  }

  return {
    async request() {
      if (quitting) return "quit";
      // 확인 창이 떠 있는 동안 다시 누르면 두 번째 창을 띄우지 않는다.
      if (asking) return "busy";
      const prompt = quitPrompt(options.work);
      if (prompt !== undefined) {
        asking = true;
        let accepted = false;
        try {
          accepted = await options.confirm(prompt);
        } catch (error) {
          (options.log ?? defaultLog)(
            `끄기 확인을 띄우지 못해 끄지 않는다: ${(error as Error).message}`,
          );
        } finally {
          asking = false;
        }
        if (!accepted) return "cancelled";
      }
      stopNow();
      return "quit";
    },
    stopNow,
    get quitting() {
      return quitting;
    },
  };
}

// second-instance `--quit`의 종료 순서. 창이 있으면 tray Quit과 같은 확인 경로를 쓴다.
// 창이 없으면 확인할 창이 없다는 사실을 log로 남기고 core 정상 종료 순서를 밟는다.

export interface QuitWindowProbe {
  /** 진행 중 터미널·저장을 확인할 창이 있는지. */
  hasWindows(): boolean;
}

export interface QuitOptions {
  windows: QuitWindowProbe;
  /** core 정상 종료 순서. supervise child의 stop frame을 싣는다. */
  shutdownCore: () => void;
  /** Electron 종료. core pipe 종료 뒤에 부른다. */
  quitApp: () => void;
  /** 창이 있을 때의 끄기 확인(tray Quit과 같은 경로). 창이 있으면 이 경로만 쓴다. */
  confirmWithWindows?: () => void;
  /** 확인할 창이 없을 때 남기는 log. */
  log?: (message: string) => void;
}

/** 명시 종료를 순서대로 밟는다. 자동 종료는 아니다. */
export function requestQuit(options: QuitOptions): void {
  if (options.windows.hasWindows()) {
    if (options.confirmWithWindows !== undefined) {
      options.confirmWithWindows();
      return;
    }
    options.log?.("창이 있어 끄기 확인 경로로 보낸다");
    return;
  }
  // 창이 없으면 진행 중 터미널·저장을 확인할 창이 없다. 사실을 log로 남긴다.
  (options.log ?? defaultLog)(
    "확인할 창이 없어 끄기 확인 없이 core 종료 순서를 밟는다",
  );
  options.shutdownCore();
  options.quitApp();
}

/** native 확인 창의 버튼 배치. Esc·창 닫기는 취소다. */
export function quitDialogOptions(prompt: QuitPrompt): {
  type: "question";
  buttons: [string, string];
  defaultId: 1;
  cancelId: 1;
  noLink: true;
  message: string;
  detail: string;
} {
  return {
    type: "question",
    buttons: [prompt.quit, prompt.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: prompt.title,
    detail: prompt.detail,
  };
}

/** showMessageBox 응답에서 Quit을 골랐는지. */
export function quitChosen(response: number): boolean {
  return response === 0;
}

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
