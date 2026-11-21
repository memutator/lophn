// lophn이 page에 넣는 input의 표시(browser/agent/input.ts)를 Electron과 창에 잇는다. Electron은 port(`contents`)로만 닿아
// test가 가짜 webContents로 돌린다.
import {
  DRIVER_INPUT_CHANNEL,
  type DriverInputMessage,
  isDriverInputAnswer,
} from "../../../ipc/shortcuts.ts";
import {
  createDriverInput,
  type DriverInput,
} from "../../browser/agent/input.ts";

/** webContents에서 쓰는 부분. 창(shell)도 page도 이 모양이다. */
export interface InputContents {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  setIgnoreMenuShortcuts(ignore: boolean): void;
  /** <webview> guest면 그 guest를 든 창. 아니면 null이다. */
  readonly hostWebContents: InputContents | null;
}

export interface ElectronDriverInput extends DriverInput {
  /** 창이 start에 답했다(사람의 keyboard focus가 그 page에 있었는가). 그 page를 가진 창의 답만 받는다. */
  answer(sender: { readonly id: number }, payload: unknown): void;
  /** guest의 mouseDown. lophn이 넣은 것이 아니고 표시가 있으면 사람이 그 page를 눌렀다. */
  pressed(contents: InputContents): void;
}

// 창이 start에 답하기를 기다리는 기한. renderer가 막혀 있으면 표시 없이라도 넣는다(agent의 호출이 멈추지 않게).
export const START_WAIT_MS = 300;

export function electronDriverInput(deps: {
  /** webContents id의 contents. 없거나 부서졌으면 undefined다. */
  contents(id: number): InputContents | undefined;
  /** ms 뒤 run을 부르고 취소 함수를 돌려준다. */
  schedule(run: () => void, ms: number): () => void;
}): ElectronDriverInput {
  // 표시를 켤 때 page를 가진 창. 표시 중에 page가 사라져도(탭을 닫음) 그 창에 end가 가야 창이 표시를 푼다.
  const hosts = new Map<number, InputContents>();
  const waiting = new Map<number, () => void>();
  const post = (
    host: InputContents | null | undefined,
    message: DriverInputMessage,
  ) => {
    if (host && !host.isDestroyed()) host.send(DRIVER_INPUT_CHANNEL, message);
  };
  const input = createDriverInput((page, event) => {
    const contents = deps.contents(page);
    if (event === "end") {
      contents?.setIgnoreMenuShortcuts(false);
      post(hosts.get(page), { page, event });
      hosts.delete(page);
      return;
    }
    if (event !== "start") {
      post(hosts.get(page), { page, event });
      return;
    }
    // page가 받지 않은 key는 page가 답한 뒤 창 menu로 올라간다(Control+w가 menu의 Close Window). 표시하는 동안은 menu 단축키가 아니다.
    contents?.setIgnoreMenuShortcuts(true);
    const host = contents?.hostWebContents;
    if (!host || host.isDestroyed()) return;
    hosts.set(page, host);
    post(host, { page, event });
    return new Promise<void>((resolve) => {
      const cancel = deps.schedule(done, START_WAIT_MS);
      function done() {
        cancel();
        if (waiting.get(page) === done) waiting.delete(page);
        resolve();
      }
      waiting.set(page, done);
    });
  });
  return {
    ...input,
    answer(sender, payload) {
      if (!isDriverInputAnswer(payload)) return;
      if (hosts.get(payload.page)?.id !== sender.id) return;
      // 기한 뒤에 온 답도 표시가 남아 있으면 쓴다(사람이 그 page에서 치고 있었다).
      if (payload.person) input.personIn(payload.page);
      waiting.get(payload.page)?.();
    },
    pressed(contents) {
      if (!input.any() || input.driverMouse(contents.id)) return;
      // 사람이 표시된 page를 눌렀으면 이제 그 page에서 치는 키는 사람의 것이다(버리지 않는다).
      input.personIn(contents.id);
      post(contents.hostWebContents, { page: contents.id, event: "person" });
    },
  };
}
