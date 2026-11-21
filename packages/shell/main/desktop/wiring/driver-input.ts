// lophn이 page에 넣는 input의 표시(browser/agent/input.ts)를 Electron과 창에 잇는다.
import { type WebContents, webContents } from "electron";

import {
  DRIVER_INPUT_CHANNEL,
  type DriverInputMessage,
  isDriverInputAnswer,
} from "../../../ipc/shortcuts.ts";
import {
  createDriverInput,
  type DriverInput,
} from "../../browser/agent/input.ts";

export interface ElectronDriverInput extends DriverInput {
  /** 창이 start에 답했다(사람의 keyboard focus가 그 page에 있었는가). 그 page를 가진 창의 답만 받는다. */
  answer(sender: WebContents, payload: unknown): void;
  /** guest의 mouseDown. lophn이 넣은 것이 아니고 표시가 있으면 사람이 그 page를 눌렀다고 그 창에 알린다. */
  pressed(contents: WebContents): void;
}

// 창이 start에 답하기를 기다리는 기한. renderer가 막혀 있으면 표시 없이라도 넣는다(agent의 호출이 멈추지 않게).
const START_WAIT_MS = 300;

export function electronDriverInput(): ElectronDriverInput {
  // 표시를 켤 때 page를 가진 창. 표시 중에 page가 사라져도(탭을 닫음) 그 창에 end가 가야 창이 표시를 푼다.
  const hosts = new Map<number, WebContents>();
  const waiting = new Map<number, () => void>();
  const post = (
    host: WebContents | null | undefined,
    message: DriverInputMessage,
  ) => {
    if (host && !host.isDestroyed()) host.send(DRIVER_INPUT_CHANNEL, message);
  };
  const input = createDriverInput((page, event) => {
    const found = webContents.fromId(page);
    const contents = found?.isDestroyed() === false ? found : undefined;
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
      const timer = setTimeout(done, START_WAIT_MS);
      function done() {
        clearTimeout(timer);
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
      if (hosts.get(payload.page) !== sender) return;
      if (payload.person) input.personIn(payload.page);
      waiting.get(payload.page)?.();
    },
    pressed(contents) {
      if (!input.any() || input.driverMouse(contents.id)) return;
      post(contents.hostWebContents, { page: contents.id, event: "person" });
    },
  };
}
