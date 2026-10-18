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
) => Promise<string | null>;

type Pending = {
  requestId: string;
  identity: OverlayIdentity | null;
  settle(id: string | null): void;
};

let serial = 0;

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

  const open = useCallback<OpenMenu>(async (trigger, label, choices) => {
    const made = consumer.current;
    if (made === null || pending.current !== null) return null;
    const requestId = `browser-menu-${++serial}`;
    const box = trigger.getBoundingClientRect();
    let settle!: (id: string | null) => void;
    const answer = new Promise<string | null>((resolve) => settle = resolve);
    const mine: Pending = { requestId, identity: null, settle };
    pending.current = mine;
    const opened = await made.open({
      requestId,
      kind: "menu",
      anchorRect: {
        x: Math.max(0, Math.round(box.x)),
        y: Math.max(0, Math.round(box.y)),
        width: Math.max(1, Math.round(box.width)),
        height: Math.max(1, Math.round(box.height)),
      },
      model: { label, choices: choices.slice(0, MENU_LIMIT) },
    }, trigger);
    if (pending.current !== mine) return answer;
    if (opened.ok) mine.identity = opened.value;
    else {
      pending.current = null;
      settle(null);
    }
    return answer;
  }, []);

  return overlay === null ? null : open;
}
