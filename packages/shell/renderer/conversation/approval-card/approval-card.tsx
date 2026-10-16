// composer 위 승인 카드와 결정 뒤 대화에 남는 접힌 줄. 확인 창 없이 카드에서 바로 결정한다.
// 선택지는 request가 가진 `choices` 그대로다(app-api·MCP tool은 넷, 나머지는 허락과 거절). [Deny]는 이유 칸을
// 열고 비워도 된다. 카드를 닫거나 가만히 두는 것은 결정이 아니다.
import { type ReactElement, useState } from "react";
import { Button, Icon, iconPixels, StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";
import type { RequestChoice } from "../../../../protocol/approvals/requests.ts";
import { editorIcons } from "../../icons/mod.ts";
import type {
  ApprovalCardRequest,
  ApprovalResultView,
} from "../agent-tab-source.ts";
import { contentOf, subjectOf } from "./intent-text.ts";
import styles from "./approval-card.module.css";

// 허락 단추의 왼쪽에서 오른쪽 순서. Deny가 맨 오른쪽이다.
const ALLOWS: readonly RequestChoice[] = ["once", "session", "always", "allow"];

function allowLabel(choice: RequestChoice): string {
  switch (choice) {
    case "once":
      return t("conversation.button.approval-allow-once");
    case "session":
      return t("conversation.button.approval-allow-session");
    case "always":
      return t("conversation.button.approval-allow-always");
    default:
      return t("conversation.button.approval-allow");
  }
}

export interface ApprovalCardProps {
  /** 요청한 agent의 이름. 거절 이유가 이 agent에게 간다. */
  agent: string;
  request: ApprovalCardRequest;
  /** 결정을 보내고 접수되었는지 돌려준다. 거절의 이유는 비어 있으면 없다. */
  onDecide: (choice: RequestChoice, reason?: string) => Promise<boolean>;
  /** 거절 이유 칸을 연 채 시작한다. */
  denying?: boolean;
  reason?: string;
}

export function ApprovalCard(
  { agent, request, onDecide, denying = false, reason: initialReason = "" }:
    ApprovalCardProps,
): ReactElement {
  const content = contentOf(request.intent, agent);
  const [denyOpen, setDenyOpen] = useState(denying);
  const [reason, setReason] = useState(initialReason);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function decide(choice: RequestChoice, why?: string) {
    setBusy(true);
    setFailed(false);
    const done = await onDecide(choice, why);
    setBusy(false);
    setFailed(!done);
  }

  const allows = ALLOWS.filter((choice) => request.choices.includes(choice));
  const canDeny = request.choices.includes("reject");
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
          {content.title}
        </p>
        <dl className={styles.facts}>
          <dt>{t("conversation.label.approval-target")}</dt>
          <dd>{content.target}</dd>
          <dt>{t("conversation.label.approval-input")}</dt>
          <dd>
            <pre className={styles.pre}>{content.input}</pre>
          </dd>
          <dt>{t("conversation.label.approval-effect")}</dt>
          <dd>{content.effect}</dd>
        </dl>
      </div>
      {denyOpen
        ? (
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
        )
        : null}
      <footer className={styles.foot}>
        <p className={failed ? `${styles.note} ${styles.error}` : styles.note}>
          {failed
            ? t("conversation.notice.decide-failed")
            : t("conversation.notice.approval-paused", { agent })}
        </p>
        {denyOpen
          ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setDenyOpen(false)}
              >
                {t("common.button.back")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={deny}
              >
                {t("conversation.button.approval-deny")}
              </Button>
            </>
          )
          : (
            <>
              {allows.map((choice) => (
                <Button
                  key={choice}
                  size="sm"
                  variant={choice === "once" || choice === "allow"
                    ? "primary"
                    : "secondary"}
                  disabled={busy}
                  onClick={() => decide(choice)}
                >
                  {allowLabel(choice)}
                </Button>
              ))}
              {canDeny
                ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => setDenyOpen(true)}
                  >
                    {t("conversation.button.approval-deny")}
                  </Button>
                )
                : null}
            </>
          )}
      </footer>
    </section>
  );
}

const TONES = {
  received: "warning",
  applied: "good",
  denied: "critical",
  cancelled: "neutral",
} as const;

function markLabel(result: ApprovalResultView): string {
  switch (result.outcome) {
    case "received":
      return t("conversation.label.approval-received");
    case "applied":
      return t("conversation.label.approval-applied");
    case "denied":
      return t("conversation.label.approval-denied");
    case "cancelled":
      return t("conversation.label.approval-cancelled");
  }
}

function scopeLabel(choice: RequestChoice | null): string | null {
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
 * 결정 뒤 대화에 남는 한 줄. 허락을 접수한 것과 적용된 것, 거절, 일이 끝나 취소된 것(거절이 아니다)을
 * 구별한다. 만료는 없다.
 */
export function ApprovalResult(
  { result }: { result: ApprovalResultView },
): ReactElement {
  const { subject } = subjectOf(result.intent);
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
  ].filter((part): part is string => part !== null).join(" · ");
  return (
    <div className={styles.result}>
      <StatusMark tone={TONES[result.outcome]} label={markLabel(result)} />
      <span className={styles.resultTitle}>{subject}</span>
      {detail === ""
        ? null
        : <span className={styles.resultDetail}>{detail}</span>}
    </div>
  );
}
