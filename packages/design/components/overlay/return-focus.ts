import { useRef } from "react";

// Chromium은 script가 focus()한 요소에 :focus-visible을 켠다. Radix가 면을 열거나 닫으며 focus를 옮기면 마우스로 한 일에도
// 단추에 ring이 남는 까닭이다. 그래서 focus를 옮길 때마다 입력이 키보드였는지 묻고 focusVisible로 ring을 직접 정한다.
// 키보드로 Tab하는 사람은 ring을 그대로 본다.
export function focusLike(target: HTMLElement, keyboard: boolean): void {
  target.focus({ focusVisible: keyboard });
}

// 열린 면 안의 마지막 입력이 키보드인가(keydown 뒤), 마우스인가(pointerdown 뒤, 면 밖 포함). 면이 열릴 때 `start`로 초기화한다.
// props는 Radix Content에 펼친다. 값은 ref라 다시 그리지 않는다.
export function useInputMode() {
  const keyboard = useRef(false);
  const outside = useRef(false);
  return {
    keyboard,
    // 면 밖을 눌러 닫혔다. focus는 누른 자리로 가야 하므로 돌려주지 않는다.
    outside,
    start: (byKeyboard: boolean) => {
      keyboard.current = byKeyboard;
      outside.current = false;
    },
    props: {
      onKeyDownCapture: () => {
        keyboard.current = true;
      },
      onPointerDownCapture: () => {
        keyboard.current = false;
      },
      onInteractOutside: () => {
        keyboard.current = false;
        outside.current = true;
      },
    },
  };
}

// 닫히거나 unmount될 때 focus를 연 자리로 돌려준다. Radix Dialog는 자기 Trigger로만 돌려주므로
// trigger 없이 연 dialog는 열 때의 focus 자리를 기억한다. overlay view처럼 연 자리가 다른 renderer에
// 있으면 returnFocus를 끄고 focus를 옮기지 않는다.
// 열 때 연 자리가 키보드 focus(:focus-visible)였을 때만 첫 단추에 ring을 켠다. 마우스로 연 dialog의 Cancel에 ring이 서지 않는다.
export function useReturnFocus(returnFocus: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const mode = useInputMode();
  return {
    ...mode.props,
    onOpenAutoFocus: (event: Event) => {
      const active = globalThis.document?.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
      const byKeyboard = opener.current?.matches(":focus-visible") === true;
      mode.start(byKeyboard);
      const scope = event.target;
      if (byKeyboard || !(scope instanceof HTMLElement)) return;
      event.preventDefault();
      const first = scope.querySelector<HTMLElement>(TABBABLE);
      focusLike(first ?? scope, false);
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const target = opener.current;
      opener.current = null;
      if (returnFocus && target?.isConnected) {
        focusLike(target, mode.keyboard.current);
      }
    },
  };
}

const TABBABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// trigger가 있는 Radix 표면에서 focus 복귀를 끈다.
export function keepFocus(event: Event): void {
  event.preventDefault();
}
