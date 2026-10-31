import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Card } from "@lophn/ui/layout";
import { type DiffLine, DiffView } from "@lophn/ui/reading";
import { t } from "@lophn/i18n";

import { actionIcons, conversationIcons } from "../../icons/mod.ts";
import { compareLines } from "../../editor/conflict/compare.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";
import styles from "./activity.module.css";

interface EditCardProps {
  /** 보이는 경로. */
  path: string;
  added: number;
  removed: number;
  /** 이 편집을 만든 tool call id. 펼치면 그 call의 입력에서 diff를 만든다. */
  call: string;
  /** call 입력을 읽는 통로. 없으면 diff를 펼치는 단추가 없다. */
  readInput: AgentTabSource["toolCallBody"] | undefined;
  /** [Open]: 그 파일의 탭을 연다. */
  onOpen: () => void;
}

// tool 입력에서 비교할 앞뒤 글을 꺼낸다. file.edit은 old_string/new_string, file.write는 content 전체다.
// 파일 어디쯤인지 모르므로 줄 번호는 붙이지 않는다.
function diffOf(value: unknown): readonly DiffLine[] | null {
  if (value === null || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const after =
    typeof input["new_string"] === "string"
      ? input["new_string"]
      : typeof input["content"] === "string"
        ? input["content"]
        : null;
  if (after === null) return null;
  const before =
    typeof input["old_string"] === "string" ? input["old_string"] : "";
  return compareLines(before, after).map(({ kind, text }) => ({ kind, text }));
}

// 파일을 바꾼 편집 카드 "Edited <경로> +n −m". 한 줄: 앞에 펼침 chevron, 오른쪽 끝에 [Open]. 펼치면 바뀐 줄을 unified diff로 본다.
// 되돌리는 길은 rewind뿐이라 Undo는 없다.
export function EditCard({
  path,
  added,
  removed,
  call,
  readInput,
  onOpen,
}: EditCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<readonly DiffLine[] | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!open || readInput === undefined) return;
    let alive = true;
    setMissing(false);
    readInput(call, "input").then(
      (result) => {
        if (!alive) return;
        const found = result.ok ? diffOf(result.value.value) : null;
        if (found === null) setMissing(true);
        else setLines(found);
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
          {t("conversation.label.edit-made")}{" "}
          <span className={styles.mono}>{path}</span>{" "}
          <span className={styles.added}>+{added}</span>{" "}
          <span className={styles.removed}>−{removed}</span>
        </span>
        <Button size="sm" trailingIcon={actionIcons.open} onClick={onOpen}>
          {t("conversation.button.edit-open")}
        </Button>
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
