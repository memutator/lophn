// 격리 문서 view의 renderer 자리. native view의 bounds를 main에 relay하고
// view가 준비되면 자리를 비운다. 실제 내용은 main의 WebContentsView가 그린다.
import { useCallback, useEffect, useRef, useState } from "react";

export interface DocumentViewSlotProps {
  /** 그릴 문서 view의 view_session이다. 없으면 자리만 남는다. */
  viewSession: string | null;
  /** 자리의 사각형이 바뀌면 main에 relay한다(정수 pixel bounds). */
  onBounds(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void;
}

/**
 * 격리 문서 view가 앱 공간·탭 패널·세션 카드의 본문 경계 안에서 자기 페이지
 * 머리부터 그려지게 자리를 남긴다. 바깥 크롬은 shell이 그린다.
 */
export function DocumentViewSlot(
  { viewSession, onBounds }: DocumentViewSlotProps,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(viewSession === null);
  const relay = useCallback(
    (entries: ResizeObserverEntry[]) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      onBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    },
    [onBounds],
  );
  useEffect(() => {
    setEmpty(viewSession === null);
    const element = ref.current;
    if (!element || viewSession === null) return;
    const observer = new ResizeObserver(relay);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewSession, relay]);
  return (
    <div ref={ref} className="lophn-document-view-slot" data-empty={empty} />
  );
}
