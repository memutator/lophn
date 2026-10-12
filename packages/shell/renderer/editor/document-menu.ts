// 문서 메뉴는 shell overlay view에 menu로 연다. 다른 칸의 앱 view
// 위에 걸쳐도 숨지 않는다. 고른 항목 id만 돌아오고 업무 값은 main으로 가지 않는다.
import type { OverlayApi } from "../../ipc/overlay.ts";
import { overlayConsumer } from "../overlay/consumer.ts";

export interface MenuChoice {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface MenuOpener {
  /** anchor 아래에 menu를 연다. 고른 id, 닫히면 null. 열지 못하면 "unavailable". */
  open(
    anchor: HTMLElement,
    label: string,
    choices: readonly MenuChoice[],
  ): Promise<string | null | "unavailable">;
}

function rectOf(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(box.left)),
    y: Math.max(0, Math.round(box.top)),
    width: Math.max(1, Math.round(box.width)),
    height: Math.max(1, Math.round(box.height)),
  };
}

export function overlayMenuOpener(api: OverlayApi): MenuOpener {
  const waiting = new Map<string, (choice: string | null) => void>();
  let next = 0;
  const consumer = overlayConsumer(
    api,
    (result) => {
      if (result.type === "pointer") return;
      const resolve = waiting.get(result.requestId);
      if (!resolve) return;
      waiting.delete(result.requestId);
      resolve(result.type === "selected" ? result.choiceId ?? null : null);
    },
    () => {
      for (const resolve of waiting.values()) resolve(null);
      waiting.clear();
    },
  );
  return {
    async open(anchor, label, choices) {
      next += 1;
      const requestId = `document-menu-${next}`;
      const done = new Promise<string | null>((resolve) => {
        waiting.set(requestId, resolve);
      });
      const opened = await consumer.open({
        requestId,
        kind: "menu",
        anchorRect: rectOf(anchor),
        model: { label, choices: choices.map((choice) => ({ ...choice })) },
      }, anchor);
      if (!opened.ok) {
        waiting.delete(requestId);
        return "unavailable";
      }
      return await done;
    },
  };
}
