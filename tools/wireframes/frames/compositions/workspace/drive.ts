// gallery가 상태 하나를 고정하려고 mount 뒤에 요소를 눌러 주거나 칸을 채우는 helper. 옮긴 component에는 gallery 전용
// prop이 없어서 고친 하위 폴더, 열린 등록 창 같은 모양은 fake source 위에서 사람이 하듯이 만든다.
import { type RefObject, useEffect } from "react";

/** 요소를 찾는다. 아직 그려지지 않았으면 null이다. */
export type Find = (root: HTMLElement) => HTMLElement | null;

export type Action =
  | { readonly find: Find; readonly click: true }
  | { readonly find: Find; readonly fill: string };

export const click = (find: Find): Action => ({ find, click: true });
export const fill = (find: Find, text: string): Action => ({
  find,
  fill: text,
});

export const first = (selector: string): Find => (root) =>
  root.querySelector<HTMLElement>(selector);

export const last = (selector: string): Find => (root) => {
  const all = root.querySelectorAll<HTMLElement>(selector);
  return all.length === 0 ? null : all[all.length - 1];
};

/** selector에 맞고 글에 text가 든 첫 요소. */
export const withText = (selector: string, text: string): Find => (root) =>
  [...root.querySelectorAll<HTMLElement>(selector)].find((one) =>
    one.textContent?.includes(text)
  ) ?? null;

// React가 input 값을 바꾼 것으로 알아보게 native setter로 쓰고 input event를 낸다.
function write(element: HTMLElement, text: string): void {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

const WAIT_MS = 50;
const GIVE_UP_MS = 3000;

/**
 * 마운트된 뒤 actions를 차례로 한다. 요소가 아직 없으면 그려질 때까지 기다린다. dialog는 portal로 열리므로
 * global이면 document.body 전체에서 찾는다.
 */
export function useWorkspaceDrive(
  root: RefObject<HTMLElement | null>,
  actions: readonly Action[],
  global = false,
): void {
  useEffect(() => {
    let live = true;
    const run = async () => {
      for (const action of actions) {
        const started = Date.now();
        for (;;) {
          const scope = global ? document.body : root.current;
          if (!live || scope === null) return;
          const found = action.find(scope);
          if (found !== null) {
            if ("fill" in action) write(found, action.fill);
            else found.click();
            break;
          }
          if (Date.now() - started > GIVE_UP_MS) return;
          await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        }
        // 눌러서 바뀐 화면이 그려질 틈을 준다.
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      }
    };
    void run();
    return () => {
      live = false;
    };
    // actions는 부르는 쪽이 한 번 정하는 값이다.
  }, []);
}
