import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Card } from "@lophn/ui/layout";
import { type DiffLine, DiffView } from "@lophn/ui/reading";
import { t } from "@lophn/i18n";

import { actionIcons, conversationIcons } from "../../icons/mod.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";
import type { ToolCallState } from "./model.ts";
import { loadEditDiff } from "./edit-diff.ts";
import { ToolStateMark } from "./tool-state-mark.tsx";
import styles from "./activity.module.css";

interface EditCardProps {
  /** 보이는 경로. */
  path: string;
  added: number;
  removed: number;
  /** 편집 tool call의 상태. 도는 중이면 "Editing", 실패·거절·취소면 바뀌지 않은 편집이라 줄 수와 [Open] 없이 그 표시를 붙인다. */
  state: ToolCallState;
  /** 이 편집을 만든 tool call id. 펼치면 그 call의 입력에서 diff를 만든다. */
  call: string;
  /** call 입력을 읽는 통로. 없으면 diff를 펼치는 단추가 없다. */
  readInput: AgentTabSource["toolCallBody"] | undefined;
  /** [Open]: 그 파일의 탭을 연다. */
  onOpen: () => void;
}

// 파일을 바꾼 편집 카드 "Edited <경로> +n −m". 한 줄: 앞에 펼침 chevron, 오른쪽 끝에 [Open]. 펼치면 바뀐 줄을 unified diff로 본다.
// 되돌리는 길은 rewind뿐이라 Undo는 없다.
export function EditCard({
  path,
  added,
  removed,
  state,
  call,
  readInput,
  onOpen,
}: EditCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<readonly DiffLine[] | null>(null);
  const [missing, setMissing] = useState(false);
  const applied = state === "running" || state === "ok";

  useEffect(() => {
    if (!open || readInput === undefined) return;
    let alive = true;
    setMissing(false);
    loadEditDiff(readInput, call).then(
      (found) => {
        if (!alive) return;
        // 파일 어디쯤인지 모르므로 줄 번호는 붙이지 않는다.
        if (found === null) setMissing(true);
        else setLines(found.map(({ kind, text }) => ({ kind, text })));
      },
      () => {
        if (alive) setMissing(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [open, call, readInput]);

  return (
    <Card>
      <div className={styles.editCard} data-edit-card="">
        {readInput === undefined ? null : (
          <IconButton
            icon={conversationIcons.expand}
            size="sm"
            label={t(
              open
                ? "conversation.button.edit-diff-hide"
                : "conversation.button.edit-diff-show",
            )}
            aria-expanded={open}
            data-edit-diff-toggle=""
            onClick={() => setOpen(!open)}
          />
        )}
        <span className={styles.editText} data-edit-summary="">
          {t(
            state === "ok"
              ? "conversation.label.edit-made"
              : applied
                ? "conversation.label.edit-running"
                : "conversation.label.edit-failed",
          )}{" "}
          <span className={styles.mono}>{path}</span>{" "}
          {applied ? (
            <>
              <span className={styles.added}>+{added}</span>{" "}
              <span className={styles.removed}>−{removed}</span>
            </>
          ) : (
            <ToolStateMark state={state} />
          )}
        </span>
        {applied ? (
          <Button size="sm" trailingIcon={actionIcons.open} onClick={onOpen}>
            {t("conversation.button.edit-open")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className={styles.editDiff} data-edit-diff="">
          {missing ? (
            <p className={styles.editNote}>
              {t("conversation.notice.edit-diff-missing")}
            </p>
          ) : lines === null ? null : (
            <DiffView lines={lines} />
          )}
        </div>
      ) : null}
    </Card>
  );
}
