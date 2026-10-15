// 반응 층이 낸 toast를 창 위 overlay의 notification 표면으로 띄운다. 창마다 한 번 마운트한다.
// toast는 한 번에 하나만 띄우고 나머지는 차례를 기다린다(표면마다 오른쪽 아래에 쌓이면 겹친다). 놓친 toast는
// 대기 목록이 보인다.
import { useEffect, useRef } from "react";
import type { OverlayApi, OverlayIdentity } from "../../../../ipc/overlay.ts";
import { overlayConsumer } from "../../../overlay/consumer.ts";
import { useEventClient, useSessions } from "../events/hooks.tsx";
import {
  type Reaction,
  REACTION_EVENT_TYPES,
  reactionsOf,
} from "../events/reactions.ts";
import { runToastAction } from "./toast-actions.ts";
import { toastText } from "./toast-text.ts";

const ACT = "act";

function windowRect() {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, Math.round(globalThis.innerWidth)),
    height: Math.max(1, Math.round(globalThis.innerHeight)),
  };
}

export function ToastHost({ overlay }: { overlay: OverlayApi }) {
  const client = useEventClient();
  const { sessions } = useSessions();
  const latest = useRef(sessions);
  latest.current = sessions;

  useEffect(() => {
    const queue: Reaction[] = [];
    const seen = new Set<string>();
    let active: { reaction: Reaction; requestId: string } | null = null;
    let identity: OverlayIdentity | null = null;
    let stopped = false;

    function next() {
      if (stopped || active || queue.length === 0) return;
      const reaction = queue.shift()!;
      const requestId = `toast-${reaction.id.replace(/[^A-Za-z0-9_-]/g, "-")}`
        .slice(0, 80);
      active = { reaction, requestId };
      const text = toastText(
        reaction,
        (session) =>
          latest.current.find((entry) => entry.session === session)?.agent ??
            null,
      );
      void consumer.open({
        requestId,
        kind: "notification",
        anchorRect: windowRect(),
        model: {
          label: text.title,
          text: text.body,
          tone: "neutral",
          choices: text.action ? [{ id: ACT, label: text.action }] : [],
        },
      }, document.body).then((opened) => {
        if (stopped) {
          if (opened.ok) void overlay.close(opened.value);
        } else if (opened.ok) identity = opened.value;
        else finish(requestId);
      });
    }

    function finish(requestId: string, selected = false) {
      if (active?.requestId !== requestId) return;
      const { reaction } = active;
      active = null;
      identity = null;
      if (selected && reaction.action) runToastAction(reaction.action);
      next();
    }

    const consumer = overlayConsumer(overlay, (result) => {
      if (result.type === "pointer" || result.type === "query") return;
      finish(result.requestId, result.type === "selected");
    }, () => {
      // overlay가 끊기면 이 toast의 결과는 오지 않는다. 다음으로 넘어간다.
      if (active) finish(active.requestId);
    });

    const unsubscribe = client.subscribe(
      { types: [...REACTION_EVENT_TYPES] },
      (message) => {
        if (message.kind !== "event") return;
        for (const reaction of reactionsOf(message.event, "live")) {
          if (seen.has(reaction.id)) continue;
          seen.add(reaction.id);
          queue.push(reaction);
        }
        next();
      },
    );

    return () => {
      stopped = true;
      unsubscribe();
      if (identity) void overlay.close(identity);
      consumer.dispose();
    };
  }, [client, overlay]);

  return null;
}
