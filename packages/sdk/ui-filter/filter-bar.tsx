import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { t } from "@lophn/wording";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { componentMark } from "@lophn/ui/shared";
import styles from "./filter.module.css";

export interface SearchFilterProps {
  value: string;
  onChange: (next: string) => void;
  // 보이는 라벨. 없으면 "Search"다.
  label?: string;
}

// 글 검색 칸. 언제 read command를 부를지는 앱이 정한다.
export function SearchFilter({ value, onChange, label }: SearchFilterProps) {
  return (
    <div
      className={styles.search}
      data-filter="search"
      {...componentMark("SearchFilter")}
    >
      <Field label={label ?? t("common.label.search")}>
        <Input
          size="sm"
          type="search"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </Field>
    </div>
  );
}

export interface FilterBarProps {
  // 기간을 먼저, 그다음 다중 선택과 검색을 둔다.
  children: ReactNode;
  // 기본값과 다르면 [Reset filters]를 보인다.
  dirty?: boolean;
  onReset?: () => void;
}

// 그 결과 위에 놓는 한 줄. 칸이 좁으면 다음 줄로 넘긴다.
export function FilterBar(
  { children, dirty = false, onReset }: FilterBarProps,
) {
  return (
    <div className={styles.bar} role="group" {...componentMark("FilterBar")}>
      {children}
      {dirty && onReset && (
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReset}>
          {t("common.button.reset-filters")}
        </Button>
      )}
    </div>
  );
}
