// Annotate가 켜진 동안 card 머리 줄이 바뀌는 모양. 가운데에 무엇에 다는지, 오른쪽 끝에 모두 지우기·Done·보내기(모은 수)가 선다.
// 모은 목록을 화면 옆이나 위에 따로 두지 않는다. 고를 요소를 가리지 않게 하려는 것이고, 메모는 화면 안 표지 옆 칸(preload)에서 고치고 지운다.
// 앱 화면 탭과 artifact 탭이 같이 쓴다.
import type { ReactNode } from "react";
import { t } from "@lophn/i18n";
import { Tooltip } from "@lophn/ui/overlay";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";

import { actionIcons, editorIcons } from "../../icons/mod.ts";
import styles from "./annotate-head.module.css";

export interface AnnotateHeadInput {
  /** 무엇에 다는지(앱 이름, artifact 제목). */
  readonly target: string;
  readonly count: number;
  readonly sending: boolean;
  /** 보내기 단추 글. 받는 쪽을 말한다. */
  readonly sendLabel: string;
  /** 보내기 단추 tooltip. 받는 쪽과 보낸 뒤 일. */
  readonly note: string;
  /** 아직 고른 것이 없을 때 고르는 법. */
  readonly guide: string;
  onClear(): void;
  onDone(): void;
  onSend(): void;
}

/** card 머리 줄의 가운데 칸과 ⋯ 앞 단추들. */
export function annotateHead(input: AnnotateHeadInput): {
  readonly center: ReactNode;
  readonly actions: ReactNode;
} {
  const empty = input.count === 0;
  return {
    center: (
      <span className={styles.center} data-annotate-head="">
        <Icon icon={editorIcons.edit} pixels={14} />
        <span className={styles.mode}>
          {t("app-space.label.annotate-mode")}
        </span>
        {input.target === "" ? null : (
          <>
            <span className={styles.sep}>·</span>
            <span className={styles.target}>{input.target}</span>
          </>
        )}
        {empty ? <span className={styles.guide}>{input.guide}</span> : null}
      </span>
    ),
    actions: (
      <span className={styles.actions}>
        <Tooltip content={t("app-space.button.clear-annotations")}>
          <IconButton
            size="sm"
            icon={actionIcons.delete}
            label={t("app-space.button.clear-annotations")}
            disabled={empty || input.sending}
            data-annotations-clear=""
            onClick={input.onClear}
          />
        </Tooltip>
        <Button
          size="sm"
          variant="ghost"
          disabled={input.sending}
          data-annotate-done=""
          onClick={input.onDone}
        >
          {t("app-space.button.annotate-done")}
        </Button>
        <Tooltip content={input.note}>
          <Button
            size="sm"
            variant="primary"
            icon={actionIcons.send}
            disabled={empty || input.sending}
            data-annotations-send=""
            onClick={input.onSend}
          >
            {input.sending
              ? t("app-space.label.sending-annotations")
              : input.sendLabel}
            {empty ? null : <span className={styles.count}>{input.count}</span>}
          </Button>
        </Tooltip>
      </span>
    ),
  };
}
