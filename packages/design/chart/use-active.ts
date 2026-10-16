import { type KeyboardEvent, useState } from "react";

// hover와 키보드가 함께 쓰는 tooltip 대상. 화살표로 옮기고 Escape로 닫는다. focus는 plot에 남는다.
export function useActive(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const current = active !== null && active < count ? active : null;
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (count === 0) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -1
      : 0;
    if (step !== 0) {
      event.preventDefault();
      setActive(
        current === null
          ? (step > 0 ? 0 : count - 1)
          : Math.min(count - 1, Math.max(0, current + step)),
      );
    } else if (event.key === "Escape" && current !== null) {
      // 열린 tooltip이 없으면 Escape를 바깥(dialog 닫기 등)으로 흘려보낸다.
      event.preventDefault();
      event.stopPropagation();
      setActive(null);
    }
  };
  return {
    active: current,
    setActive,
    plotProps: {
      tabIndex: 0,
      onKeyDown,
      onBlur: () => setActive(null),
      onPointerLeave: () => setActive(null),
    },
  };
}

// pointer의 plot 안 x. DOM에서 읽기만 한다.
export function localX(event: { clientX: number; currentTarget: Element }) {
  const svg = event.currentTarget.closest("svg");
  return event.clientX - (svg?.getBoundingClientRect().left ?? 0);
}

