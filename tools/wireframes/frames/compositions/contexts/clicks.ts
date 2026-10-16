// gallery page가 renderer component를 사람이 쓴 상태로 보이게 하는 도구.
import { useEffect, useRef } from "react";

// 시간이 가지 않는 timer를 주어 toast가 화면에 남은 채로 보인다.
export const NO_TIMER = { set: () => 0, clear: () => {}, now: () => 0 };

/** 화면이 그려진 뒤 사람이 누르는 단추를 차례로 누른다. 한 번만 돈다. */
export function useClicks(selectors: readonly string[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const selector of selectors) {
        let hit: HTMLElement | null = null;
        for (let tries = 0; tries < 50 && live && hit === null; tries += 1) {
          hit = ref.current?.querySelector<HTMLElement>(selector) ?? null;
          if (hit === null) await new Promise((r) => setTimeout(r, 50));
        }
        if (!live || hit === null) return;
        hit.click();
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return ref;
}
