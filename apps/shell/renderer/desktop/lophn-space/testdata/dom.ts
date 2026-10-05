// 화면 테스트의 DOM 조작. happy-dom 위에서 React 상태가 다 반영될 때까지 비운다.
import { act } from "react";

export async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** React가 듣는 input event로 값을 바꾼다. */
export function typeInto(input: Element, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** form을 제출한다. Enter와 같은 길이다. */
export function submit(form: Element): void {
  act(() => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

/** Radix Tabs는 mousedown으로 고른다. */
export function pressTab(tab: Element): void {
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
}

export function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found as HTMLElement;
}

/** 보이는 글로 단추를 찾는다. */
export function byText(root: ParentNode, text: string): HTMLElement {
  for (const element of root.querySelectorAll("button, [role=tab], p, span")) {
    if (element.textContent === text) return element as HTMLElement;
  }
  throw new Error(`no element with text ${text}`);
}

/** aria-label로 단추를 찾는다. */
export function byLabel(root: ParentNode, label: string): HTMLElement {
  const found = root.querySelector(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no element labelled ${label}`);
  return found as HTMLElement;
}
