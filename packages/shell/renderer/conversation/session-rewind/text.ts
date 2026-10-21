// 되돌리기 화면의 고정 글. 이유는 글이 아니라 고정 코드(protocol rewindReasonSchema)라 코드로 문장을 고른다.
// rewind panel과 숨긴 구간 줄이 같은 문장을 쓴다. 모르는 코드는 문장을 지어내지 않고 null이다.
import { t } from "@lophn/wording";

import type { RewindResultView } from "../agent-tab-source.ts";

/** 이유 코드의 문장. 모르는 코드면 null이다. */
export function reasonText(code: string | null): string | null {
  switch (code) {
    case "edited_outside":
      return t("conversation.rewind-why.edited-outside");
    case "chain_broken":
      return t("conversation.rewind-why.chain-broken");
    case "no_pre_image":
      return t("conversation.rewind-why.no-pre-image");
    case "link_path":
      return t("conversation.rewind-why.link-path");
    case "rename_blocked":
      return t("conversation.rewind-why.rename-blocked");
    case "created_edited":
      return t("conversation.rewind-why.created-edited");
    case "external_effect":
      return t("conversation.rewind-why.external-effect");
    case "already_reverted":
      return t("conversation.rewind-why.already-reverted");
    case "answered_fact":
      return t("conversation.rewind-why.answered-fact");
    case "later_edit":
      return t("conversation.rewind-why.later-edit");
    case "unknown":
      return t("conversation.rewind-why.unknown");
    default:
      return null;
  }
}

/** 항목의 이름: 파일은 경로, 남는 사실은 종류의 말이다(안쪽 ID는 보이지 않는다). */
export function itemLabel(
  item: Pick<RewindResultView, "kind" | "target">,
): string {
  if (item.kind === "file") return item.target;
  switch (item.target) {
    case "external_request":
      return t("conversation.label.rewind-item-external");
    case "answered_question":
      return t("conversation.label.rewind-item-answer");
    default:
      return t("conversation.label.rewind-item-fact");
  }
}
