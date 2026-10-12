// 되돌리기 화면의 고정 글. 이유는 글이 아니라 고정 코드(contracts revertReasonSchema)라 코드로 문장을 고른다.
// rewind menu(대화)와 확인 창이 같은 문장을 쓴다. 모르는 코드는 문장을 지어내지 않고 null이다.
import { t } from "@lophn/wording";

import type { RewindBlock, RewindItemView } from "../agent-source.ts";

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
    case "no_receipt":
      return t("conversation.rewind-why.no-receipt");
    case "no_revert_command":
      return t("conversation.rewind-why.no-revert-command");
    case "app_revision_changed":
      return t("conversation.rewind-why.app-revision-changed");
    case "external_effect":
      return t("conversation.rewind-why.external-effect");
    case "already_reverted":
      return t("conversation.rewind-why.already-reverted");
    case "answered_fact":
      return t("conversation.rewind-why.answered-fact");
    case "app_failed":
      return t("conversation.rewind-why.app-failed");
    case "app_uncertain":
      return t("conversation.rewind-why.app-uncertain");
    case "app_not_started":
      return t("conversation.rewind-why.app-not-started");
    case "app_not_settled":
      return t("conversation.rewind-why.app-not-settled");
    case "later_edit":
      return t("conversation.rewind-why.later-edit");
    case "unknown":
      return t("conversation.rewind-why.unknown");
    default:
      return null;
  }
}

/** 항목의 이름: 파일은 경로, 앱 변경과 남는 사실은 종류의 말이다(안쪽 ID는 보이지 않는다). */
export function itemLabel(
  item: Pick<RewindItemView, "kind" | "target">,
): string {
  if (item.kind === "file") return item.target;
  if (item.kind === "app") return t("conversation.label.rewind-item-app");
  switch (item.target) {
    case "external_request":
      return t("conversation.label.rewind-item-external");
    case "answered_question":
      return t("conversation.label.rewind-item-answer");
    case "approval_decision":
      return t("conversation.label.rewind-item-approval");
    default:
      return t("conversation.label.rewind-item-fact");
  }
}

/** 선택지를 고르지 못하는 이유의 문장. */
export function blockText(block: RewindBlock): string {
  switch (block) {
    case "correction":
      return t("conversation.rewind-block.correction");
    case "copied":
      return t("conversation.rewind-block.copied");
    case "limit_total":
      return t("conversation.rewind-block.limit-total");
    case "limit_file":
      return t("conversation.rewind-block.limit-file");
    case "limit_count":
      return t("conversation.rewind-block.limit-count");
    case "record_failed":
      return t("conversation.rewind-block.record-failed");
  }
}
