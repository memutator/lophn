// 명시 종료. 창 닫기는 종료가 아니다. 일반 Quit(Cmd+Q·`--quit`·OS 종료)은 shell 자원과 core 연결만
// 정리하고 core는 남긴다. 진행 중 터미널·저장이 있으면 먼저 사람에게 확인한다.
// 일반 preload·renderer에 종료 통로를 두지 않는다.
import { type MessageKey, word } from "./i18n.ts";

/** 끄기 전에 볼 진행 중인 일. */
interface QuitWork {
  /** 살아 있는 PTY 수(starting·running). */
  runningTerminals(): number;
  /** 아직 디스크·기록 확인이 끝나지 않은 문서 저장 수. */
  pendingSaves(): number;
}

type QuitPrompt = {
  title: string;
  detail: string;
  quit: string;
  cancel: string;
};

/** 진행 중인 일이 있으면 확인 문구, 없으면 undefined. */
function quitPrompt(work: QuitWork): QuitPrompt | undefined {
  const terminals = work.runningTerminals() > 0;
  const saves = work.pendingSaves() > 0;
  if (!terminals && !saves) return undefined;
  const detail: MessageKey =
    terminals && saves
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

interface QuitFlowOptions {
  work: QuitWork;
  /** 사람에게 묻는다. Quit을 고른 때만 true. 닫기·Esc·실패는 false. */
  confirm(prompt: QuitPrompt): Promise<boolean>;
  /** Electron 종료. stop이 끝난 뒤에 부른다. */
  quitApp(): void;
  log?: (message: string) => void;
}

type QuitOutcome = "quit" | "cancelled" | "busy";

interface QuitFlow {
  /**
   * 진행 중인 일이 있으면 확인한 뒤 멈춘다. `stop`은 부르는 쪽이 고른다:
   * 일반 Quit은 shell 자원만, `Stop lophn`은 core stop까지 기다린다.
   */
  request(stop: () => void | Promise<void>): Promise<QuitOutcome>;
  /** 확인 없이 멈춘다. 확인 창을 띄울 수 없는 headless의 `--quit`이 쓴다. */
  stopNow(stop: () => void | Promise<void>): Promise<void>;
  /** 이미 끄는 중인지. */
  readonly quitting: boolean;
}

export function createQuitFlow(options: QuitFlowOptions): QuitFlow {
  let asking = false;
  let quitting = false;

  async function stopNow(stop: () => void | Promise<void>): Promise<void> {
    if (quitting) return;
    quitting = true;
    try {
      // core stop 응답 같은 정리를 잃지 않게 끝까지 기다린다.
      await stop();
    } finally {
      options.quitApp();
    }
  }

  return {
    async request(stop) {
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
      await stopNow(stop);
      return "quit";
    },
    stopNow,
    get quitting() {
      return quitting;
    },
  };
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
