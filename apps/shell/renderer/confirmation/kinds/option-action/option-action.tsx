import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ConfirmationLayout } from "../../layout/layout.tsx";
import { ExactAction, facts, type KindProps, obj, str } from "../exact.tsx";

export const ANSWER_ACTION = "AnswerQuestionAction";

/**
 * 고정 동작이 있는 선택지. 고르기 전에 맡은 concern·command·대상·정확한 입력·비교 기준을
 * 그대로 보인다. 고르면 질문의 답이 접수되고 동작은 lophn이 그 답으로 따로 적용한다.
 */
export function OptionActionKind({ view, decide, cancel, busy }: KindProps) {
  const shown = obj(view.view);
  const label = str(shown.label) ?? "";
  const display: Display = {
    title: t("confirmation-window.option-action.title", { option: label }),
    subject: str(shown.description) ?? label,
    effect: t("confirmation-window.option-action.effect"),
    reversible: null,
    action: t("confirmation-window.button.choose"),
    details: facts([
      [t("confirmation-window.label.question"), str(shown.prompt)],
      [t("confirmation-window.label.reason"), str(shown.reason)],
      [
        t("confirmation-window.label.recommended"),
        shown.recommended === true
          ? t("confirmation-window.label.yes")
          : undefined,
      ],
      [t("confirmation-window.label.expires"), str(shown.expires_at)],
    ]),
    noChange: true,
  };
  return (
    <ConfirmationLayout
      display={display}
      exact={<ExactAction view={shown} />}
      actions={
        <>
          <Button variant="ghost" data-action="cancel" onClick={cancel}>
            {t("confirmation-window.button.cancel")}
          </Button>
          {(view.decisions ?? []).includes(ANSWER_ACTION)
            ? (
              <Button
                variant="primary"
                data-decision={ANSWER_ACTION}
                disabled={busy}
                onClick={() => decide(ANSWER_ACTION)}
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
