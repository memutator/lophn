import { type ReactNode, useState } from "react";
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
export function ApprovalKind(props: KindProps) {
  const shown = obj(props.view.view);
  const display: Display = {
    title: t("confirmation-window.approval.title"),
    subject: str(shown.changes) ?? t("confirmation-window.change.missing"),
    effect: str(shown.external) ??
      t("confirmation-window.approval.no-external"),
    reversible: shown.reversible === true,
    revertNote: str(shown.reversibility),
    action: t("confirmation-window.button.allow-once"),
    details: facts([
      [t("confirmation-window.label.requested-by"), str(shown.requester)],
      [t("confirmation-window.label.reason"), str(shown.reason)],
      [t("confirmation-window.label.expires"), str(shown.expires_at)],
    ]),
    noChange: true,
  };
  return (
    <ApprovalDecision
      {...props}
      display={display}
      exact={<ExactAction view={shown} />}
    />
  );
}

/**
 * approval request의 결정 틀. 앱 결정 네 종류도 같은 허락·거절·취소와 같은 이유 입력을 쓴다.
 * 종류마다 다른 것은 표시(display)와 정확한 동작 자리(exact)뿐이다.
 *
 * session 허락이 되는 request(view.session_grantable)는 Allow once와 Allow for this session을
 * 따로 고르고, 대화 카드가 미리 고른 결정(view.preselect)은 눈에 띄게(primary) 보일 뿐 누르기 전에는
 * 제출하지 않는다. 계속 허락(Always)은 없다. once는 기본값이라 입력에 싣지 않는다.
 */
export function ApprovalDecision(
  { view, decide, cancel, busy, display, exact }: KindProps & {
    display: Display;
    exact: ReactNode;
  },
) {
  const decisions = view.decisions ?? [];
  const shown = obj(view.view);
  const sessionGrantable = shown.session_grantable === true;
  const preselect = str(shown.preselect);
  const [reason, setReason] = useState("");
  const withReason = () => reason.trim() === "" ? {} : { input: { reason } };
  return (
    <ConfirmationLayout
      display={display}
      exact={exact}
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
                variant={preselect === "deny" ? "primary" : "secondary"}
                data-decision={REJECT}
                data-preselected={preselect === "deny" ? "true" : undefined}
                disabled={busy}
                onClick={() => decide(REJECT, withReason())}
              >
                {t("confirmation-window.button.reject")}
              </Button>
            )
            : null}
          {decisions.includes(GRANT) && sessionGrantable
            ? (
              <Button
                variant={preselect === "allow_session"
                  ? "primary"
                  : "secondary"}
                data-decision={GRANT}
                data-scope="session"
                data-preselected={preselect === "allow_session"
                  ? "true"
                  : undefined}
                disabled={busy}
                onClick={() => decide(GRANT, { input: { scope: "session" } })}
              >
                {t("confirmation-window.button.allow-session")}
              </Button>
            )
            : null}
          {decisions.includes(GRANT)
            ? (
              <Button
                variant={preselect === undefined || preselect === "allow_once"
                  ? "primary"
                  : "secondary"}
                data-decision={GRANT}
                data-scope="once"
                data-preselected={preselect === "allow_once"
                  ? "true"
                  : undefined}
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
