// gallery가 상태 하나를 고정하려고 mount 뒤에 요소를 눌러 주는 helper. 옮긴 component에는 gallery 전용 prop이 없어서
// Grants 탭, 펼친 앱, 열린 server form 같은 모양은 fake source의 data 위에서 사람이 하듯이 눌러 만든다.
import { type RefObject, useEffect } from "react";

/** 누를 요소를 찾는다. 아직 그려지지 않았으면 null이다. */
export type Step = (root: HTMLElement) => HTMLElement | null;

/** root 안에서 CSS selector에 맞고 글이 text인 첫 요소. */
export const byText = (selector: string, text: string): Step => (root) =>
  [...root.querySelectorAll<HTMLElement>(selector)].find((one) =>
    one.textContent?.trim() === text
  ) ?? null;

export const bySelector = (selector: string): Step => (root) =>
  root.querySelector<HTMLElement>(selector);

// Radix Tabs는 click이 아니라 mousedown으로 탭을 바꾼다.
function press(element: HTMLElement): void {
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, button: 0 }),
  );
  element.click();
}

const WAIT_MS = 50;
const GIVE_UP_MS = 3000;

/** 마운트된 뒤 steps를 차례로 누른다. 요소가 아직 없으면 그려질 때까지 기다린다. */
export function useDrive(
  root: RefObject<HTMLElement | null>,
  steps: readonly Step[],
): void {
  useEffect(() => {
    let live = true;
    const run = async () => {
      for (const step of steps) {
        const started = Date.now();
        for (;;) {
          if (!live || root.current === null) return;
          const found = step(root.current);
          if (found !== null) {
            press(found);
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
    // steps는 부르는 쪽이 한 번 정하는 값이다.
  }, []);
}
