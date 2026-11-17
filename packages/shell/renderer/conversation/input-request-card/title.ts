// 입력 요청 card의 제목. DOM이 없어 폰의 card도 import한다.
import { t } from "@lophn/i18n";
import type { InputRequestView } from "../../../../protocol/lophn-agent/input-request.ts";

/** secret은 값이 가는 곳(앱, MCP, provider), login은 방식, sign_in은 그 대상으로 말한다. */
export function inputRequestTitle(
  view: InputRequestView,
  agent: string,
): string {
  if (view.kind === "login") {
    return t(`conversation.title.input-request-${view.mode}`, { agent });
  }
  if (view.kind === "sign_in") {
    return t("conversation.title.input-request-sign-in", {
      agent,
      subject: view.subject,
    });
  }
  return t(
    "app" in view.slot
      ? "conversation.title.input-request-app"
      : "mcp" in view.slot
        ? "conversation.title.input-request-mcp"
        : "conversation.title.input-request-provider",
    { agent, subject: view.subject },
  );
}
