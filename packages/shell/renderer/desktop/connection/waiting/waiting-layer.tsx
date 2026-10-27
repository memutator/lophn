// 위쪽 바 안의 알림 단추와 그 아래로 열리는 panel. 위쪽 바의 오른쪽 slot에 꽂는다. 호스트(project 창, 앱 공간,
// 런처)는 callback만 준다.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { t } from "@lophn/wording";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { notificationsIcon } from "../../../icons/mod.ts";
import type { LophnNoticeApi } from "../../../../ipc/notice.ts";
import { useWaiting } from "../events/hooks.tsx";
import { createValueStore } from "../events/store.ts";
import { type FinishedRow, useFinished } from "./finished.ts";
import type { SettledRow } from "./settled.ts";
import { useSettled } from "./settled.ts";
import { type PanelInitial, WaitingPanel } from "./waiting-panel.tsx";
import styles from "./waiting.module.css";

// 열림 상태는 창 하나에 하나다. toast의 [Review]가 같은 상태를 쓴다.
const panel = createValueStore(false);

export function useWaitingPanel(): {
  open: boolean;
  setOpen(open: boolean): void;
} {
  const open = useSyncExternalStore(panel.subscribe, panel.get);
  return { open, setOpen: panel.set };
}

export interface WaitingLayerProps {
  /** 질문 카드의 [Open session]. */
  readonly onOpenSession: (session: string) => void;
  /** coding agent 카드의 [Answer in terminal]. */
  readonly onAnswerInTerminal: (session: string) => void;
  /** gallery가 정해진 상태로 시작할 때만 준다. */
  readonly initial?: PanelInitial & {
    readonly open?: boolean;
    readonly settled?: readonly SettledRow[];
    readonly finished?: readonly FinishedRow[];
  };
}

export function WaitingLayer({
  onOpenSession,
  onAnswerInTerminal,
  initial,
}: WaitingLayerProps) {
  const { entries } = useWaiting();
  const finished = useFinished(initial?.finished);
  // 배지는 "볼 것이 있다"는 뜻이라 끝난 줄도 센다.
  const count = entries.length + finished.length;
  const { open, setOpen } = useWaitingPanel();
  const settled = useSettled(entries, initial?.settled);
  const initialOpen = initial?.open;
  useEffect(() => {
    if (initialOpen !== undefined) setOpen(initialOpen);
  }, [initialOpen]);
  // 닫으면 방금 결정한 줄도 치운다.
  const { clear } = settled;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) clear();
    wasOpen.current = open;
  }, [open, clear]);
  // 열린 panel은 단추와 panel 밖을 누르거나 Esc를 누르면 닫힌다.
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!layer.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, setOpen]);
  const label = t("waiting.label.trigger", { count });

  return (
    <div className={styles.layer} ref={layer}>
      <Tooltip content={label}>
        <IconButton
          icon={notificationsIcon}
          label={label}
          aria-expanded={open}
          data-waiting-trigger=""
          onClick={() => setOpen(!open)}
        />
      </Tooltip>
      {count > 0 ? (
        <span className={styles.badge} aria-hidden>
          {count}
        </span>
      ) : null}
      {open ? (
        <div className={styles.floating}>
          <WaitingPanel
            entries={entries}
            settled={settled}
            finished={finished}
            initial={initial}
            onOpenSession={(session) => {
              setOpen(false);
              onOpenSession(session);
            }}
            onAnswerInTerminal={(session) => {
              setOpen(false);
              onAnswerInTerminal(session);
            }}
            onShowFinished={(target) => {
              setOpen(false);
              // main이 그 탭이 있는 창을 앞으로 가져오고 탭을 고른다(toast를 누를 때와 같다).
              (
                globalThis as { lophnNotice?: LophnNoticeApi }
              ).lophnNotice?.open(target);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
