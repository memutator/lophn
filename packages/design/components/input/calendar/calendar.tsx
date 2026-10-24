import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate, t } from "@lophn/wording";
import { IconButton } from "../../primitives/icon-button/icon-button.tsx";
import { componentMark } from "../../_shared/shared.ts";
import { toDay } from "../filter/range.ts";
import {
  dateOf,
  monthOf,
  monthWeeks,
  shiftDay,
  shiftDayByMonth,
  weekdayOf,
} from "./month.ts";
import styles from "./calendar.module.css";

// 기간의 양 끝 날짜("YYYY-MM-DD"). from이 to보다 늦지 않다.
export interface DaySpan {
  from: string;
  to: string;
}

export interface CalendarProps {
  // 고른 날("YYYY-MM-DD")이나 기간. 없으면 고른 날이 없다.
  selected?: string | DaySpan;
  onPick: (day: string) => void;
  // 오늘 표시와, 고른 날이 없을 때 처음 보이는 달. 앱의 clock에서 받는다.
  now: Date;
  // 고를 수 있는 첫날과 마지막 날. 밖의 날은 누를 수 없다.
  min?: string;
  max?: string;
  locale?: string;
  // 나타날 때 focus한 날에 focus를 준다. picker가 열자마자 방향키로 날을 옮기게 한다.
  autoFocus?: boolean;
}

const KEY_STEPS: Record<string, (day: string) => string> = {
  ArrowLeft: (day) => shiftDay(day, -1),
  ArrowRight: (day) => shiftDay(day, 1),
  ArrowUp: (day) => shiftDay(day, -7),
  ArrowDown: (day) => shiftDay(day, 7),
  PageUp: (day) => shiftDayByMonth(day, -1),
  PageDown: (day) => shiftDayByMonth(day, 1),
  Home: (day) => shiftDay(day, -weekdayOf(day)),
  End: (day) => shiftDay(day, 6 - weekdayOf(day)),
};

// 보이는 달은 focus한 날의 달이다. 방향키는 날을, PageUp·PageDown은 달을 옮긴다. 탭 순서에는 focus한 날 하나만 든다.
export function Calendar(
  { selected, onPick, now, min, max, locale = "en", autoFocus = false }:
    CalendarProps,
) {
  const today = toDay(now);
  const span = typeof selected === "string"
    ? { from: selected, to: selected }
    : selected;
  const [focus, setFocus] = useState(span?.from ?? today);
  const grid = useRef<HTMLTableElement>(null);
  const keyed = useRef(autoFocus);
  const anchor = span?.from;
  useEffect(() => {
    if (anchor !== undefined) setFocus(anchor);
  }, [anchor]);
  // 방향키로 옮긴 때와 autoFocus의 처음에만 focus를 따라간다. 달 단추나 고른 값이 바뀐 때는 focus를 뺏지 않는다.
  // popover가 자리를 잡기 전에도 부르므로 scroll하지 않는다.
  useEffect(() => {
    if (!keyed.current) return;
    keyed.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)
      ?.focus({ preventScroll: true });
  }, [focus]);

  const inside = (day: string) =>
    (min === undefined || day >= min) && (max === undefined || day <= max);
  const clamp = (day: string) =>
    min !== undefined && day < min
      ? min
      : max !== undefined && day > max
      ? max
      : day;
  const month = monthOf(focus);
  const weeks = monthWeeks(month);
  const title = formatDate(dateOf(`${month}-01`), locale, {
    month: "long",
    year: "numeric",
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const step = KEY_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    keyed.current = true;
    setFocus(clamp(step(focus)));
  };

  return (
    <div className={styles.calendar} {...componentMark("Calendar")}>
      <div className={styles.head}>
        <IconButton
          icon={ChevronLeft}
          size="sm"
          label={t("common.button.previous-month")}
          disabled={min !== undefined && month <= monthOf(min)}
          onClick={() => setFocus(clamp(shiftDayByMonth(focus, -1)))}
        />
        <p className={styles.title} aria-live="polite">{title}</p>
        <IconButton
          icon={ChevronRight}
          size="sm"
          label={t("common.button.next-month")}
          disabled={max !== undefined && month >= monthOf(max)}
          onClick={() => setFocus(clamp(shiftDayByMonth(focus, 1)))}
        />
      </div>
      <table
        ref={grid}
        role="grid"
        aria-label={title}
        className={styles.grid}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {weeks[0].map((day) => (
              <th
                key={day}
                scope="col"
                abbr={formatDate(dateOf(day), locale, { weekday: "long" })}
                className={styles.weekday}
              >
                {formatDate(dateOf(day), locale, { weekday: "short" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const edge = span !== undefined &&
                  (day === span.from || day === span.to);
                const between = span !== undefined && day > span.from &&
                  day < span.to;
                return (
                  <td
                    key={day}
                    role="gridcell"
                    aria-selected={edge || between}
                    className={styles.cell}
                  >
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focus ? 0 : -1}
                      disabled={!inside(day)}
                      data-outside={monthOf(day) !== month || undefined}
                      data-today={day === today || undefined}
                      data-selected={edge || undefined}
                      data-between={between || undefined}
                      aria-current={day === today ? "date" : undefined}
                      aria-label={formatDate(dateOf(day), locale, {
                        dateStyle: "full",
                      })}
                      className={styles.day}
                      onClick={() => {
                        setFocus(day);
                        onPick(day);
                      }}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
