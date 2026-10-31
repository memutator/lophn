// Inbox 탭 본문. 떠 있는 panel(`WaitingLayer`)과 같은 목록·카드를 탭 한 쪽 전체로 보인다.
import { useEffect } from "react";

import type { LophnNoticeApi } from "../../../../ipc/notice.ts";
import { useWaiting } from "../events/hooks.tsx";
import { useFinished } from "./finished.ts";
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
  const { entries } = useWaiting();
  const finished = useFinished();
  const settled = useSettled(entries);
  const { clear } = settled;
  useEffect(() => {
    if (!active) clear();
  }, [active, clear]);
  return (
    <WaitingPanel
      page
      entries={entries}
      settled={settled}
      finished={finished}
      onOpenSession={onOpenSession}
      onShowFinished={(target) => notice()?.open(target)}
      onDismissFinished={(target) => void notice()?.dismiss(target)}
    />
  );
}
