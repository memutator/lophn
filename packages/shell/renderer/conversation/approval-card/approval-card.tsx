// composer 위 승인 카드와 결정 뒤 대화에 남는 접힌 줄. 확인 창 없이 카드에서 바로 결정한다.
// 선택지는 Allow once, Always allow(더할 규칙이 있을 때만), Deny다. [Deny]는 이유 칸을 열고 비워도 된다.
// 카드를 닫거나 가만히 두는 것은 결정이 아니다.

import { t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import { Button, Icon, Kbd } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { actionIcons, editorIcons } from "../../icons/mod.ts";
import type {
  ApprovalCardRequest,
  ApprovalResultView,
} from "../agent-tab-source.ts";
import styles from "./approval-card.module.css";
import { ReasonRow } from "./reason-row.tsx";
import { changeText, effectOf, targetOf, titleOf } from "./subject-text.ts";

type Choice = ApprovalCardRequest["choices"][number];

interface ApprovalCardProps {
  /** 요청한 agent의 이름. 거절 이유가 이 agent에게 간다. */
  agent: string;
  request: ApprovalCardRequest;
  /** 결정을 보내고 접수되었는지 돌려준다. 거절의 이유는 비어 있으면 없다. */
  onDecide: (choice: Choice, reason?: string) => Promise<boolean>;
  /** 거절 이유 칸을 연 채 시작한다. */
  denying?: boolean;
  reason?: string;
  /** 카드가 나올 때 [Allow once]로 초점을 옮긴다. composer에 글이 있으면 사람의 입력을 빼앗지 않는다. */
  focusOnMount: boolean;
}

const MOUNT_ENTER_GUARD_MS = 400;

export function ApprovalCard({
  agent,
  request,
  onDecide,
  denying = false,
  reason: initialReason = "",
  focusOnMount,
}: ApprovalCardProps): ReactElement {
  const { subject } = request;
  const effect = effectOf(subject);
  const [denyOpen, setDenyOpen] = useState(denying);
  const [reason, setReason] = useState(initialReason);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const allowOnce = useRef<HTMLButtonElement>(null);
  const reasonInput = useRef<HTMLInputElement>(null);
  const wasDeny = useRef(denying);
  const focusedOnMount = useRef(false);
  // 카드가 뜬 직후 400ms 동안 Enter를 막아 메시지 전송 직후 실수로 승인되는 일을 막는다.
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    mountedAt.current = Date.now();
    setBusy(false);
    setFailed(false);
  }, [request.id]);

  async function decide(choice: Choice, why?: string) {
    setBusy(true);
    setFailed(false);
    const done = await onDecide(choice, why);
    // 접수되었으면 카드가 닫힐 때까지 잠가 원격 왕복 사이 깜빡임과 중복 클릭을 막는다.
    if (done) return;
    setBusy(false);
    setFailed(true);
  }

  const { choices } = request;
  const canSession = choices.includes("session");
  const canAlways = choices.includes("always");
  const keyHint = {
    once: t("conversation.label.approval-key-once"),
    session: t("conversation.label.approval-key-session"),
    always: t("conversation.label.approval-key-always"),
    reject: t("conversation.label.approval-key-deny"),
  } as const;

  // 카드가 처음 나올 때 한 번만 초점을 옮긴다. 사람이 composer에 쓰던 글은 건드리지 않는다.
  useEffect(() => {
    if (focusedOnMount.current) return;
    focusedOnMount.current = true;
    if (focusOnMount && !denying) allowOnce.current?.focus();
  }, [focusOnMount, denying]);

  // 거절 칸이 열리면 이유 칸으로, 닫히면 허락 단추로 초점을 옮긴다.
  useEffect(() => {
    if (denyOpen) reasonInput.current?.focus();
    else if (wasDeny.current) allowOnce.current?.focus();
    wasDeny.current = denyOpen;
  }, [denyOpen]);

  // 이 카드 안에 초점이 있을 때만 듣는다. 마운트 직후 400ms 동안은 Enter를 무시한다.
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.repeat) return;
    if (event.key === "Escape") {
      if (busy) return;
      event.preventDefault();
      event.stopPropagation();
      setDenyOpen(!denyOpen);
      return;
    }
    if (busy) return;
    if (
      event.key === "Enter" &&
      Date.now() - mountedAt.current < MOUNT_ENTER_GUARD_MS
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey
    ) {
      if (!denyOpen && canAlways) {
        event.preventDefault();
        event.stopPropagation();
        void decide("always");
      }
      return;
    }
    if (
      event.key === "Enter" &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      if (!denyOpen && canSession) {
        event.preventDefault();
        event.stopPropagation();
        void decide("session");
      }
      return;
    }
    if (
      event.key !== "Enter" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    if (denyOpen) void decide("reject", reason.trim() || undefined);
    else if (choices.includes("once")) void decide("once");
  };

  return (
    <section
      className={styles.card}
      aria-label={t("conversation.label.approval")}
      data-approval-id={request.id}
      data-key-context="modal"
      onKeyDown={keyDown}
    >
      <div className={styles.approval}>
        <p className={styles.title}>
          <Icon icon={editorIcons.problem} pixels={iconPixels("base")} />
          <span>{titleOf(subject, agent)}</span>
          {request.outside_rewind === true ? (
            <span className={styles.outsideRewind} data-outside-rewind="">
              {t("conversation.label.approval-outside-rewind")}
            </span>
          ) : null}
        </p>
        <dl className={styles.facts}>
          {subject.kind === "shell" ? (
            <>
              <dt>{t("conversation.label.approval-command")}</dt>
              <dd>
                <pre className={styles.pre}>{subject.command}</pre>
              </dd>
            </>
          ) : subject.kind === "file_read" || subject.kind === "file_write" ? (
            <>
              <dt>{t("conversation.label.approval-path")}</dt>
              <dd>
                <code className={styles.pattern}>{subject.path}</code>
              </dd>
              <dt>{t("conversation.label.approval-folder")}</dt>
              <dd>{subject.folder}</dd>
            </>
          ) : subject.kind === "local_tool" ? (
            <>
              <dt>{t("conversation.label.approval-script")}</dt>
              <dd>
                <code className={styles.pattern}>{subject.path}</code>
              </dd>
              <dt>{t("conversation.label.approval-sha256")}</dt>
              <dd>
                <code className={styles.pattern}>
                  {subject.sha256.slice(0, 16)}
                </code>
              </dd>
            </>
          ) : subject.kind === "file_change" ? (
            <>
              <dt>{t("conversation.label.approval-changes")}</dt>
              <dd>
                {subject.changes.map((change) => (
                  <div key={change.path}>{changeText(change)}</div>
                ))}
              </dd>
            </>
          ) : subject.kind === "setting" ? (
            <>
              <dt>{t("conversation.label.approval-changes")}</dt>
              <dd>
                {subject.lines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </dd>
            </>
          ) : subject.kind === "project_command" ? (
            <>
              <dt>{t("conversation.label.approval-command")}</dt>
              <dd>
                <pre className={styles.pre}>{subject.command}</pre>
              </dd>
              {subject.cwd === null ? null : (
                <>
                  <dt>{t("conversation.label.approval-cwd")}</dt>
                  <dd>{subject.cwd}</dd>
                </>
              )}
              {subject.env_keys.length === 0 ? null : (
                <>
                  <dt>{t("conversation.label.approval-env-keys")}</dt>
                  <dd>{subject.env_keys.join(", ")}</dd>
                </>
              )}
            </>
          ) : subject.kind === "project_command_definition" ? (
            <>
              {subject.before === null ? null : (
                <>
                  <dt>{t("conversation.label.approval-before")}</dt>
                  <dd>
                    <div>{subject.before.name}</div>
                    <pre className={styles.pre}>{subject.before.command}</pre>
                    {subject.before.cwd === null ? null : (
                      <div>{subject.before.cwd}</div>
                    )}
                    {subject.before.env_keys.length === 0 ? null : (
                      <div>{subject.before.env_keys.join(", ")}</div>
                    )}
                  </dd>
                </>
              )}
              {subject.after === null ? null : (
                <>
                  <dt>{t("conversation.label.approval-after")}</dt>
                  <dd>
                    <div>{subject.after.name}</div>
                    <pre className={styles.pre}>{subject.after.command}</pre>
                    {subject.after.cwd === null ? null : (
                      <div>{subject.after.cwd}</div>
                    )}
                    {subject.after.env_keys.length === 0 ? null : (
                      <div>{subject.after.env_keys.join(", ")}</div>
                    )}
                  </dd>
                </>
              )}
            </>
          ) : subject.kind === "workflow_run" ? (
            <>
              <dt>{t("conversation.label.approval-changes")}</dt>
              <dd>
                {subject.lines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </dd>
            </>
          ) : subject.kind === "worktree_remove" ? (
            <>
              <dt>{t("conversation.label.approval-path")}</dt>
              <dd>
                <code className={styles.pattern}>{subject.path}</code>
              </dd>
              {subject.branch === null ? null : (
                <>
                  <dt>{t("worktree.label.branch")}</dt>
                  <dd>{subject.branch}</dd>
                </>
              )}
              {subject.provenance === "adopted" ? null : (
                <>
                  <dt>{t("worktree.label.changes")}</dt>
                  <dd data-approval-worktree-changes="">
                    {t("worktree.label.changes-count", {
                      changed: subject.dirty_count,
                      untracked: subject.untracked_count,
                    })}
                  </dd>
                  <dt>{t("worktree.label.unpushed")}</dt>
                  <dd>
                    {subject.ahead === null
                      ? t("worktree.label.unpushed-unknown")
                      : String(subject.ahead)}
                  </dd>
                  {subject.has_submodules ? (
                    <>
                      <dt>{t("worktree.label.submodules")}</dt>
                      <dd>{t("worktree.notice.submodules")}</dd>
                    </>
                  ) : null}
                  {subject.force ||
                  subject.stop_sessions ||
                  subject.delete_branch ? (
                    <>
                      <dt>{t("worktree.label.options")}</dt>
                      <dd>
                        {subject.force ? (
                          <div>{t("worktree.label.force")}</div>
                        ) : null}
                        {subject.stop_sessions ? (
                          <div>{t("worktree.label.option-stop-sessions")}</div>
                        ) : null}
                        {subject.delete_branch ? (
                          <div>{t("worktree.label.delete-branch")}</div>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <>
              <dt>{t("conversation.label.approval-target")}</dt>
              <dd>{targetOf(subject)}</dd>
              <dt>{t("conversation.label.approval-effect")}</dt>
              <dd>{effect}</dd>
            </>
          )}
          {request.reason == null || request.reason === "" ? null : (
            <>
              <dt>{t("conversation.label.approval-reason-why")}</dt>
              <dd data-approval-reason="">{request.reason}</dd>
            </>
          )}
          {request.outside_rewind === true ? (
            <>
              <dt>{t("conversation.label.approval-outside-rewind")}</dt>
              <dd>{t("conversation.label.approval-outside-rewind-note")}</dd>
            </>
          ) : null}
          {!canAlways || request.always_patterns.length === 0 ? null : (
            <>
              <dt>{t("conversation.label.approval-always")}</dt>
              <dd>
                {request.always_patterns.map((pattern) => (
                  <code key={pattern} className={styles.pattern}>
                    {pattern}
                  </code>
                ))}
              </dd>
            </>
          )}
        </dl>
      </div>
      {denyOpen ? (
        <ReasonRow
          agent={agent}
          value={reason}
          onChange={setReason}
          inputRef={reasonInput}
        />
      ) : null}
      <footer
        className={styles.foot}
        data-approval-foot=""
        data-many={choices.length > 3 || undefined}
      >
        <p className={failed ? `${styles.note} ${styles.error}` : styles.note}>
          {failed
            ? t("conversation.notice.decide-failed")
            : t("conversation.notice.approval-paused", { agent })}
        </p>
        {denyOpen ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-keyshortcuts="Escape"
              onClick={() => setDenyOpen(false)}
            >
              <span className={styles.labelWithKey}>
                {t("common.button.back")}
                <Kbd keys={[t("conversation.label.approval-key-back")]} />
              </span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={actionIcons.deny}
              disabled={busy}
              onClick={() => void decide("reject", reason.trim() || undefined)}
            >
              {t("conversation.button.approval-deny")}
            </Button>
          </>
        ) : (
          <>
            {/* 주 단추(Allow once)가 맨 오른쪽에 오도록 거꾸로 그린다. */}
            {[...choices].reverse().map((choice) => (
              <Button
                key={choice}
                ref={choice === "once" ? allowOnce : undefined}
                size="sm"
                variant={choice === "once" ? "primary" : "secondary"}
                icon={
                  choice === "reject" ? actionIcons.deny : actionIcons.approve
                }
                disabled={busy}
                aria-keyshortcuts={
                  choice === "once"
                    ? "Enter"
                    : choice === "session"
                      ? "Shift+Enter"
                      : choice === "always"
                        ? "Control+Shift+Enter Meta+Shift+Enter"
                        : choice === "reject"
                          ? "Escape"
                          : undefined
                }
                onClick={() =>
                  choice === "reject" ? setDenyOpen(true) : decide(choice)
                }
              >
                <span className={styles.labelWithKey}>
                  {CHOICE_LABEL[choice]()}
                  <Kbd keys={[keyHint[choice]]} />
                </span>
              </Button>
            ))}
          </>
        )}
      </footer>
    </section>
  );
}

const CHOICE_LABEL = {
  once: () => t("conversation.button.approval-allow-once"),
  session: () => t("conversation.button.approval-allow-session"),
  always: () => t("conversation.button.approval-allow-always"),
  reject: () => t("conversation.button.approval-deny"),
} as const;

const TONES = {
  allowed: "good",
  denied: "critical",
  cancelled: "neutral",
} as const;

function markLabel(result: ApprovalResultView): string {
  if (result.subject.kind === "plan" && result.outcome !== "cancelled") {
    const picked = result.subject.modes.find((mode) => mode.id === result.mode);
    if (result.outcome === "allowed" && picked !== undefined) {
      return t("conversation.label.plan-approved-mode", {
        mode: picked.label,
      });
    }
    return t(
      result.outcome === "allowed"
        ? "conversation.label.plan-approved"
        : "conversation.label.plan-not-approved",
    );
  }
  switch (result.outcome) {
    case "allowed":
      return t("conversation.label.approval-allowed");
    case "denied":
      return t("conversation.label.approval-denied");
    case "cancelled":
      return t("conversation.label.approval-cancelled");
  }
}

function scopeLabel(choice: ApprovalResultView["choice"]): string | null {
  switch (choice) {
    case "once":
      return t("conversation.label.approval-scope-once");
    case "session":
      return t("conversation.label.approval-scope-session");
    case "always":
      return t("conversation.label.approval-scope-always");
    default:
      return null;
  }
}

/**
 * 결정 뒤 대화에 남는 한 줄. 허락, 거절, 일이 끝나 취소된 것(거절이 아니다)을 구별한다. 만료는 없다.
 * 허락 범위는 이 창에서 결정했을 때만 안다.
 */
export function ApprovalResult({
  result,
}: {
  result: ApprovalResultView;
}): ReactElement {
  const detail = [
    scopeLabel(result.choice),
    result.reason === null
      ? null
      : t("conversation.label.approval-reason-given", {
          reason: result.reason,
        }),
    result.outcome === "cancelled"
      ? t("conversation.label.approval-cancelled-detail")
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const target = targetOf(result.subject);
  return (
    <div className={styles.result}>
      <StatusMark tone={TONES[result.outcome]} label={markLabel(result)} />
      {target === "" ? null : (
        <span className={styles.resultTitle}>{target}</span>
      )}
      {detail === "" ? null : (
        <span className={styles.resultDetail}>{detail}</span>
      )}
    </div>
  );
}
