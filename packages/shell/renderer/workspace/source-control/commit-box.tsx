// 커밋 입력 칸과 단추. Mod+Enter는 Commit이다. AI 메시지는 칸을 채울 뿐 커밋하지 않는다(정한 것 14). `--amend`는 없다.
import { t } from "@lophn/i18n";
import { Menu } from "@lophn/ui/overlay";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sourceControlIcons } from "../../icons/mod.ts";
import styles from "./source-control.module.css";

export interface CommitBoxProps {
  readonly draft: string;
  readonly onDraft: (text: string) => void;
  /** 커밋을 못 하는 이유. null이면 할 수 있다. */
  readonly blocked: string | null;
  /** 커밋 단추 이름(진행 중 merge를 끝낼 때는 "Complete Merge"). */
  readonly commitLabel: string;
  /** Commit & Push를 보일 수 있다(remote가 있고 브랜치 위다). */
  readonly canPush: boolean;
  readonly committing: {
    readonly since: number;
    readonly hooks: readonly string[];
  } | null;
  readonly suggest: {
    readonly available: boolean;
    readonly reason: string | null;
    readonly running: boolean;
  };
  readonly onCommit: (push: boolean) => void;
  readonly onSuggest: () => void;
  readonly onStopSuggest: () => void;
}

function useSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

export function CommitBox(props: CommitBoxProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const seconds = useSeconds(props.committing?.since ?? null);
  // 높이를 글에 맞춘다(2~10줄).
  useEffect(() => {
    const element = area.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [props.draft]);

  const disabled = props.blocked !== null || props.committing !== null;
  const commit = (push: boolean) => {
    if (!disabled) props.onCommit(push);
  };
  const suggestTip = props.suggest.running
    ? t("source-control.button.ai-stop")
    : (props.suggest.reason ?? t("source-control.button.ai-message"));
  const button = (
    <Button
      variant="primary"
      size="sm"
      icon={sourceControlIcons.commit}
      disabled={disabled}
      data-sc-commit=""
      onClick={() => commit(false)}
    >
      {props.commitLabel}
    </Button>
  );
  return (
    <div className={styles.commitBox} data-key-context="sourceControlCommit">
      <div className={styles.commitInput}>
        <textarea
          ref={area}
          className={styles.commitText}
          rows={2}
          value={props.draft}
          placeholder={t("source-control.label.commit-message")}
          aria-label={t("source-control.label.commit-message")}
          spellCheck
          data-sc-message=""
          onChange={(event) => props.onDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              commit(false);
            }
          }}
        />
        <span className={styles.commitAi}>
          <Tooltip content={suggestTip}>
            <IconButton
              size="sm"
              icon={
                props.suggest.running
                  ? sourceControlIcons.stop
                  : sourceControlIcons.sparkles
              }
              label={suggestTip}
              disabled={!props.suggest.running && !props.suggest.available}
              data-sc-suggest={props.suggest.running ? "running" : ""}
              onClick={() =>
                props.suggest.running
                  ? props.onStopSuggest()
                  : props.onSuggest()
              }
            />
          </Tooltip>
        </span>
      </div>
      <div className={styles.commitActions}>
        {props.blocked === null ? (
          button
        ) : (
          <Tooltip content={props.blocked}>{button}</Tooltip>
        )}
        {props.canPush ? (
          <Menu
            trigger={
              <IconButton
                size="sm"
                variant="secondary"
                icon={ChevronDown}
                label={t("source-control.label.commit-more")}
                disabled={disabled}
              />
            }
            items={[
              {
                id: "commit-push",
                label: t("source-control.button.commit-push"),
              },
            ]}
            onSelect={(id) => {
              if (id === "commit-push") commit(true);
            }}
          />
        ) : null}
      </div>
      {props.committing === null ? null : (
        <div className={styles.commitProgress} role="status">
          {props.committing.hooks.length > 0
            ? t("source-control.label.hooks-running", {
                hooks: props.committing.hooks.join(", "),
                seconds,
              })
            : t("source-control.label.committing", { seconds })}
        </div>
      )}
    </div>
  );
}
