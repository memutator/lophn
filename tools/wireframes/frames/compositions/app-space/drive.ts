// gallery가 실제 AppSpace의 상태를 만드는 길. 화면에는 gallery 전용 prop이 없으므로 fake source로 바탕을 정하고, mount 뒤 사람이 하는 것처럼
// 단추를 누르고 글을 쓴다.
import { useEffect } from "react";

export const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** selector에 맞고(text가 있으면 그 글을 품고) 쓸 수 있는 요소가 생길 때까지 기다린다. */
export async function find<T extends HTMLElement = HTMLElement>(
  selector: string,
  text?: string,
): Promise<T> {
  for (let tries = 0; tries < 200; tries += 1) {
    const found = [...document.querySelectorAll<T>(selector)].find((element) =>
      (text === undefined || element.textContent?.includes(text)) &&
      !(element as unknown as { disabled?: boolean }).disabled
    );
    if (found) return found;
    await wait(25);
  }
  throw new Error(`gallery drive: ${selector} ${text ?? ""} not found`);
}

export async function click(selector: string, text?: string): Promise<void> {
  (await find(selector, text)).click();
  await wait(30);
}

/** Radix가 pointer나 mouse down에 여는 것(메뉴, select, 탭)을 연다. */
export async function press(selector: string, text?: string): Promise<void> {
  const element = await find(selector, text);
  const init = { bubbles: true, button: 0, pointerType: "mouse" };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  element.dispatchEvent(new MouseEvent("mousedown", init));
  element.dispatchEvent(new PointerEvent("pointerup", init));
  element.dispatchEvent(new MouseEvent("mouseup", init));
  element.click();
  await wait(30);
}

/** 글칸에 글을 쓴다. React가 보는 input event로 넣는다. */
export async function type(selector: string, text: string): Promise<void> {
  const element = await find<HTMLTextAreaElement>(selector);
  const set = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  set.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(30);
}

/** mount 뒤 한 번 돈다. 실패는 console에만 남는다. */
export function useDrive(run: () => Promise<void>): void {
  useEffect(() => {
    run().catch((error) => console.warn(error));
  }, []);
}
