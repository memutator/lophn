import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ConfirmationLayout } from "../../layout/layout.tsx";
import { facts, type KindProps, obj, str } from "../exact.tsx";

/** 확인 창이 허용하는 결정 이름(contracts의 CODING_AGENT_CONNECTION_REVOKE). 누르면 main이 `RevokeCodingAgentConnection`을 연결·판에 묶은 handle로 보낸다. */
export const CONNECTION_REVOKE = "coding_agent_connection_revoke";

/**
 * coding agent 연결 회수의 owner decision 화면. main이 `ShowCodingAgentConnection`을 독립해 다시 읽어 만든 view는
 * `{ kind: "connection_revoke", label, scope, app, app_name, revoked }`다. 연결 이름과 범위를 정확히 보이고
 * 회수는 lophn 접근만 끊는다고 말한다(이미 떠 있는 외부 프로세스·OS 파일 편집을 멈춘다고 하지 않는다).
 */
export function ConnectionRevokeKind(
  { view, decide, cancel, busy }: KindProps,
) {
  const shown = obj(view.view);
  const label = str(shown.label);
  if (label === undefined) {
    return (
      <p data-change="missing">{t("confirmation-window.change.missing")}</p>
    );
  }
  const revoked = shown.revoked === true;
  const scope = shown.scope === "app"
    ? t("confirmation-window.label.connection-app", {
      name: str(shown.app_name) ?? str(shown.app) ?? "",
    })
    : t("confirmation-window.label.connection-all");
  const display: Display = {
    title: t("confirmation-window.title.connection-revoke"),
    subject: label,
    effect: revoked
      ? t("confirmation-window.connection.already-revoked")
      : t("confirmation-window.connection.effect-revoke"),
    reversible: false,
    revertNote: t("confirmation-window.connection.note-revoke"),
    noteOnly: true,
    action: t("confirmation-window.button.connection-revoke"),
    details: facts([
      [t("confirmation-window.label.connection-scope"), scope],
      [t("confirmation-window.label.exact-request"), str(shown.connection)],
    ]),
    noChange: true,
  };
  return (
    <ConfirmationLayout
      display={display}
      actions={
        <>
          <Button variant="ghost" data-action="cancel" onClick={cancel}>
            {t("confirmation-window.button.cancel")}
          </Button>
          {(view.decisions ?? []).includes(CONNECTION_REVOKE)
            ? (
              <Button
                variant="danger"
                data-decision={CONNECTION_REVOKE}
                disabled={busy}
                onClick={() => decide(CONNECTION_REVOKE)}
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
