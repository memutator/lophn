import { X } from "lucide-react";
import { t } from "@lophn/wording";
import { Button } from "../button/button.tsx";
import { IconButton } from "../icon-button/icon-button.tsx";
import styles from "./chip.module.css";

export interface ChipItem {
  id: string;
  // 기다리는 질문의 owner 문구. React text로만 그린다.
  title: string;
}

export interface ChipProps {
  items: readonly ChipItem[];
  onView: (id: string) => void;
  onDismiss: (id: string) => void;
}

// 사람의 답을 기다리는 안내는 하나만 보이고 나머지는 개수로 붙인다. timer가 없어 저절로 사라지지 않는다.
export function Chip({ items, onView, onDismiss }: ChipProps) {
  const [first] = items;
  if (!first) return null;
  const rest = items.length - 1;
  return (
    <div className={styles.chip}>
      <p className={styles.title}>{first.title}</p>
      {rest > 0 && (
        <span className={styles.more}>
          {t("common.label.more-waiting", { count: rest })}
        </span>
      )}
      <Button size="sm" onClick={() => onView(first.id)}>
        {t("common.button.view")}
      </Button>
      <IconButton
        icon={X}
        label={t("common.button.close")}
        size="sm"
        onClick={() => onDismiss(first.id)}
      />
    </div>
  );
}
