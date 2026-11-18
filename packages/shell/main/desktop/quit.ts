// 명시 종료. 창 닫기는 종료가 아니다. 일반 Quit(Cmd+Q·`--quit`·OS 종료)은 shell 자원과 core 연결만 정리하고 core는 남긴다.
// 터미널은 core가 가지므로 Quit해도 돈다: 도는 터미널이 있으면 그대로 둘지(기본) 다 닫을지 묻는다. `Stop lophn`은 core를 멈추고
// core가 터미널을 모두 닫으므로 도는 터미널과 저장 중인 문서가 있으면 그래도 끌지 묻는다.
// 일반 preload·renderer에 종료 통로를 두지 않는다.
import { type MessageKey, word } from "./i18n.ts";

type Running = { terminal: string; generation: number };

/** 끄기 전에 볼 진행 중인 일. */
interface QuitWork {
  /** core에 살아 있는 터미널(starting·running). */
  runningTerminals(): Promise<Running[]>;
  /** 아직 디스크·기록 확인이 끝나지 않은 문서 저장 수. */
  pendingSaves(): number;
  /** 그 터미널들을 닫는다. */
  closeTerminals(terminals: Running[]): Promise<void>;
}

/** native 확인 창 하나. 고른 버튼의 번호를 받는다. Esc·창 닫기는 cancelId다. */
export type QuitPrompt = {
  title: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
};

interface QuitFlowOptions {
  work: QuitWork;
  /** 사람에게 묻고 고른 버튼 번호를 돌려준다. */
  ask(prompt: QuitPrompt): Promise<number>;
  /** Electron 종료. stop이 끝난 뒤에 부른다. */
  quitApp(): void;
  log?: (message: string) => void;
}

type QuitOutcome = "quit" | "cancelled" | "busy";

/** 일반 Quit은 터미널을 남기고, `Stop lophn`은 core와 함께 터미널을 끝낸다. */
export type QuitKind = "quit" | "stop";

interface QuitFlow {
  /** 진행 중인 일이 있으면 확인한 뒤 멈춘다. `stop`은 부르는 쪽이 고른다(일반 Quit은 shell 자원만, `Stop lophn`은 core stop까지). */
  request(
    kind: QuitKind,
    stop: () => void | Promise<void>,
  ): Promise<QuitOutcome>;
  /** 확인 없이 멈춘다. 확인 창을 띄울 수 없는 headless의 `--quit`이 쓴다. */
  stopNow(stop: () => void | Promise<void>): Promise<void>;
  /** 이미 끄는 중인지. */
  readonly quitting: boolean;
}

// 일반 Quit에서 도는 터미널이 있을 때의 버튼 차례.
const KEEP = 0;
const CLOSE = 1;

/** 물을 것과 고른 답에 할 일. 물을 것이 없으면 undefined다. */
async function plan(
  kind: QuitKind,
  work: QuitWork,
): Promise<
  { prompt: QuitPrompt; choose(button: number): Running[] | null } | undefined
> {
  const terminals = await work.runningTerminals();
  const saves = work.pendingSaves() > 0;
  if (kind === "quit" && terminals.length > 0) {
    return {
      prompt: {
        title: word("common.title.quit"),
        detail: [
          word("common.quit.terminals-keep", {
            count: terminals.length,
          }),
          ...(saves ? [word("common.quit.saves-lost")] : []),
        ].join(" "),
        buttons: [
          word("common.button.keep-terminals"),
          word("common.button.close-terminals"),
          word("common.button.cancel"),
        ],
        defaultId: KEEP,
        cancelId: 2,
      },
      choose: (button) =>
        button === KEEP ? [] : button === CLOSE ? terminals : null,
    };
  }
  const running = kind === "stop" && terminals.length > 0;
  if (!running && !saves) return undefined;
  const detail: MessageKey =
    running && saves
      ? "common.quit.terminals-and-saves"
      : running
        ? "common.quit.terminals"
        : "common.quit.saves";
  return {
    prompt: {
      title: word("common.title.quit"),
      detail: word(detail),
      buttons: [word("common.button.quit"), word("common.button.cancel")],
      defaultId: 1,
      cancelId: 1,
    },
    choose: (button) => (button === 0 ? [] : null),
  };
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
    async request(kind, stop) {
      if (quitting) return "quit";
      // 확인 창이 떠 있는 동안 다시 누르면 두 번째 창을 띄우지 않는다.
      if (asking) return "busy";
      asking = true;
      let close: Running[] | null = [];
      try {
        const asked = await plan(kind, options.work);
        if (asked !== undefined) {
          close = asked.choose(await options.ask(asked.prompt));
        }
      } catch (error) {
        (options.log ?? defaultLog)(
          `끄기 확인을 띄우지 못해 끄지 않는다: ${(error as Error).message}`,
        );
        close = null;
      } finally {
        asking = false;
      }
      if (close === null) return "cancelled";
      if (close.length > 0) await options.work.closeTerminals(close);
      await stopNow(stop);
      return "quit";
    },
    stopNow,
    get quitting() {
      return quitting;
    },
  };
}

/** native 확인 창의 옵션. Esc·창 닫기는 cancelId다. */
export function quitDialogOptions(prompt: QuitPrompt): {
  type: "question";
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: true;
  message: string;
  detail: string;
} {
  return {
    type: "question",
    buttons: prompt.buttons,
    defaultId: prompt.defaultId,
    cancelId: prompt.cancelId,
    noLink: true,
    message: prompt.title,
    detail: prompt.detail,
  };
}

function defaultLog(message: string): void {
  console.log(`[lophn] ${message}`);
}
