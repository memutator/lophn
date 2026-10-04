// 컴포넌트 테스트 전용. components_test.ts가 happy-dom 위에서 bundle해 돌린다.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Timer } from "./shared.ts";

export interface Rendered extends Disposable {
  readonly container: HTMLElement;
  rerender(node: ReactNode): void;
  unmount(): void;
}

export function render(node: ReactNode): Rendered {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  act(() => root.render(node));
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
    container.remove();
  };
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount,
    [Symbol.dispose]: unmount,
  };
}

export function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
    );
  });
}

// Radix는 레이어를 닫은 뒤 timer에서 focus를 돌려준다. act 밖의 timer까지 몇 차례 비운다.
export async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export async function pressAsync(target: Element, key: string): Promise<void> {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

// happy-dom node를 assertEquals로 비교하면 실패 메시지 포맷이 끝나지 않는다. 같은 node인지만 본다.
export function isFocused(element: Element): boolean {
  return document.activeElement === element;
}

export function click(target: Element): void {
  act(() => (target as HTMLElement).click());
}

export function focus(target: Element): void {
  act(() => (target as HTMLElement).focus());
}

export function style(element: Element): CSSStyleDeclaration {
  return getComputedStyle(element);
}

export function one(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found as HTMLElement;
}

export interface ManualTimer extends Timer {
  advance(ms: number): void;
  pending(): number;
}

// 시간이 흐르는 순서대로 due callback을 act 안에서 부른다.
export function manualTimer(): ManualTimer {
  let now = 0;
  let next = 1;
  const queue = new Map<number, { at: number; callback: () => void }>();
  return {
    set(callback, ms) {
      const handle = next++;
      queue.set(handle, { at: now + ms, callback });
      return handle;
    },
    clear(handle) {
      queue.delete(handle as number);
    },
    pending: () => queue.size,
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...queue].filter(([, item]) => item.at <= until)
          .sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        act(() => due[1].callback());
      }
      now = until;
    },
  };
}
