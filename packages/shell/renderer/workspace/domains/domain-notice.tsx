// 보관한 뒤의 되돌리기와 보관이 거절된 이유. 목록 위쪽 toast 하나로 보인다.
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { DomainNotice as Notice } from "./use-domains.ts";

export function DomainNotice({
  notice,
  onUndo,
  onClose,
}: {
  notice: Notice;
  onUndo: () => void;
  onClose: () => void;
}) {
  return notice.kind === "archived" ? (
    <Toast
      title={t("domain.notice.archived", { title: notice.domain.title })}
      actions={[{ id: "undo", label: t("domain.button.undo") }]}
      onAction={onUndo}
      onClose={onClose}
    />
  ) : (
    <Toast
      tone="error"
      title={t("domain.error.archive-refused", {
        title: notice.domain.title,
      })}
      body={notice.reason}
      onClose={onClose}
    />
  );
}
