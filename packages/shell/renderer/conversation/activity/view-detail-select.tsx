import type { ReactElement } from "react";
import { Field, Select } from "@lophn/ui/input";
import { type MessageKey, t } from "@lophn/wording";

import type { ViewDetail } from "./model.ts";
import styles from "./activity.module.css";

interface ViewDetailSelectProps {
  value: ViewDetail;
  onChange: (value: ViewDetail) => void;
}

const OPTIONS: readonly { value: ViewDetail; label: MessageKey }[] = [
  { value: "messages", label: "conversation.label.view-messages" },
  { value: "compact", label: "conversation.label.view-compact" },
  { value: "everything", label: "conversation.label.view-everything" },
];

// header의 보기 상세 select. Messages·Compact·Everything을 이 순서로 고른다.
// Select는 Field label이 필요하다. header에서는 label을 눈에서만 감추고 이름으로 남긴다.
// 고른 값은 tool 줄의 detail만 바꾸고 메시지와 카드는 그대로다.
export function ViewDetailSelect(
  { value, onChange }: ViewDetailSelectProps,
): ReactElement {
  return (
    <span className={styles.viewDetail} data-view-detail-select="">
      <Field label={t("conversation.label.view-detail")}>
        <Select
          options={OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.label),
          }))}
          value={value}
          size="sm"
          onValueChange={(next) => onChange(next as ViewDetail)}
        />
      </Field>
    </span>
  );
}
