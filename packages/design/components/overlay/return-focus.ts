import { useRef } from "react";

// 닫히거나 unmount될 때 focus를 연 자리로 돌려준다. Radix Dialog는 자기 Trigger로만 돌려주므로
// trigger 없이 연 dialog는 열 때의 focus 자리를 기억한다. overlay view처럼 연 자리가 다른 renderer에
// 있으면 returnFocus를 끄고 focus를 옮기지 않는다.
export function useReturnFocus(returnFocus: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const active = globalThis.document?.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const target = opener.current;
      opener.current = null;
      if (returnFocus && target?.isConnected) target.focus();
    },
  };
}

// trigger가 있는 Radix 표면에서 focus 복귀를 끈다.
export function keepFocus(event: Event): void {
  event.preventDefault();
}
