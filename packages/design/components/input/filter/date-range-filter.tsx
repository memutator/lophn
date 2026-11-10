import { useState } from "react";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { formatDate, type MessageKey, t } from "@lophn/i18n";
import { Button } from "../../primitives/button/button.tsx";
import { Icon } from "../../primitives/icon/icon.tsx";
import { Popover, PopoverRow } from "../../overlay/popover/popover.tsx";
import { componentMark, iconPixels } from "../../_shared/shared.ts";
import { Calendar } from "../calendar/calendar.tsx";
import {
  type DateRange,
  parseDay,
  RANGE_PRESETS,
  type RangePreset,
} from "./range.ts";
import styles from "./filter.module.css";

const PRESET_LABELS = {
  today: "common.label.range-today",
  "last-7-days": "common.label.range-last-7-days",
  "last-30-days": "common.label.range-last-30-days",
  "last-90-days": "common.label.range-last-90-days",
  "this-month": "common.label.range-this-month",
} as const satisfies Record<RangePreset, MessageKey>;

// 여는 버튼에 보이는 기간 이름. 직접 기간은 Intl 날짜로 양 끝을 보이고 해가 다를 때만 해를 붙인다.
export function rangeLabel(range: DateRange, locale = "en"): string {
  if (range.preset !== "custom") return t(PRESET_LABELS[range.preset]);
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  if (!from || !to) return t("common.label.range-custom");
  const [start, end] = from <= to ? [from, to] : [to, from];
  const options: Intl.DateTimeFormatOptions =
    start.getFullYear() === end.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return t("common.label.value-range", {
    start: formatDate(start, locale, options),
    end: formatDate(end, locale, options),
  });
}

export interface DateRangeFilterProps {
  // 고른 기간. null은 기간으로 거르지 않는 상태이고 버튼에 "Any time"이 보인다.
  value: DateRange | null;
  onChange: (next: DateRange) => void;
  // 달력의 오늘 표시와 처음 보이는 달. 앱의 clock에서 받는다.
  now: Date;
  locale?: string;
  defaultOpen?: boolean;
}

// 기간 고르기. 왼쪽은 정한 기간 줄, 오른쪽은 직접 기간 달력이다. 달력은 첫 누름이 한쪽 끝, 둘째 누름이 다른 끝이고
// 둘째에 고르고 닫힌다(DateRangePicker와 같다).
export function DateRangeFilter({
  value,
  onChange,
  now,
  locale = "en",
  defaultOpen = false,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const choose = (next: DateRange) => {
    onChange(next);
    setOpen(false);
  };
  const pick = (day: string) => {
    if (anchor === undefined) {
      setAnchor(day);
      return;
    }
    setAnchor(undefined);
    choose(
      anchor <= day
        ? { preset: "custom", from: anchor, to: day }
        : { preset: "custom", from: day, to: anchor },
    );
  };
  const custom =
    value?.preset === "custom" && parseDay(value.from) && parseDay(value.to)
      ? { from: value.from, to: value.to }
      : undefined;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setAnchor(undefined);
      }}
      trigger={
        <Button size="sm" icon={CalendarIcon} data-filter="date-range">
          {value === null
            ? t("common.label.range-any")
            : rangeLabel(value, locale)}
        </Button>
      }
    >
      <div className={styles.rangePanel} {...componentMark("DateRangeFilter")}>
        <div className={styles.presets}>
          {RANGE_PRESETS.map((preset) => (
            <PopoverRow key={preset} onSelect={() => choose({ preset })}>
              <span className={styles.rowLabel} data-preset={preset}>
                {t(PRESET_LABELS[preset])}
              </span>
              {value?.preset === preset && (
                <Icon icon={Check} pixels={iconPixels("base")} />
              )}
            </PopoverRow>
          ))}
        </div>
        <div className={styles.custom} data-range-custom="">
          <p className={styles.customTitle}>
            {t(
              anchor === undefined
                ? "common.label.range-custom"
                : "common.label.range-pick-end",
            )}
          </p>
          <Calendar
            selected={anchor ?? custom}
            now={now}
            locale={locale}
            onPick={pick}
          />
        </div>
      </div>
    </Popover>
  );
}
