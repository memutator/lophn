import type { ReactElement } from "react";
import { t } from "@lophn/i18n";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels, VisuallyHidden } from "@lophn/ui/shared";

import { conversationIcons } from "../../icons/mod.ts";
import type { ThreadSubagent } from "../agent-tab-source.ts";
import { elapsedText, useSecondTick } from "./elapsed.ts";
import type { ToolCallState } from "./model.ts";
import { ToolStateMark } from "./tool-state-mark.tsx";
import styles from "./activity.module.css";

type SubagentState = ThreadSubagent["state"];

const TOOL_STATE: Record<Exclude<SubagentState, "running">, ToolCallState> = {
  done: "ok",
  failed: "error",
  cancelled: "cancelled",
};

/** 도는 중은 활동 아이콘이고(경고 표시는 실패만 쓴다) 끝난 상태는 tool 줄과 같은 표시다(성공은 표시가 없다). */
export function SubagentMark({
  state,
}: {
  state: SubagentState;
}): ReactElement | null {
  return state === "running" ? (
    <span className={styles.subagentRunning}>
      <Icon icon={conversationIcons.running} pixels={iconPixels("small")} />
      <VisuallyHidden>
        {t("conversation.label.subagent-running")}
      </VisuallyHidden>
    </span>
  ) : (
    <ToolStateMark state={TOOL_STATE[state]} />
  );
}

interface SubagentRowProps {
  entry: ThreadSubagent;
  now: () => number;
  /** 자식 대화를 연다. */
  onOpen: (child: string) => void;
}

/**
 * 일을 맡긴 subagent 한 줄: "[상태] agent · 설명 · 경과". 도는 동안은 아래에 마지막 말이 흐리게 붙는다.
 * 자식 대화가 있으면 줄 전체가 단추다.
 */
export function SubagentRow({
  entry,
  now,
  onOpen,
}: SubagentRowProps): ReactElement {
  const running = entry.state === "running";
  useSecondTick(running);
  const time = elapsedText(running, entry.startedAt, entry.durationMs, now);
  const body = (
    <>
      <span className={styles.subagentLine}>
        <SubagentMark state={entry.state} />
        <span className={styles.subagentText}>
          <span className={styles.subagentAgent}>{entry.agent}</span>
          {[entry.description, time]
            .filter((part) => part !== "")
            .map((part) => ` · ${part}`)
            .join("")}
        </span>
      </span>
      {running && entry.last !== null ? (
        <span className={styles.subagentLast}>{entry.last}</span>
      ) : null}
    </>
  );
  const child = entry.child;
  return child === null ? (
    <div className={styles.subagent} data-subagent={entry.id}>
      {body}
    </div>
  ) : (
    <button
      type="button"
      className={`${styles.subagent} ${styles.subagentButton}`}
      data-subagent={entry.id}
      onClick={() => onOpen(child)}
    >
      {body}
    </button>
  );
}
