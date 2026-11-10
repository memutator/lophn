import { type ReactNode, useState } from "react";
import { Check, ListFilter } from "lucide-react";
import { t } from "@lophn/i18n";
import { Button } from "../../primitives/button/button.tsx";
import { Icon } from "../../primitives/icon/icon.tsx";
import { Field } from "../field/field.tsx";
import { Input } from "../input/input.tsx";
import { Popover, PopoverRow } from "../../overlay/popover/popover.tsx";
import { componentMark, iconPixels } from "../../_shared/shared.ts";
import { SEARCH_AFTER } from "./multi-select-filter.tsx";
import styles from "./filter.module.css";

export interface SelectFilterOption {
  value: string;
  // 사람이 읽는 이름. 앱 catalog의 문구다.
  label: string;
  // 이름 앞의 표식(앱 icon 같은). 고르면 여는 버튼에도 보인다.
  icon?: ReactNode;
}

export interface SelectFilterProps {
  // 아무것도 거르지 않을 때 버튼과 첫 줄에 보이는 이름. 예: "All apps".
  allLabel: string;
  options: readonly SelectFilterOption[];
  // 고른 값. null은 전체다.
  value: string | null;
  onChange: (next: string | null) => void;
  searchable?: boolean;
  defaultOpen?: boolean;
}

// 하나만 고르는 필터. 첫 줄이 전체이고 고르면 닫힌다. 많으면 목록 위에 검색 칸을 둔다.
export function SelectFilter({
  allLabel,
  options,
  value,
  onChange,
  searchable = options.length > SEARCH_AFTER,
  defaultOpen = false,
}: SelectFilterProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const chosen = options.find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) =>
    option.label.toLowerCase().includes(needle),
  );
  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  const mark = (on: boolean) =>
    on ? <Icon icon={Check} pixels={iconPixels("base")} /> : null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
      trigger={
        <Button
          size="sm"
          icon={chosen?.icon === undefined ? ListFilter : undefined}
          data-filter="select"
        >
          {chosen?.icon}
          {chosen?.label ?? allLabel}
        </Button>
      }
    >
      <div className={styles.panel} {...componentMark("SelectFilter")}>
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
        {needle === "" && (
          <PopoverRow onSelect={() => choose(null)}>
            <span className={styles.rowLabel} data-option="">
              {allLabel}
            </span>
            {mark(value === null)}
          </PopoverRow>
        )}
        {shown.length === 0 ? (
          <p className={styles.none}>{t("common.palette.no-results")}</p>
        ) : (
          shown.map((option) => (
            <PopoverRow
              key={option.value}
              onSelect={() => choose(option.value)}
            >
              {option.icon}
              <span className={styles.rowLabel} data-option={option.value}>
                {option.label}
              </span>
              {mark(option.value === value)}
            </PopoverRow>
          ))
        )}
      </div>
    </Popover>
  );
}
