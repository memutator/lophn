import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { formatDate, t } from "@lophn/i18n";
import { Icon } from "../../primitives/icon/icon.tsx";
import { Popover } from "../../overlay/popover/popover.tsx";
import { useField } from "../field/field-context.ts";
import { Calendar } from "../calendar/calendar.tsx";
import { parseDay } from "../filter/range.ts";
import {
  componentMark,
  controlIconPixels,
  type ControlSize,
  cx,
} from "../../_shared/shared.ts";
import styles from "../select/select.module.css";
import panel from "./date-picker.module.css";

export interface DatePickerProps {
  // 고른 날("YYYY-MM-DD"). 빈 글이면 아직 고르지 않았다.
  value: string;
  onValueChange: (day: string) => void;
  // 오늘 표시와 처음 보이는 달. 앱의 clock에서 받는다.
  now: Date;
  min?: string;
  max?: string;
  locale?: string;
  size?: ControlSize;
  disabled?: boolean;
}

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

// 칸은 Select와 같은 모양이고 누르면 Calendar가 뜬다. 날을 누르면 닫힌다.
export function DatePicker({
  value,
  onValueChange,
  now,
  min,
  max,
  locale = "en",
  size = "md",
  disabled,
}: DatePickerProps) {
  const field = useField("DatePicker");
  const [open, setOpen] = useState(false);
  const date = parseDay(value);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          id={field.id}
          disabled={disabled}
          data-size={size}
          data-invalid={field.invalid || undefined}
          data-placeholder={date === undefined ? "" : undefined}
          className={cx(styles.trigger, styles[size])}
          {...componentMark("DatePicker")}
        >
          <span>
            {date === undefined
              ? t("common.label.pick-date")
              : formatDate(date, locale, DAY_FORMAT)}
          </span>
          <span className={styles.chevron}>
            <Icon icon={CalendarIcon} pixels={controlIconPixels(size)} />
          </span>
        </button>
      }
    >
      <div className={panel.panel}>
        <Calendar
          selected={date === undefined ? undefined : value}
          now={now}
          min={min}
          max={max}
          locale={locale}
          autoFocus
          onPick={(day) => {
            onValueChange(day);
            setOpen(false);
          }}
        />
      </div>
    </Popover>
  );
}
