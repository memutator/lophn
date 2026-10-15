// 위쪽 바 안의 pill과 그 아래로 열리는 panel. 위쪽 바의 오른쪽 slot에 꽂는다. 호스트(project 창, 앱 공간, 런처)는
// callback만 준다.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { t } from "@lophn/wording";
import { useWaiting } from "../events/hooks.tsx";
import { createValueStore } from "../events/store.ts";
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
  };
}

export function WaitingLayer(
  { onOpenSession, onAnswerInTerminal, initial }: WaitingLayerProps,
) {
  const { entries, count } = useWaiting();
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

  return (
    <div className={styles.layer}>
      {count > 0 || open
        ? (
          <button
            type="button"
            className={styles.pill}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {t("waiting.label.pill", { count })}
          </button>
        )
        : null}
      {open
        ? (
          <div className={styles.floating}>
            <WaitingPanel
              entries={entries}
              settled={settled}
              initial={initial}
              onOpenSession={(session) => {
                setOpen(false);
                onOpenSession(session);
              }}
              onAnswerInTerminal={(session) => {
                setOpen(false);
                onAnswerInTerminal(session);
              }}
            />
          </div>
        )
        : null}
    </div>
  );
}
