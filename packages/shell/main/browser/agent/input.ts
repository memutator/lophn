// lophn(agent의 browser 호출, 멀리서 보기)이 page에 넣는 input의 표시. wiring이 하나 만들어 driver, stream, 창 단축키
// 전달(desktop.ts)에 같이 준다. Electron을 모르는 port라 창 없는 page host와 test가 그대로 쓴다.
//
// 표시된 page가 받은 lophn의 키는 창 단축키도 menu 단축키도 되지 않고 page에만 간다(agent가 누른 Control+w가 창의 탭을
// 닫았다). page를 누르거나 page 끝에서 Tab을 치면 Chromium이 창의 keyboard focus를 옮기므로, 표시하는 동안 그 창의 shell이
// 사람의 focus를 제자리에 둔다(renderer/desktop/person-focus.ts). 그동안 focus가 잠깐 그 page에 간 사이 사람이 친 키는 그
// page에 들어가지 않게 버린다(사람이 원래 그 page에서 치고 있었으면 그대로 둔다).
import type { KeyEvent } from "./keys.ts";
import type { Page } from "./page.ts";

/** 창(shell)에 알리는 것. start·end는 page마다 짝이다. tab은 그 page에 Tab을 넣으려 한다(focus가 page 밖으로 나갈 수 있다). */
export type DriverInputEvent = "start" | "end" | "tab";

export interface DriverInput {
  /** page에 input을 보내는 동안 그 page를 표시한다. */
  sending<T>(page: number, run: () => Promise<T>): Promise<T>;
  /** 지금 lophn이 이 webContents에 input을 보내는 중이다. */
  marked(contents: number): boolean;
  /** lophn의 key event 하나를 page에 넣는다. 받지 않았으면 false다. Tab이면 창에 먼저 알린다. */
  sendKey(page: Page, event: KeyEvent): boolean;
  /** lophn의 마우스 event를 넣는 동안. 그사이 그 page의 mouseDown은 사람의 것이 아니다. */
  mouse<T>(page: number, run: () => Promise<T>): Promise<T>;
  /** 이 key가 지금 lophn이 넣는 key다(before-input-event는 sendKey 안에서 바로 난다). */
  driverKey(contents: number): boolean;
  /** 이 mouseDown이 지금 lophn이 넣는 것이다. */
  driverMouse(contents: number): boolean;
  /** 창이 답한 것: 표시를 켤 때 사람의 keyboard focus가 이 page에 있었다. */
  personIn(page: number): void;
  /** 표시된 page에 온 사람의 키다. page가 사람의 focus를 갖고 있지 않았으면 버려야 한다. */
  strayKey(contents: number): boolean;
  /** 표시된 page가 하나라도 있다. */
  any(): boolean;
}

export function createDriverInput(
  /** start에는 창이 받았다고 답할 때까지(또는 기한까지) 기다릴 promise를 돌려줄 수 있다. */
  notify: (
    page: number,
    event: DriverInputEvent,
  ) => void | Promise<void> = () => {},
): DriverInput {
  // webContents id → 보내는 중인 수와, 켤 때 사람의 focus가 그 page에 있었나.
  const marks = new Map<number, { count: number; person: boolean }>();
  let keyOf: number | undefined;
  const mice = new Map<number, number>();
  const input: DriverInput = {
    async sending(page, run) {
      const mark = marks.get(page);
      if (mark !== undefined) mark.count += 1;
      else {
        marks.set(page, { count: 1, person: false });
        // 창이 표시를 받기 전에 input이 창 focus를 옮기면 창은 그 이동이 agent의 것인지 모른다(webContents.send가 focus
        // 이동보다 늦게 닿았다). 창이 답한 뒤에 넣는다.
        await notify(page, "start");
      }
      try {
        return await run();
      } finally {
        const left = marks.get(page);
        if (left !== undefined && --left.count === 0) {
          marks.delete(page);
          notify(page, "end");
        }
      }
    },
    marked: (contents) => marks.has(contents),
    sendKey(page, event) {
      if (event.keyCode === "Tab" && event.type === "keyDown") {
        notify(page.id, "tab");
      }
      keyOf = page.id;
      try {
        return page.sendKey(event);
      } finally {
        keyOf = undefined;
      }
    },
    async mouse(page, run) {
      mice.set(page, (mice.get(page) ?? 0) + 1);
      try {
        return await run();
      } finally {
        const left = (mice.get(page) ?? 1) - 1;
        if (left === 0) mice.delete(page);
        else mice.set(page, left);
      }
    },
    driverKey: (contents) => keyOf === contents,
    driverMouse: (contents) => mice.has(contents),
    personIn(page) {
      const mark = marks.get(page);
      if (mark !== undefined) mark.person = true;
    },
    strayKey(contents) {
      const mark = marks.get(contents);
      return mark !== undefined && !mark.person && keyOf !== contents;
    },
    any: () => marks.size > 0,
  };
  return input;
}

/** key를 줄마다 넣는다. page가 받지 않은 key 뒤로는 보내지 않고 false다. */
export function sendKeys(
  page: Page,
  input: DriverInput | undefined,
  strokes: KeyEvent[][],
): boolean {
  for (const stroke of strokes) {
    for (const event of stroke) {
      const taken = input ? input.sendKey(page, event) : page.sendKey(event);
      if (!taken) return false;
    }
  }
  return true;
}

// 넣은 뒤 page가 key를 다 처리하고 그 결과(page 끝의 Tab이 창 focus를 옮기는 것, page가 받지 않은 키가 menu로 가는 것, 이동의
// 시작)가 나기까지의 틈. page를 한 번 다녀와(round trip) 느린 keydown handler가 답한 뒤부터 잰다.
export const INPUT_TAIL_MS = 150;

/**
 * run 동안과 그 뒤(page를 한 번 다녀오고 INPUT_TAIL_MS) page를 표시한다. round trip이 실패해도(page가 이동하는 중) 표시는
 * 끝난다.
 */
export async function withInput<T>(
  input: DriverInput | undefined,
  page: Page,
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
): Promise<T> {
  const go = async () => {
    const result = await run();
    await Promise.race([
      page.send("Runtime.evaluate", { expression: "0" }).catch(() => {}),
      wait(1000),
    ]);
    await wait(INPUT_TAIL_MS);
    return result;
  };
  return input ? input.sending(page.id, go) : go();
}
