// 대화 안 찾기 줄. 대화 줄 위 오른쪽에 380px로 붙고, 입력·n/m·이전·다음·닫기만 있다. 일치 강조와 scroll은
// useConversationFind가 맡는다.
import { type KeyboardEvent, useEffect, useRef } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { editorIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import styles from "./conversation-find.module.css";

export interface ConversationFindBarProps {
  query: string;
  onQuery: (query: string) => void;
  /** 지금 고른 일치(0부터). 일치가 없으면 0이다. */
  current: number;
  total: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function ConversationFindBar({
  query,
  onQuery,
  current,
  total,
  onNext,
  onPrevious,
  onClose,
}: ConversationFindBarProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className={styles.row}>
      <div
        className={styles.bar}
        role="search"
        aria-label={t("conversation.label.find")}
        data-conversation-find=""
      >
        <span className={styles.input}>
          <Field label={t("conversation.label.find")}>
            <Input
              ref={input}
              size="sm"
              placeholder={t("conversation.label.find")}
              value={query}
              onChange={(event) => onQuery(event.currentTarget.value)}
              onKeyDown={onKey}
              data-find-input=""
              data-key-context="modal"
            />
          </Field>
        </span>
        <span className={styles.count} aria-live="polite" data-find-count="">
          {query.trim() === ""
            ? ""
            : total === 0
              ? t("conversation.label.find-none")
              : t("conversation.label.find-count", {
                  current: current + 1,
                  total,
                })}
        </span>
        <Tooltip content={t("conversation.button.find-previous")}>
          <IconButton
            icon={editorIcons.findPrevious}
            label={t("conversation.button.find-previous")}
            size="sm"
            disabled={total === 0}
            onClick={onPrevious}
          />
        </Tooltip>
        <Tooltip content={t("conversation.button.find-next")}>
          <IconButton
            icon={editorIcons.findNext}
            label={t("conversation.button.find-next")}
            size="sm"
            disabled={total === 0}
            onClick={onNext}
          />
        </Tooltip>
        <Tooltip content={t("conversation.button.find-close")}>
          <IconButton
            icon={editorIcons.close}
            label={t("conversation.button.find-close")}
            size="sm"
            onClick={onClose}
          />
        </Tooltip>
      </div>
    </div>
  );
}
