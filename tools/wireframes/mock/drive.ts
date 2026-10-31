// gallery가 상태 하나를 고정하려고 mount 뒤에 사람이 하는 것처럼 요소를 누르고 글을 쓰는 도구. 화면에는 gallery 전용 prop이
// 없으므로 fake source로 바탕을 정하고 나머지(탭 바꾸기, 열린 dialog, 채운 칸)는 여기서 만든다. 화면마다 자기 iframe 하나라서
// 요소는 document 전체에서 찾는다(dialog는 portal로 열리기도 한다).
import { useEffect } from "react";

/** 한 동작. 요소가 생길 때까지 기다린 뒤 한다. */
export type Step = () => Promise<void>;

// 시간이 가지 않는 timer를 주어 toast가 화면에 남은 채로 보인다.
export const NO_TIMER = { set: () => 0, clear: () => {}, now: () => 0 };

export const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// 글이 문자열이면 그 글을 품은 요소, 정규식이면 aria-label(없으면 글)이 맞는 요소.
function matches(element: HTMLElement, text: string | RegExp): boolean {
  if (typeof text === "string") {
    return element.textContent?.includes(text) ?? false;
  }
  return text.test(
    element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
  );
}

/** selector에 맞고(text가 있으면 그 글이 맞고) 쓸 수 있는 요소 중 at번째(음수는 뒤에서)가 생길 때까지 기다린다. */
export async function find<T extends HTMLElement = HTMLElement>(
  selector: string,
  text?: string | RegExp,
  at = 0,
): Promise<T> {
  for (let tries = 0; tries < 200; tries += 1) {
    const found = [...document.querySelectorAll<T>(selector)].filter(
      (element) =>
        (text === undefined || matches(element, text)) &&
        !(element as unknown as { disabled?: boolean }).disabled,
    );
    const one = found.at(at);
    if (one) return one;
    await wait(25);
  }
  throw new Error(`gallery drive: ${selector} ${text ?? ""} not found`);
}

export async function click(
  selector: string,
  text?: string | RegExp,
  at = 0,
): Promise<void> {
  (await find(selector, text, at)).click();
  await wait(30);
}

/** Radix가 pointer나 mouse down에 여는 것(메뉴, select, 탭)을 연다. */
export async function press(
  selector: string,
  text?: string | RegExp,
): Promise<void> {
  const element = await find(selector, text);
  const init = { bubbles: true, button: 0, pointerType: "mouse" };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  element.dispatchEvent(new MouseEvent("mousedown", init));
  element.dispatchEvent(new PointerEvent("pointerup", init));
  element.dispatchEvent(new MouseEvent("mouseup", init));
  element.click();
  await wait(30);
}

/** 요소 가운데에서 오른쪽 클릭(contextmenu)을 낸다. */
export async function contextMenu(
  selector: string,
  text?: string | RegExp,
): Promise<void> {
  const element = await find(selector, text);
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  await wait(30);
}

/** 글칸에 글을 쓴다. React가 보는 input event로 넣는다. */
export async function type(
  selector: string,
  text: string,
  enter = false,
): Promise<void> {
  const element = await find<HTMLInputElement | HTMLTextAreaElement>(selector);
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  if (enter) {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  await wait(30);
}

/** 동작을 차례로 한다. */
export async function runSteps(steps: readonly Step[]): Promise<void> {
  for (const step of steps) await step();
}

/** mount 뒤 한 번 돈다(deps가 바뀌면 다시). 실패는 console에만 남는다. */
export function useDrive(
  run: () => Promise<void>,
  deps: readonly unknown[] = [],
): void {
  useEffect(() => {
    run().catch((error) => console.warn(error));
  }, deps);
}

/** 요소 안의 한 점. fx·fy는 요소 크기에 대한 몫(0~1)이다. */
export interface Spot {
  readonly selector: string;
  readonly text?: string;
  readonly fx?: number;
  readonly fy?: number;
}

async function spotOf(spot: Spot): Promise<{ x: number; y: number }> {
  const box = (await find(spot.selector, spot.text)).getBoundingClientRect();
  return {
    x: box.left + box.width * (spot.fx ?? 0.5),
    y: box.top + box.height * (spot.fy ?? 0.5),
  };
}

/**
 * pointer로 끌어 놓기. from을 누르고 to까지 옮긴다. release가 false면 끄는 도중에서 멈춰 그 모양을 고정한다.
 * 진짜 pointer event를 문서에 내므로 화면의 끌기 코드가 그대로 돈다.
 */
export async function dragPointer(
  from: Spot,
  to: Spot,
  release = true,
): Promise<void> {
  const start = await spotOf(from);
  const source = await find(from.selector, from.text);
  const init = (x: number, y: number) => ({
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
  source.dispatchEvent(new PointerEvent("pointerdown", init(start.x, start.y)));
  const end = await spotOf(to);
  for (let step = 1; step <= 6; step += 1) {
    const x = start.x + ((end.x - start.x) * step) / 6;
    const y = start.y + ((end.y - start.y) * step) / 6;
    document.dispatchEvent(new PointerEvent("pointermove", init(x, y)));
    await wait(16);
  }
  await wait(250);
  if (release) {
    document.dispatchEvent(new PointerEvent("pointerup", init(end.x, end.y)));
    await wait(300);
  }
}
