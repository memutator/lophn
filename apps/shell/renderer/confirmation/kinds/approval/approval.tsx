import { useState } from "react";
import { t } from "@lophn/wording";
import { Button, Field, Textarea } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ConfirmationLayout } from "../../layout/layout.tsx";
import { ExactAction, facts, type KindProps, obj, str } from "../exact.tsx";

export const GRANT = "grant_approval_request";
export const REJECT = "reject_approval_request";
export const CANCEL_REQUEST = "cancel_approval_request";

/**
 * approval request. 제목이 결정을 묻고, 바뀌는 것·정확한 동작·영향·되돌릴 범위를 고르기 전에
 * 보인다. 허락·거절·대기 요청의 명시 취소는 각각 다른 버튼이고, 닫기는 결정이 아니다.
 * 거절·취소 이유는 선택 입력이다.
 */
export function ApprovalKind({ view, decide, cancel, busy }: KindProps) {
  const shown = obj(view.view);
  const decisions = view.decisions ?? [];
  const [reason, setReason] = useState("");
  const withReason = () =>
    reason.trim() === "" ? {} : { input: { reason } };
  const display: Display = {
    title: t("confirmation-window.approval.title"),
    subject: str(shown.changes) ?? t("confirmation-window.change.missing"),
    effect: str(shown.external) ??
      t("confirmation-window.approval.no-external"),
    reversible: shown.reversible === true,
    revertNote: str(shown.reversibility),
    action: t("confirmation-window.button.allow"),
    details: facts([
      [t("confirmation-window.label.requested-by"), str(shown.requester)],
      [t("confirmation-window.label.reason"), str(shown.reason)],
      [t("confirmation-window.label.expires"), str(shown.expires_at)],
    ]),
    noChange: true,
  };
  return (
    <ConfirmationLayout
      display={display}
      exact={<ExactAction view={shown} />}
      input={decisions.includes(REJECT) || decisions.includes(CANCEL_REQUEST)
        ? (
          <Field label={t("confirmation-window.label.close-reason")}>
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </Field>
        )
        : null}
      actions={
        <>
          <Button variant="ghost" data-action="cancel" onClick={cancel}>
            {t("confirmation-window.button.close")}
          </Button>
          {decisions.includes(CANCEL_REQUEST)
            ? (
              <Button
                variant="secondary"
                data-decision={CANCEL_REQUEST}
                disabled={busy}
                onClick={() => decide(CANCEL_REQUEST, withReason())}
              >
                {t("confirmation-window.button.cancel-request")}
              </Button>
            )
            : null}
          {decisions.includes(REJECT)
            ? (
              <Button
                variant="secondary"
                data-decision={REJECT}
                disabled={busy}
                onClick={() => decide(REJECT, withReason())}
              >
                {t("confirmation-window.button.reject")}
              </Button>
            )
            : null}
          {decisions.includes(GRANT)
            ? (
              <Button
                variant="primary"
                data-decision={GRANT}
                disabled={busy}
                onClick={() => decide(GRANT)}
              >
                {display.action}
              </Button>
            )
            : null}
        </>
      }
    />
  );
}
