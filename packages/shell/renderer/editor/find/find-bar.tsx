import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { editorIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./find-bar.module.css";

export interface FindBarProps {
  query: string;
  onQuery: (query: string) => void;
  caseSensitive: boolean;
  onCaseSensitive: (on: boolean) => void;
  /** "3/12" 또는 "No matches". */
  label: string;
  hasMatches: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  /** 바꾸기 줄을 보인다(Mod-Alt-F). */
  replace: boolean;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
}

function Action({
  icon,
  label,
  ...rest
}: {
  icon: (typeof editorIcons)[keyof typeof editorIcons];
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <IconButton
        icon={icon}
        label={label}
        size="sm"
        disabled={rest.disabled}
        aria-pressed={rest.pressed}
        onClick={rest.onClick}
      />
    </Tooltip>
  );
}

// 편집 칸 위에 붙는 찾기 줄 36px·입력 28px.
export function FindBar({
  query,
  onQuery,
  caseSensitive,
  onCaseSensitive,
  label,
  hasMatches,
  onNext,
  onPrevious,
  onClose,
  replace,
  onReplace,
  onReplaceAll,
}: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState("");
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
    <div
      className={styles.bar}
      role="search"
      aria-label={t("document.label.find")}
      data-find-bar=""
    >
      <div className={styles.row}>
        <div className={styles.input}>
          <Field label={t("document.label.find-query")}>
            <Input
              ref={input}
              size="sm"
              value={query}
              onChange={(event) => onQuery(event.currentTarget.value)}
              onKeyDown={onKey}
              data-find-input=""
            />
          </Field>
        </div>
        <span className={styles.count} aria-live="polite" data-find-count="">
          {query ? label : ""}
        </span>
        <Action
          icon={editorIcons.findPrevious}
          label={t("document.button.find-previous")}
          disabled={!hasMatches}
          onClick={onPrevious}
        />
        <Action
          icon={editorIcons.findNext}
          label={t("document.button.find-next")}
          disabled={!hasMatches}
          onClick={onNext}
        />
        <Action
          icon={editorIcons.matchCase}
          label={t("document.button.find-match-case")}
          pressed={caseSensitive}
          onClick={() => onCaseSensitive(!caseSensitive)}
        />
        <Action
          icon={editorIcons.close}
          label={t("document.button.find-close")}
          onClick={onClose}
        />
      </div>
      {replace ? (
        <div className={styles.row} data-replace-row="">
          <div className={styles.input}>
            <Field label={t("document.label.replace-with")}>
              <Input
                size="sm"
                value={replacement}
                onChange={(event) => setReplacement(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onReplace(replacement);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    onClose();
                  }
                }}
                data-replace-input=""
              />
            </Field>
          </div>
          <Action
            icon={editorIcons.replace}
            label={t("document.button.replace")}
            disabled={!hasMatches}
            onClick={() => onReplace(replacement)}
          />
          <Action
            icon={editorIcons.replaceAll}
            label={t("document.button.replace-all")}
            disabled={!hasMatches}
            onClick={() => onReplaceAll(replacement)}
          />
        </div>
      ) : null}
    </div>
  );
}
