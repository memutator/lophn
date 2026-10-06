import { useState } from "react";
import { t } from "@lophn/wording";
import { Button, Field, Input } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ConfirmationLayout } from "../../layout/layout.tsx";
import { type KindProps, obj, str } from "../exact.tsx";

/**
 * secret 보호 입력. 값은 이 칸에서 main으로 한 번 가고 화면 상태에 남기지 않는다(보내기 전에
 * 칸을 비운다). 결과는 안전 이름과 저장 결과만 돌아온다. OAuth code·최종 주소 붙여넣기도
 * 같은 칸이다.
 */
export function SecretInputKind({ view, decide, cancel, busy }: KindProps) {
  const shown = obj(view.view);
  const name = str(shown.name) ?? "";
  const entry = str(shown.entry);
  const decision = (view.decisions ?? [])[0];
  const configured = shown.configured === true;
  const [value, setValue] = useState("");
  const display: Display = {
    title: entry === "code"
      ? t("confirmation-window.secret-code.title")
      : entry === "key"
      ? t("confirmation-window.secret-key.title", { name })
      : t("confirmation-window.secret-app.title", { name }),
    subject: t("confirmation-window.secret.subject"),
    path: name === "" ? undefined : name,
    effect: configured
      ? t("confirmation-window.secret.configured", { name })
      : t("confirmation-window.secret.effect"),
    reversible: true,
    revertNote: t("confirmation-window.secret.revert"),
    action: t("confirmation-window.button.save"),
    details: [],
    noChange: true,
  };
  const label = entry === "code"
    ? t("confirmation-window.label.secret-code")
    : entry === "key"
    ? t("confirmation-window.label.secret-key")
    : t("confirmation-window.label.secret-value");
  const send = () => {
    if (decision === undefined || value === "") return;
    const sent = value;
    // 보내기 전에 칸을 비운다. 값은 이 호출의 인자로만 main에 간다.
    setValue("");
    decide(decision, { input: { value: sent } });
  };
  return (
    <ConfirmationLayout
      display={display}
      input={decision === undefined ? null : (
        <Field label={label}>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-secret="input"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </Field>
      )}
      actions={
        <>
          <Button variant="ghost" data-action="cancel" onClick={cancel}>
            {t("confirmation-window.button.cancel")}
          </Button>
          {decision === undefined ? null : (
            <Button
              variant="primary"
              data-decision={decision}
              disabled={busy || value === ""}
              onClick={send}
            >
              {display.action}
            </Button>
          )}
        </>
      }
    />
  );
}
