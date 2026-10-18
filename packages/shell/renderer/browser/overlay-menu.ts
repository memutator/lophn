// toolbar menu를 overlay(kind "menu")로 연다. overlay는 native view 위에 그려지므로 page view를 숨기지 않아도 된다.
// overlay api가 없는 창(dev mock, gallery)에서는 null을 돌려주고, 부른 쪽이 DOM Menu로 그린다.
import { useCallback, useEffect, useRef } from "react";

import type { OverlayIdentity } from "../../ipc/overlay.ts";
import { overlayConsumer } from "../overlay/consumer.ts";
import { useBrowserOverlay } from "./browser-api.tsx";

export interface MenuChoice {
  id: string;
  label: string;
  disabled?: boolean;
}

/** overlay `choices` 한도. */
export const MENU_LIMIT = 64;

/** 고른 choice의 id. 닫히거나 열지 못하면 null. */
export type OpenMenu = (
  trigger: HTMLElement,
  label: string,
  choices: readonly MenuChoice[],
  // popover는 label을 머리글로 그린다(별 popover).
  kind?: "menu" | "popover",
) => Promise<string | null>;

type Pending = {
  requestId: string;
  identity: OverlayIdentity | null;
  settle(id: string | null): void;
};

let serial = 0;

// overlay view는 본문 전체를 덮고 menu·popover는 anchorRect(trigger 상자)에서 Radix가 자리를 잡는다. 크기는 어림하지 않는다.
function triggerRect(trigger: HTMLElement) {
  const box = trigger.getBoundingClientRect();
  const x = Math.max(0, Math.floor(box.left));
  const y = Math.max(0, Math.floor(box.top));
  return {
    x,
    y,
    width: Math.ceil(box.right) - x,
    height: Math.ceil(box.bottom) - y,
  };
}

export function useOverlayMenu(): OpenMenu | null {
  const overlay = useBrowserOverlay();
  const consumer = useRef<ReturnType<typeof overlayConsumer> | null>(null);
  const pending = useRef<Pending | null>(null);

  useEffect(() => {
    if (overlay === null) return;
    const settle = (id: string | null) => {
      const current = pending.current;
      pending.current = null;
      current?.settle(id);
    };
    const made = overlayConsumer(overlay, (result) => {
      if (result.type === "pointer" || result.type === "query") return;
      if (pending.current?.requestId !== result.requestId) return;
      settle(result.type === "selected" ? result.choiceId ?? null : null);
    }, () => settle(null));
    consumer.current = made;
    return () => {
      const identity = pending.current?.identity;
      if (identity) void overlay.close(identity);
      settle(null);
      made.dispose();
      consumer.current = null;
    };
  }, [overlay]);

  const open = useCallback<OpenMenu>(
    async (trigger, label, choices, kind = "menu") => {
      const made = consumer.current;
      if (made === null) return null;
      // 눈에 안 보이는 trigger(크기 0)로는 열 자리를 알 수 없다.
      const anchorRect = triggerRect(trigger);
      if (anchorRect.width < 1 || anchorRect.height < 1) return null;
      // 새로 열 때 아직 떠 있는 이전 menu·popover는 닫고 새것으로 바꾼다.
      const previous = pending.current;
      if (previous !== null) {
        pending.current = null;
        if (previous.identity) void made.close(previous.identity);
        previous.settle(null);
      }
      const requestId = `browser-menu-${++serial}`;
      const shown = choices.slice(0, MENU_LIMIT);
      let settle!: (id: string | null) => void;
      const answer = new Promise<string | null>((resolve) => settle = resolve);
      const mine: Pending = { requestId, identity: null, settle };
      pending.current = mine;
      const opened = await made.open({
        requestId,
        kind,
        anchorRect,
        model: { label, choices: shown },
      }, trigger);
      if (pending.current !== mine) {
        // 여는 사이 다른 open이 이 요청을 밀어냈다. 이미 열린 표면은 남기지 않는다.
        if (opened.ok) void made.close(opened.value);
        return answer;
      }
      if (opened.ok) mine.identity = opened.value;
      else {
        pending.current = null;
        settle(null);
      }
      return answer;
    },
    [],
  );

  return overlay === null ? null : open;
}
