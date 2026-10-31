// 앱 화면 위쪽에 띄우는 알림(Annotate 켜짐·보냄·돌아감). overlay가 있으면 overlay의 notification 표면으로
// 열고, 없으면(앱 view가 없는 창, gallery) 같은 모양의 toast를 DOM으로 그리게 값을 돌려준다.
import { useCallback, useEffect, useRef, useState } from "react";

import type { OverlayApi, OverlayIdentity } from "../../../ipc/overlay.ts";
import { overlayConsumer, toastAnchor } from "../../overlay/consumer.ts";

interface ViewToast {
  readonly title: string;
  readonly body?: string;
  /** 오른쪽 끝 단추 하나. */
  readonly action?: { readonly label: string; readonly run: () => void };
}

const ACT = "act";

/** 시간이 가지 않는 timer. 알림을 놓치지 않게 사람이 닫을 때까지 둔다. */
export const STAY = { set: () => 0, clear: () => {} };

let serial = 0;

export function useViewToast(overlay: OverlayApi | undefined): {
  /** overlay가 없을 때 DOM으로 그릴 toast. overlay가 있으면 늘 null이다. */
  readonly dom: ViewToast | null;
  show(toast: ViewToast): void;
  hide(): void;
} {
  const [dom, setDom] = useState<ViewToast | null>(null);
  const open = useRef<{
    requestId: string;
    identity: OverlayIdentity | null;
  } | null>(null);
  const action = useRef<(() => void) | undefined>(undefined);
  const consumer = useRef<ReturnType<typeof overlayConsumer> | null>(null);

  useEffect(() => {
    if (overlay === undefined) return;
    const made = overlayConsumer(
      overlay,
      (result) => {
        if (result.type === "pointer" || result.type === "query") return;
        if (open.current?.requestId !== result.requestId) return;
        open.current = null;
        if (result.type === "selected") action.current?.();
      },
      () => {
        open.current = null;
      },
    );
    consumer.current = made;
    return () => {
      const current = open.current;
      if (current?.identity) void overlay.close(current.identity);
      open.current = null;
      made.dispose();
      consumer.current = null;
    };
  }, [overlay]);

  const hide = useCallback(() => {
    setDom(null);
    const current = open.current;
    open.current = null;
    if (overlay !== undefined && current?.identity) {
      void overlay.close(current.identity);
    }
  }, [overlay]);

  const show = useCallback(
    (toast: ViewToast) => {
      if (overlay === undefined || consumer.current === null) {
        setDom(toast);
        return;
      }
      const previous = open.current?.identity;
      if (previous) void overlay.close(previous);
      const requestId = `view-toast-${++serial}`;
      const mine: { requestId: string; identity: OverlayIdentity | null } = {
        requestId,
        identity: null,
      };
      open.current = mine;
      action.current = toast.action?.run;
      void consumer.current
        .open(
          {
            requestId,
            kind: "notification",
            anchorRect: toastAnchor(),
            model: {
              label: toast.title,
              ...(toast.body === undefined ? {} : { text: toast.body }),
              tone: "neutral",
              choices: toast.action
                ? [{ id: ACT, label: toast.action.label }]
                : [],
            },
          },
          document.body,
        )
        .then((opened) => {
          if (open.current !== mine) {
            if (opened.ok) void overlay.close(opened.value);
            return;
          }
          if (opened.ok) mine.identity = opened.value;
          else open.current = null;
        });
    },
    [overlay],
  );

  return { dom: overlay === undefined ? dom : null, show, hide };
}
