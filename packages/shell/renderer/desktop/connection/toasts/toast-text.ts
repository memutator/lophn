// 반응(Reaction)의 문구 key를 화면 글로 바꾼다. 문구는 wording key로만 만든다.
import { t } from "@lophn/wording";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { Reaction } from "../events/reactions.ts";
import { agentLabel, shortId } from "../waiting/model.ts";

interface ToastText {
  readonly title: string;
  readonly body: string;
  /** 반응이 행동을 갖지 않으면 없다. */
  readonly action?: string;
}

/** agentOf는 session을 연 agent를 찾는다. 모르면 lophn으로 읽는다. */
export function toastText(
  reaction: Reaction,
  agentOf: (session: string) => CallAgent | null,
): ToastText {
  const p = reaction.params;
  const agent = () => {
    const found = agentOf(p.session ?? "");
    return found ? agentLabel(found) : t("waiting.label.agent-lophn");
  };
  const text = (title: string, body: string, action: string): ToastText => ({
    title,
    body,
    action: reaction.action ? action : undefined,
  });
  switch (reaction.titleKey) {
    case "waiting.toast-permission.title":
      return text(
        t("waiting.toast-permission.title", { agent: agent() }),
        t("waiting.toast-permission.body"),
        t("waiting.toast-permission.button"),
      );
    case "waiting.toast-activation.title":
      return text(
        t("waiting.toast-activation.title", {
          app: t("waiting.label.place-app", { id: shortId(p.app) }),
        }),
        t("waiting.toast-activation.body"),
        t("waiting.toast-activation.button"),
      );
    case "waiting.toast-question.title":
      return text(
        t("waiting.toast-question.title", { agent: agent() }),
        t("waiting.toast-question.body"),
        t("waiting.toast-question.button"),
      );
    case "waiting.toast-restart-halted.title":
      return text(
        t("waiting.toast-restart-halted.title"),
        t("waiting.toast-restart-halted.body", {
          app: t("waiting.label.place-app", { id: shortId(p.app) }),
        }),
        t("waiting.toast-restart-halted.button"),
      );
    case "waiting.toast-kind-violation.title":
      return {
        title: t("waiting.toast-kind-violation.title"),
        body: t("waiting.toast-kind-violation.body", {
          count: Number(p.count),
        }),
      };
    default:
      throw new Error(`unknown toast ${reaction.titleKey}`);
  }
}
