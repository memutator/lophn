// 위쪽 바 안의 알림 단추와 그 아래로 열리는 panel. 위쪽 바의 오른쪽 slot에 꽂는다. 호스트(project 창, 앱 공간,
// 런처)는 callback만 준다.
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { notificationsIcon } from "../../../icons/mod.ts";
import {
  OverlayLayer,
  type OverlayAlign,
} from "../../../shell/overlay-layer.tsx";
import type { LophnNoticeApi } from "../../../../ipc/notice.ts";
import { runToastAction } from "../toasts/toast-actions.ts";
import { createValueStore } from "../events/store.ts";
import {
  type FinishedRow,
  targetMachine,
  unseenRefOf,
  useFinished,
} from "./finished.ts";
import { useInbox } from "./inbox.ts";
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
  /** panel이 펼쳐지는 쪽. 기본은 단추 오른쪽 끝에 맞춰 왼쪽으로 펼친다(오른쪽 구역). start는 왼쪽 끝에 맞춰 오른쪽으로, side는 줄의 오른쪽 옆으로 편다. */
  readonly align?: OverlayAlign;
  /** panel 머리의 [Open in tab]. 주지 않으면 단추가 없다. 누르면 panel이 닫힌다. */
  readonly onOpenTab?: () => void;
  /** 단추 대신 그릴 여는 요소(왼쪽 sidebar의 Inbox 줄). 배지도 이 쪽이 그린다. */
  readonly renderTrigger?: (state: {
    readonly count: number;
    readonly open: boolean;
    readonly toggle: () => void;
  }) => ReactNode;
  /** gallery가 정해진 상태로 시작할 때만 준다. */
  readonly initial?: PanelInitial & {
    readonly open?: boolean;
    readonly settled?: readonly SettledRow[];
    readonly finished?: readonly FinishedRow[];
  };
}

export function WaitingLayer({
  onOpenSession,
  align = "end",
  onOpenTab,
  renderTrigger,
  initial,
}: WaitingLayerProps) {
  const inbox = useInbox();
  const { entries, notices, historyUnread } = inbox;
  const finished = useFinished(inbox, initial?.finished);
  // 배지는 "지금 볼 것이 있다"는 뜻이라 끝난 줄과 휘발 알림, 안 읽은 기록(History)도 센다. 기록을 빼면 SDK 업데이트 같은
  // 놓치면 안 되는 줄이 있어도 사람은 모른다.
  const count =
    entries.length +
    (initial?.finished?.length ?? inbox.finishedCount) +
    notices.length +
    historyUnread;
  const { open, setOpen } = useWaitingPanel();
  const settled = useSettled(inbox, initial?.settled);
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
  const label = t("waiting.label.trigger", { count });

  const trigger = renderTrigger ? (
    renderTrigger({ count, open, toggle: () => setOpen(!open) })
  ) : (
    <>
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
    </>
  );

  return (
    <OverlayLayer
      open={open}
      onOpenChange={setOpen}
      align={align}
      trigger={trigger}
    >
      <WaitingPanel
        inbox={inbox}
        settled={settled}
        finished={finished}
        initial={initial}
        onOpenTab={
          onOpenTab === undefined
            ? undefined
            : () => {
                setOpen(false);
                onOpenTab();
              }
        }
        onOpenSession={(session, machine) => {
          setOpen(false);
          // 다른 기계의 session은 그 기계의 session으로 연다.
          if (machine === null) onOpenSession(session);
          else runToastAction({ kind: "session", session, machine });
        }}
        onShowFinished={(target) => {
          setOpen(false);
          // main이 그 탭이 있는 창을 앞으로 가져오고 탭을 고른다(toast를 누를 때와 같다).
          (globalThis as { lophnNotice?: LophnNoticeApi }).lophnNotice?.open(
            target,
          );
        }}
        onOpenApp={(app, machine) => {
          setOpen(false);
          runToastAction({
            kind: "session",
            session: null,
            app,
            ...(machine === null ? {} : { machine }),
          });
        }}
        onDismissFinished={(target) => {
          // 그 기계의 core가 못 본 끝을 끄면 Finished 줄과 배지 수가 저절로 빠진다.
          const ref = unseenRefOf(target);
          if (ref !== null) {
            inbox.sourceOf(targetMachine(target))?.dismiss(ref);
          }
        }}
      />
    </OverlayLayer>
  );
}
