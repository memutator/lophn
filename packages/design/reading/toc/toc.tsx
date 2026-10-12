import { t } from "@lophn/wording";
import { Field, Select, useTocPlacement } from "../../components/mod.ts";
import type { OutlineItem } from "../markdown/model.ts";
import styles from "../reading.module.css";

// 3단까지만 목차에 둔다. 더 깊은 제목은 본문에서 읽는다.
export const TOC_MAX_LEVEL = 3;

export interface TocProps {
  items: readonly OutlineItem[];
  activeId?: string;
  onSelect: (id: string) => void;
}

// ReadingFrame이 칸 폭으로 정한 자리에 따라 옆 목록이나 머리 선택으로 그린다.
export function Toc({ items, activeId, onSelect }: TocProps) {
  const placement = useTocPlacement();
  const shown = items.filter((item) => item.level <= TOC_MAX_LEVEL);
  const label = t("common.label.on-this-page");
  if (placement === "head") {
    return (
      <div data-placement="head">
        <Field label={label}>
          <Select
            size="sm"
            options={shown.map((item) => ({
              value: item.id,
              label: item.title,
            }))}
            value={activeId}
            onValueChange={onSelect}
          />
        </Field>
      </div>
    );
  }
  return (
    <nav className={styles.toc} aria-label={label} data-placement="side">
      <p className={styles.tocTitle}>{label}</p>
      <ul className={styles.tocList}>
        {shown.map((item) => (
          <li key={item.id} className={styles.tocItem} data-level={item.level}>
            <button
              type="button"
              className={styles.tocButton}
              aria-current={item.id === activeId ? "location" : undefined}
              onClick={() =>
                onSelect(item.id)}
            >
              {item.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
