// 반응 층이 낸 toast와 main이 보낸 알림(agent turn 끝·물음)을 창 위 overlay의 notification 표면으로 띄운다.
// 창마다 한 번 마운트한다. toast는 한 번에 하나만 띄우고 나머지는 차례를 기다린다(표면마다 오른쪽 아래에
// 쌓이면 겹친다). 놓친 toast는 대기 목록이 보인다. main의 알림은 focus를 가진 창에만 오고 누르면 main이 그
// 탭을 고르게 한다.
import { useEffect } from "react";
import { t } from "@lophn/i18n";
import type { LophnNoticeApi } from "../../../../ipc/notice.ts";
import type {
  OverlayApi,
  OverlayIdentity,
  OverlayLead,
} from "../../../../ipc/overlay.ts";
import { overlayConsumer, toastAnchor } from "../../../overlay/consumer.ts";
import { useEventClient } from "../events/hooks.tsx";
import { REACTION_EVENT_TYPES, reactionsOf } from "../events/reactions.ts";
import { runToastAction } from "./toast-actions.ts";
import { toastText } from "./toast-text.ts";

const ACT = "act";

/** 띄울 toast 하나. 누르면 run을 부른다. */
interface Item {
  readonly id: string;
  text(): {
    title: string;
    body?: string;
    action?: string;
    lead?: OverlayLead;
  };
  run?(): void;
}

export function ToastHost({ overlay }: { overlay: OverlayApi }) {
  const client = useEventClient();
  const notice = (globalThis as { lophnNotice?: LophnNoticeApi }).lophnNotice;

  useEffect(() => {
    const queue: Item[] = [];
    const seen = new Set<string>();
    let active: { item: Item; requestId: string } | null = null;
    let identity: OverlayIdentity | null = null;
    let stopped = false;

    function next() {
      if (stopped || active || queue.length === 0) return;
      const item = queue.shift()!;
      const requestId =
        `toast-${item.id.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 80);
      active = { item, requestId };
      const text = item.text();
      void consumer
        .open(
          {
            requestId,
            kind: "notification",
            anchorRect: toastAnchor(),
            model: {
              label: text.title,
              text: text.body,
              lead: text.lead,
              tone: "neutral",
              choices: text.action ? [{ id: ACT, label: text.action }] : [],
            },
          },
          document.body,
        )
        .then((opened) => {
          if (stopped) {
            if (opened.ok) void overlay.close(opened.value);
          } else if (opened.ok) identity = opened.value;
          else finish(requestId);
        });
    }

    function finish(requestId: string, selected = false) {
      if (active?.requestId !== requestId) return;
      const { item } = active;
      active = null;
      identity = null;
      if (selected) item.run?.();
      next();
    }

    const consumer = overlayConsumer(
      overlay,
      (result) => {
        if (result.type === "pointer" || result.type === "query") return;
        finish(result.requestId, result.type === "selected");
      },
      () => {
        // overlay가 끊기면 이 toast의 결과는 오지 않는다. 다음으로 넘어간다.
        if (active) finish(active.requestId);
      },
    );

    const unsubscribe = client.subscribe(
      { types: [...REACTION_EVENT_TYPES] },
      (message) => {
        if (message.kind !== "event") return;
        for (const reaction of reactionsOf(message.event, "live")) {
          if (seen.has(reaction.id)) continue;
          seen.add(reaction.id);
          queue.push({
            id: reaction.id,
            text: () => toastText(reaction),
            run: reaction.action
              ? () => runToastAction(reaction.action!)
              : undefined,
          });
        }
        next();
      },
    );

    const stopToast = notice?.onToast((toast) => {
      queue.push({
        id: toast.id,
        text: () => ({
          title: toast.title,
          body: toast.body,
          lead: toast.lead,
          action: t("common.button.view"),
        }),
        // 어느 창의 어느 탭을 고를지는 main이 정한다.
        run: () => void notice.open(toast.target),
      });
      next();
    });
    // main이 이 창에 그 Agent session 탭을 고르라고 한다(OS 알림이나 toast를 누름). 열기는 sidebar의 줄과 같은 길이다.
    // 앱 알림은 그 앱 공간을 연다(앱 재시작 중단 toast와 같은 길).
    const stopReveal = notice?.onReveal((reveal) =>
      runToastAction(
        "inbox" in reveal
          ? { kind: "waiting" }
          : "app" in reveal
            ? { kind: "session", session: null, app: reveal.app }
            : { kind: "session", session: reveal.session },
      ),
    );

    return () => {
      stopped = true;
      unsubscribe();
      stopToast?.();
      stopReveal?.();
      if (identity) void overlay.close(identity);
      consumer.dispose();
    };
  }, [client, overlay, notice]);

  return null;
}
