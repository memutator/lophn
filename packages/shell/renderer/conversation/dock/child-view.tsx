// subagent의 대화를 읽는 한 겹(대화 위에 하나만 여는 panel 층). 머리 줄이 없다: 돌아가기는 탭 머리의 ←/→이고 상태·model·
// 경과는 머리 제목 옆에 있다(header/agent-header.tsx). 본문(자식 대화)은 부르는 쪽이 읽기 전용 `AgentThread`로 그려 넘긴다.
// 아래 줄은 방향 주기(`steer_child`)와 [Stop]이다.
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";

import { actionIcons } from "../../icons/mod.ts";
import type { ThreadSubagent } from "../agent-tab-source.ts";
import styles from "./child-view.module.css";

interface ChildViewProps {
  /** 이 자식을 맡긴 subagent 줄. 줄을 못 찾으면 null이다. */
  info: ThreadSubagent | null;
  /** capability `steer_child`. */
  canSteer: boolean;
  /** capability `stop_child`. */
  canStop: boolean;
  onSteer: (text: string) => void;
  onStop: () => void;
  /** 자식 대화. */
  children: ReactNode;
}

export function ChildView({
  info,
  canSteer,
  canStop,
  onSteer,
  onStop,
  children,
}: ChildViewProps): ReactElement {
  const [text, setText] = useState("");
  const running = info?.state === "running";
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
      <div className={styles.thread}>{children}</div>
      {running && (canSteer || canStop) ? (
        <footer className={styles.foot}>
          <div className={styles.footColumn}>
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
          </div>
        </footer>
      ) : null}
    </section>
  );
}
