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

// overlay view는 anchorRect 합집합 크기로만 열리고 menu는 그 왼쪽 위에서 그려진다. 그래서 trigger가 아니라 menu가 차지할 상자를 보낸다.
// 줄 높이 32(--menu-row)와 위아래 padding 4는 design Menu의 값이다. 폭은 글자 수로 어림한다.
const ROW = 32;
const PAD = 4;

function menuBox(trigger: DOMRect, choices: readonly MenuChoice[]) {
  const longest = Math.max(0, ...choices.map((choice) => choice.label.length));
  const width = Math.min(360, Math.max(160, longest * 8 + 40));
  const height = choices.length * ROW + PAD * 2;
  const maxWidth = Math.max(1, Math.floor(globalThis.innerWidth));
  const maxHeight = Math.max(1, Math.floor(globalThis.innerHeight));
  const w = Math.min(width, maxWidth);
  // 두 trigger 모두 toolbar 오른쪽 끝에 있어 오른쪽 가장자리를 맞춘다.
  const x = Math.min(Math.max(0, Math.round(trigger.right - w)), maxWidth - w);
  const y = Math.min(Math.max(0, Math.round(trigger.bottom)), maxHeight - 1);
  return {
    x,
    y,
    width: w,
    height: Math.max(1, Math.min(height, maxHeight - y)),
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

  const open = useCallback<OpenMenu>(async (trigger, label, choices) => {
    const made = consumer.current;
    if (made === null || pending.current !== null) return null;
    const requestId = `browser-menu-${++serial}`;
    const box = trigger.getBoundingClientRect();
    const shown = choices.slice(0, MENU_LIMIT);
    let settle!: (id: string | null) => void;
    const answer = new Promise<string | null>((resolve) => settle = resolve);
    const mine: Pending = { requestId, identity: null, settle };
    pending.current = mine;
    const opened = await made.open({
      requestId,
      kind: "menu",
      anchorRect: menuBox(box, shown),
      model: { label, choices: shown },
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
