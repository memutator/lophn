// Inbox 탭 본문. 떠 있는 panel(`WaitingLayer`)과 같은 목록·카드를 탭 한 쪽 전체로 보인다.
import { useEffect } from "react";

import type { LophnNoticeApi } from "../../../../ipc/notice.ts";
import { runToastAction } from "../toasts/toast-actions.ts";
import { targetMachine, unseenRefOf, useFinished } from "./finished.ts";
import { useInbox } from "./inbox.ts";
import { useSettled } from "./settled.ts";
import { WaitingPanel } from "./waiting-panel.tsx";

const notice = () =>
  (globalThis as { lophnNotice?: LophnNoticeApi }).lophnNotice;

export function WaitingPage({
  active,
  onOpenSession,
}: {
  /** 이 탭을 보고 있는지. 탭을 떠나면 방금 결정한 줄을 치운다(panel을 닫을 때와 같다). */
  active: boolean;
  /** 질문 카드의 [Open session]. */
  onOpenSession: (session: string) => void;
}) {
  const inbox = useInbox();
  const finished = useFinished(inbox);
  const settled = useSettled(inbox);
  const { clear } = settled;
  useEffect(() => {
    if (!active) clear();
  }, [active, clear]);
  return (
    <WaitingPanel
      page
      inbox={inbox}
      settled={settled}
      finished={finished}
      onOpenSession={(session, machine) =>
        machine === null
          ? onOpenSession(session)
          : runToastAction({ kind: "session", session, machine })
      }
      onShowFinished={(target) => notice()?.open(target)}
      onDismissFinished={(target) => {
        const ref = unseenRefOf(target);
        if (ref !== null) inbox.sourceOf(targetMachine(target))?.dismiss(ref);
      }}
      onOpenApp={(app, machine) =>
        runToastAction({
          kind: "session",
          session: null,
          app,
          ...(machine === null ? {} : { machine }),
        })
      }
    />
  );
}
