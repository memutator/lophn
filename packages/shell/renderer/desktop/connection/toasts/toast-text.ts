// 반응(Reaction)의 문구 key를 화면 글로 바꾼다. 문구는 message key로만 만든다.
import { t } from "@lophn/i18n";
import type { Reaction } from "../events/reactions.ts";

interface ToastText {
  readonly title: string;
  readonly body: string;
  /** 반응이 행동을 갖지 않으면 없다. */
  readonly action?: string;
}

export function toastText(reaction: Reaction): ToastText {
  const p = reaction.params;
  const text = (title: string, body: string, action: string): ToastText => ({
    title,
    body,
    action: reaction.action ? action : undefined,
  });
  switch (reaction.titleKey) {
    case "waiting.toast-activation.title":
      return text(
        t("waiting.toast-activation.title", { app: p.app }),
        t("waiting.toast-activation.body"),
        t("waiting.toast-activation.button"),
      );
    case "waiting.toast-share.title":
      return text(
        t("waiting.toast-share.title", { app: p.app }),
        t("waiting.toast-share.body"),
        t("waiting.toast-share.button"),
      );
    case "waiting.toast-restart-halted.title":
      return text(
        t("waiting.toast-restart-halted.title"),
        t("waiting.toast-restart-halted.body", { app: p.app }),
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
