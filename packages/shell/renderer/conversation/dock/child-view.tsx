// subagent의 대화를 읽는 한 겹(대화 위에 하나만 여는 panel 층). 머리는 [← 돌아가기] · 상태 · agent · model · 경과이고
// 본문(자식 대화)은 부르는 쪽이 읽기 전용 `AgentThread`로 그려 넘긴다. 아래 줄은 방향 주기(`steer_child`)와 [Stop]이다.
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";

import { elapsedText, useSecondTick } from "../activity/elapsed.ts";
import { SubagentMark } from "../activity/subagent-row.tsx";
import { actionIcons, conversationIcons } from "../../icons/mod.ts";
import type { ThreadSubagent } from "../agent-tab-source.ts";
import styles from "./child-view.module.css";

interface ChildViewProps {
  /** 이 자식을 맡긴 subagent 줄. 줄을 못 찾으면 null이고 머리는 돌아가기만 있다. */
  info: ThreadSubagent | null;
  now: () => number;
  /** capability `steer_child`. */
  canSteer: boolean;
  /** capability `stop_child`. */
  canStop: boolean;
  onBack: () => void;
  onSteer: (text: string) => void;
  onStop: () => void;
  /** 자식 대화. */
  children: ReactNode;
}

export function ChildView({
  info,
  now,
  canSteer,
  canStop,
  onBack,
  onSteer,
  onStop,
  children,
}: ChildViewProps): ReactElement {
  const [text, setText] = useState("");
  const running = info?.state === "running";
  useSecondTick(running);
  const send = () => {
    const value = text.trim();
    if (value === "") return;
    onSteer(value);
    setText("");
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <section
      className={styles.child}
      aria-label={t("conversation.label.child-view")}
      data-child-view=""
    >
      <header className={styles.head}>
        <Button
          size="sm"
          variant="ghost"
          icon={conversationIcons.back}
          data-child-back=""
          onClick={onBack}
        >
          {t("conversation.button.child-back")}
        </Button>
        {info === null ? null : (
          <>
            <SubagentMark state={info.state} />
            <span className={styles.agent}>{info.agent}</span>
            {info.model === null ? null : (
              <span className={styles.meta}>{info.model}</span>
            )}
            <span className={styles.meta}>
              {elapsedText(running, info.startedAt, info.durationMs, now)}
            </span>
          </>
        )}
      </header>
      <div className={styles.thread}>{children}</div>
      {running && (canSteer || canStop) ? (
        <footer className={styles.foot}>
          {canSteer ? (
            <>
              <input
                className={styles.input}
                aria-label={t("conversation.label.child-steer")}
                placeholder={t("conversation.label.child-steer")}
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                onKeyDown={keyDown}
              />
              <Button
                size="sm"
                icon={actionIcons.send}
                disabled={text.trim() === ""}
                onClick={send}
              >
                {t("conversation.button.child-send")}
              </Button>
            </>
          ) : (
            <span className={styles.spacer} />
          )}
          {canStop ? (
            <Button
              size="sm"
              variant="secondary"
              icon={actionIcons.stop}
              data-child-stop=""
              onClick={onStop}
            >
              {t("conversation.button.dock-stop")}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
