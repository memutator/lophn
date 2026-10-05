import { type KeyboardEvent, useLayoutEffect, useRef } from "react";
import {
  conversationIcons,
  Field,
  IconButton,
  Textarea,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { SendMode } from "../delivery-state.ts";
import type { Draft } from "../drafts.ts";
import styles from "./composer.module.css";

export interface ComposerProps {
  draft: Draft;
  /** 보내는 중이거나 결과를 모르는 말이 있으면 글을 고치지 못한다. */
  locked: boolean;
  /** 글이 본문 상한을 넘는다. 보내지 못하고 이유를 보인다. */
  tooLong: boolean;
  /** 연결이 끊겨 지금은 보낼 수 없다. 글은 그대로 쓸 수 있다. */
  offline: boolean;
  /** 고칠 지금 일이 있는지. 없으면 수정으로 보낼 수 없다. */
  canCorrect: boolean;
  /** 멈출 수 있는 지금 일이 있는지. */
  canStop: boolean;
  onDraft: (patch: Partial<Draft>) => void;
  onSend: () => void;
  onStop: () => void;
}

const MODE_LABEL: Record<
  SendMode,
  | "conversation.label.composer-request"
  | "conversation.label.composer-correction"
> = {
  request: "conversation.label.composer-request",
  correction: "conversation.label.composer-correction",
};

// 대화 입력. 현재 일의 수정과 다음 요청을 구별해 보낸다(flow steer-agent-work). 글과 커서는
// 세션 메모리에 바로 남아 세션 전환·confirmation window·실패 뒤에도 그대로다(desktop#R8).
export function Composer(
  {
    draft,
    locked,
    tooLong,
    offline,
    canCorrect,
    canStop,
    onDraft,
    onSend,
    onStop,
  }: ComposerProps,
) {
  const input = useRef<HTMLTextAreaElement>(null);
  const mode: SendMode = draft.mode === "correction" && canCorrect
    ? "correction"
    : "request";
  const canSend = !locked && !offline && !tooLong &&
    draft.text.trim().length > 0;

  // 다시 열 때 커서를 돌려놓는다. focus는 옮기지 않는다(workspace#R13).
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const [start, end] = draft.selection;
    const max = element.value.length;
    element.setSelectionRange(Math.min(start, max), Math.min(end, max));
    // 처음 그릴 때만 돌려놓는다. 그 뒤 커서는 사람이 움직인다.
  }, []);

  const keepSelection = () => {
    const element = input.current;
    if (!element) return;
    onDraft({ selection: [element.selectionStart, element.selectionEnd] });
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div
      className={styles.composer}
      data-composer={mode}
      data-locked={locked || undefined}
    >
      {offline
        ? <p className={styles.note}>{t("conversation.notice.offline")}</p>
        : null}
      <Field label={t(MODE_LABEL[mode])}>
        <Textarea
          ref={input}
          rows={3}
          value={draft.text}
          readOnly={locked}
          data-composer-input=""
          onChange={(event) =>
            onDraft({
              text: event.currentTarget.value,
              selection: [
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              ],
            })}
          onSelect={keepSelection}
          onKeyDown={keyDown}
        />
      </Field>
      {tooLong
        ? (
          <p className={styles.problem} data-too-long="" role="status">
            {t("conversation.error.too-long")}
          </p>
        )
        : null}
      <div className={styles.actions}>
        <div className={styles.modes} role="group">
          <Tooltip content={t("conversation.button.mode-request")}>
            <IconButton
              icon={conversationIcons.request}
              label={t("conversation.button.mode-request")}
              size="sm"
              aria-pressed={mode === "request"}
              data-mode="request"
              disabled={locked}
              onClick={() => onDraft({ mode: "request" })}
            />
          </Tooltip>
          <Tooltip content={t("conversation.button.mode-correction")}>
            <IconButton
              icon={conversationIcons.correction}
              label={t("conversation.button.mode-correction")}
              size="sm"
              aria-pressed={mode === "correction"}
              data-mode="correction"
              disabled={locked || !canCorrect}
              onClick={() => onDraft({ mode: "correction" })}
            />
          </Tooltip>
        </div>
        <div className={styles.sends}>
          {canStop
            ? (
              <Tooltip content={t("conversation.button.stop")}>
                <IconButton
                  icon={conversationIcons.stop}
                  label={t("conversation.button.stop")}
                  variant="secondary"
                  size="sm"
                  data-stop=""
                  disabled={offline}
                  onClick={onStop}
                />
              </Tooltip>
            )
            : null}
          <Tooltip content={t("conversation.button.send")}>
            <IconButton
              icon={conversationIcons.send}
              label={t("conversation.button.send")}
              variant="secondary"
              size="sm"
              data-send=""
              disabled={!canSend}
              onClick={onSend}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
