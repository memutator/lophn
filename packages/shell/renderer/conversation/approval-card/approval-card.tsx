// composer 위 승인 카드와 결정 뒤 대화에 남는 접힌 줄. 확인 창 없이 카드에서 바로 결정한다.
// 선택지는 Allow once, Always allow(더할 규칙이 있을 때만), Deny다. [Deny]는 이유 칸을 열고 비워도 된다.
// 카드를 닫거나 가만히 두는 것은 결정이 아니다.
import { type ReactElement, useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";
import { editorIcons } from "../../icons/mod.ts";
import { turnChoicesOf } from "../../desktop/connection/waiting/decide.ts";
import type {
  ApprovalCardRequest,
  ApprovalResultView,
} from "../agent-tab-source.ts";
import { effectOf, targetOf, titleOf } from "./subject-text.ts";
import styles from "./approval-card.module.css";

type Choice = "once" | "always" | "reject";

interface ApprovalCardProps {
  /** 요청한 agent의 이름. 거절 이유가 이 agent에게 간다. */
  agent: string;
  request: ApprovalCardRequest;
  /** 결정을 보내고 접수되었는지 돌려준다. 거절의 이유는 비어 있으면 없다. */
  onDecide: (choice: Choice, reason?: string) => Promise<boolean>;
  /** 거절 이유 칸을 연 채 시작한다. */
  denying?: boolean;
  reason?: string;
}

export function ApprovalCard({
  agent,
  request,
  onDecide,
  denying = false,
  reason: initialReason = "",
}: ApprovalCardProps): ReactElement {
  const { subject } = request;
  const effect = effectOf(subject);
  const [denyOpen, setDenyOpen] = useState(denying);
  const [reason, setReason] = useState(initialReason);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function decide(choice: Choice, why?: string) {
    setBusy(true);
    setFailed(false);
    const done = await onDecide(choice, why);
    setBusy(false);
    setFailed(!done);
  }

  const choices = turnChoicesOf(request);
  const deny = () => decide("reject", reason.trim() || undefined);

  return (
    <section
      className={styles.card}
      aria-label={t("conversation.label.approval")}
      data-approval-id={request.id}
    >
      <div className={styles.approval}>
        <p className={styles.title}>
          <Icon icon={editorIcons.problem} pixels={iconPixels("base")} />
          {titleOf(subject, agent)}
        </p>
        <dl className={styles.facts}>
          {subject.kind === "shell" ? (
            <>
              <dt>{t("conversation.label.approval-command")}</dt>
              <dd>
                <pre className={styles.pre}>{subject.command}</pre>
              </dd>
            </>
          ) : (
            <>
              <dt>{t("conversation.label.approval-target")}</dt>
              <dd>{targetOf(subject)}</dd>
              <dt>{t("conversation.label.approval-effect")}</dt>
              <dd>{effect}</dd>
            </>
          )}
          {request.always_patterns.length === 0 ? null : (
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
        <div className={styles.reasonRow}>
          <input
            className={styles.reasonInput}
            aria-label={t("conversation.label.approval-reason")}
            placeholder={t("conversation.label.approval-reason-placeholder", {
              agent,
            })}
            maxLength={500}
            autoFocus={initialReason === ""}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        </div>
      ) : null}
      <footer className={styles.foot}>
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
              onClick={() => setDenyOpen(false)}
            >
              {t("common.button.back")}
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={deny}>
              {t("conversation.button.approval-deny")}
            </Button>
          </>
        ) : (
          <>
            {choices.map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={choice === "once" ? "primary" : "secondary"}
                disabled={busy}
                onClick={() =>
                  choice === "reject" ? setDenyOpen(true) : decide(choice)
                }
              >
                {choice === "once"
                  ? t("conversation.button.approval-allow-once")
                  : choice === "always"
                    ? t("conversation.button.approval-allow-always")
                    : t("conversation.button.approval-deny")}
              </Button>
            ))}
          </>
        )}
      </footer>
    </section>
  );
}

const TONES = {
  allowed: "good",
  denied: "critical",
  cancelled: "neutral",
} as const;

function markLabel(result: ApprovalResultView): string {
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
  return (
    <div className={styles.result}>
      <StatusMark tone={TONES[result.outcome]} label={markLabel(result)} />
      <span className={styles.resultTitle}>{targetOf(result.subject)}</span>
      {detail === "" ? null : (
        <span className={styles.resultDetail}>{detail}</span>
      )}
    </div>
  );
}
