import { useState } from "react";
import { Calendar, Check } from "lucide-react";
import { formatDate, type MessageKey, t } from "@lophn/wording";
import { Button } from "../../primitives/button/button.tsx";
import { Icon } from "../../primitives/icon/icon.tsx";
import { Field } from "../field/field.tsx";
import { Input } from "../input/input.tsx";
import { Popover, PopoverRow } from "../../overlay/popover/popover.tsx";
import { componentMark, iconPixels } from "../../_shared/shared.ts";
import {
  type DateRange,
  parseDay,
  RANGE_PRESETS,
  type RangePreset,
  resolveRange,
} from "./range.ts";
import styles from "./filter.module.css";

const PRESET_LABELS = {
  "today": "common.label.range-today",
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
  value: DateRange;
  onChange: (next: DateRange) => void;
  // 직접 기간 칸의 처음 값을 정하는 지금. 앱의 clock에서 받는다.
  now: Date;
  defaultOpen?: boolean;
}

// 기간 고르기. 정한 기간 줄과 그 아래 직접 기간(시작·끝 날짜와 [Apply])이다.
export function DateRangeFilter(
  { value, onChange, now, defaultOpen = false }: DateRangeFilterProps,
) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState(() => resolveRange(value, now));
  const choose = (next: DateRange) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(resolveRange(value, now));
      }}
      trigger={
        <Button size="sm" icon={Calendar} data-filter="date-range">
          {rangeLabel(value)}
        </Button>
      }
    >
      <div className={styles.panel} {...componentMark("DateRangeFilter")}>
        {RANGE_PRESETS.map((preset) => (
          <PopoverRow
            key={preset}
            onSelect={() => choose({ preset })}
          >
            <span className={styles.rowLabel} data-preset={preset}>
              {t(PRESET_LABELS[preset])}
            </span>
            {value.preset === preset && (
              <Icon icon={Check} pixels={iconPixels("base")} />
            )}
          </PopoverRow>
        ))}
        <form
          className={styles.custom}
          onSubmit={(event) => {
            event.preventDefault();
            choose({ preset: "custom", ...draft });
          }}
        >
          <p className={styles.customTitle}>
            {t("common.label.range-custom")}
          </p>
          <div className={styles.customRow}>
            <Field label={t("common.label.date-from")}>
              <Input
                size="sm"
                type="date"
                value={draft.from}
                onChange={(event) =>
                  setDraft({ ...draft, from: event.currentTarget.value })}
              />
            </Field>
            <Field label={t("common.label.date-to")}>
              <Input
                size="sm"
                type="date"
                value={draft.to}
                onChange={(event) =>
                  setDraft({ ...draft, to: event.currentTarget.value })}
              />
            </Field>
          </div>
          <div className={styles.footer}>
            <Button
              size="sm"
              type="submit"
              disabled={!parseDay(draft.from) || !parseDay(draft.to)}
            >
              {t("common.button.apply")}
            </Button>
          </div>
        </form>
      </div>
    </Popover>
  );
}
