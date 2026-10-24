import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { t } from "@lophn/wording";
import { Icon } from "../../primitives/icon/icon.tsx";
import { Popover } from "../../overlay/popover/popover.tsx";
import { useField } from "../field/field-context.ts";
import { Calendar, type DaySpan } from "../calendar/calendar.tsx";
import { rangeLabel } from "../filter/date-range-filter.tsx";
import {
  componentMark,
  controlIconPixels,
  type ControlSize,
  cx,
} from "../../_shared/shared.ts";
import styles from "../select/select.module.css";
import panel from "./date-picker.module.css";

export interface DateRangePickerProps {
  // 고른 기간. 없으면 아직 고르지 않았다.
  value: DaySpan | undefined;
  onValueChange: (span: DaySpan) => void;
  // 오늘 표시와 처음 보이는 달. 앱의 clock에서 받는다.
  now: Date;
  min?: string;
  max?: string;
  locale?: string;
  size?: ControlSize;
  disabled?: boolean;
}

// 첫 누름이 한쪽 끝, 둘째 누름이 다른 끝이고 둘째에 닫힌다. 거꾸로 누르면 바로 놓는다. 한쪽만 누르고 닫으면 값은 그대로다.
export function DateRangePicker(
  {
    value,
    onValueChange,
    now,
    min,
    max,
    locale = "en",
    size = "md",
    disabled,
  }: DateRangePickerProps,
) {
  const field = useField("DateRangePicker");
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const pick = (day: string) => {
    if (anchor === undefined) {
      setAnchor(day);
      return;
    }
    onValueChange(
      anchor <= day ? { from: anchor, to: day } : { from: day, to: anchor },
    );
    setAnchor(undefined);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setAnchor(undefined);
      }}
      trigger={
        <button
          type="button"
          id={field.id}
          disabled={disabled}
          data-size={size}
          data-invalid={field.invalid || undefined}
          data-placeholder={value === undefined ? "" : undefined}
          className={cx(styles.trigger, styles[size])}
          {...componentMark("DateRangePicker")}
        >
          <span>
            {value === undefined
              ? t("common.label.pick-dates")
              : rangeLabel({ preset: "custom", ...value }, locale)}
          </span>
          <span className={styles.chevron}>
            <Icon icon={CalendarIcon} pixels={controlIconPixels(size)} />
          </span>
        </button>
      }
    >
      <div className={panel.panel}>
        <Calendar
          selected={anchor ?? value}
          now={now}
          min={min}
          max={max}
          locale={locale}
          autoFocus
          onPick={pick}
        />
      </div>
    </Popover>
  );
}
