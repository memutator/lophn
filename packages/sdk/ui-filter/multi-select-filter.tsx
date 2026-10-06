import { useState } from "react";
import { ListFilter } from "lucide-react";
import { t } from "@lophn/wording";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Popover,
} from "@lophn/design/components";
import styles from "./filter.module.css";

export interface FilterOption {
  value: string;
  // 사람이 읽는 이름. 앱 catalog의 문구다.
  label: string;
}

// 고를 것이 이보다 많으면 목록 위에 검색 칸을 둔다.
export const SEARCH_AFTER = 6;

// 여는 버튼에 보이는 고른 것. 아무것도 안 골랐거나 모두 골랐으면 전체다.
export function selectionLabel(
  dimension: string,
  selected: readonly string[],
  options: readonly FilterOption[],
): string {
  if (selected.length === 0 || selected.length === options.length) {
    return t("common.label.all-of", { dimension });
  }
  const first = options.find((option) => option.value === selected[0])
    ?.label ?? selected[0];
  if (selected.length === 1) return first;
  return t("common.label.first-and-more", {
    first,
    count: selected.length - 1,
  });
}

export interface MultiSelectFilterProps {
  // 무엇을 고르는지의 사람 말 이름(복수). 예: "statuses".
  dimension: string;
  options: readonly FilterOption[];
  // 고른 값. 비어 있으면 전체다. 바꾼 값은 options 순서로 돌려준다.
  value: readonly string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  defaultOpen?: boolean;
}

// 여러 값 고르기. 체크박스 목록과 [Select all]·[Clear], 많으면 검색 칸이다.
export function MultiSelectFilter(
  {
    dimension,
    options,
    value,
    onChange,
    searchable = options.length > SEARCH_AFTER,
    defaultOpen,
  }: MultiSelectFilterProps,
) {
  const [query, setQuery] = useState("");
  const chosen = new Set(value);
  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) =>
    option.label.toLowerCase().includes(needle)
  );
  const toggle = (item: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(item);
    else next.delete(item);
    onChange(
      options.map((option) => option.value).filter((item) => next.has(item)),
    );
  };
  return (
    <Popover
      defaultOpen={defaultOpen}
      onOpenChange={(open) => open && setQuery("")}
      trigger={
        <Button size="sm" icon={ListFilter} data-filter="multi-select">
          {selectionLabel(dimension, value, options)}
        </Button>
      }
    >
      <div className={styles.panel}>
        {searchable && (
          <div className={styles.search}>
            <Field label={t("common.label.search")}>
              <Input
                size="sm"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </Field>
          </div>
        )}
        <div className={styles.options}>
          {shown.length === 0
            ? <p className={styles.none}>{t("common.palette.no-results")}</p>
            : shown.map((option) => (
              <Checkbox
                key={option.value}
                label={option.label}
                checked={chosen.has(option.value)}
                onCheckedChange={(on) => toggle(option.value, on)}
              />
            ))}
        </div>
        <div className={styles.footer}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(options.map((option) => option.value))}
          >
            {t("common.button.select-all")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={value.length === 0}
            onClick={() => onChange([])}
          >
            {t("common.button.clear")}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
