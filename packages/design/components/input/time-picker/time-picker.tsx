import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { Check, Clock } from "lucide-react";
import { formatDate, t } from "@lophn/i18n";
import { Icon } from "../../primitives/icon/icon.tsx";
import { Popover } from "../../overlay/popover/popover.tsx";
import { useField } from "../field/field-context.ts";
import {
  componentMark,
  controlIconPixels,
  type ControlSize,
  cx,
  iconPixels,
} from "../../_shared/shared.ts";
import styles from "../select/select.module.css";
import list from "./time-picker.module.css";

export interface TimePickerProps {
  // 고른 시각("HH:mm", 24시간). 빈 글이면 아직 고르지 않았다.
  value: string;
  onValueChange: (time: string) => void;
  // 고르지 않았을 때 목록을 지금 시각 근처에서 연다. 앱의 clock에서 받는다.
  now: Date;
  // 목록 간격(분). 15면 00:00, 00:15, 00:30, ….
  step?: number;
  // 끝 시각을 고를 때 시작 시각("HH:mm"). 목록이 from + step부터 step 간격이고 시각마다 길이("30 mins")가 붙는다. 같은 날 안에서만 센다.
  from?: string;
  locale?: string;
  size?: ControlSize;
  disabled?: boolean;
}

const DAY_MINUTES = 24 * 60;
// PageUp·PageDown이 옮기는 칸 수. 목록에 보이는 줄 수와 같다.
const PAGE_ROWS = 8;
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
};

function minutesOf(time: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function timeOf(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// 12·24시간과 오전·오후 꼴은 locale이 정한다. 시간대가 끼지 않게 UTC 자정에서 센다.
function timeLabel(minutes: number, locale: string): string {
  return formatDate(
    new Date(Date.UTC(2000, 0, 1, 0, minutes)),
    locale,
    TIME_FORMAT,
  );
}

function durationLabel(minutes: number): string {
  if (minutes < 60) {
    return t("common.label.duration-minutes", { count: minutes });
  }
  return t("common.label.duration-hours", {
    count: Math.round((minutes / 60) * 100) / 100,
  });
}

// step 간격이 아닌 값(앱이 넣은 10:37)도 목록에 끼워 고른 표시가 보이게 한다.
function timeOptions(
  step: number,
  from: number | undefined,
  picked: number | undefined,
): number[] {
  // step이 0이나 음수면 목록이 끝나지 않는다.
  const gap = Math.max(1, Math.round(step));
  const options: number[] = [];
  for (
    let at = from === undefined ? 0 : from + gap;
    at < DAY_MINUTES;
    at += gap
  ) {
    options.push(at);
  }
  if (
    picked !== undefined &&
    !options.includes(picked) &&
    (from === undefined || picked > from)
  ) {
    options.push(picked);
    options.sort((a, b) => a - b);
  }
  return options;
}

// 칸은 Select와 같은 모양이고 누르면 시각 목록이 뜬다. 시각을 누르면 닫힌다.
export function TimePicker({
  value,
  onValueChange,
  now,
  step = 15,
  from,
  locale = "en",
  size = "md",
  disabled,
}: TimePickerProps) {
  const field = useField("TimePicker");
  const [open, setOpen] = useState(false);
  const picked = minutesOf(value);
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
          data-placeholder={picked === undefined ? "" : undefined}
          className={cx(styles.trigger, styles[size])}
          {...componentMark("TimePicker")}
        >
          <span>
            {picked === undefined
              ? t("common.label.pick-time")
              : timeLabel(picked, locale)}
          </span>
          <span className={styles.chevron}>
            <Icon icon={Clock} pixels={controlIconPixels(size)} />
          </span>
        </button>
      }
    >
      <TimeList
        picked={picked}
        now={now}
        step={step}
        from={from === undefined ? undefined : minutesOf(from)}
        locale={locale}
        onPick={(time) => {
          onValueChange(time);
          setOpen(false);
        }}
      />
    </Popover>
  );
}

interface TimeListProps {
  picked: number | undefined;
  now: Date;
  step: number;
  from: number | undefined;
  locale: string;
  onPick: (time: string) => void;
}

function itemIn(box: HTMLElement | null, at: number) {
  return (
    box?.querySelector<HTMLButtonElement>(`[data-time="${timeOf(at)}"]`) ?? null
  );
}

const KEY_STEPS: Record<string, (index: number, last: number) => number> = {
  ArrowUp: (index) => index - 1,
  ArrowDown: (index) => index + 1,
  PageUp: (index) => index - PAGE_ROWS,
  PageDown: (index) => index + PAGE_ROWS,
  Home: () => 0,
  End: (_, last) => last,
};

// 열 때 고른 시각(없으면 끝 시각은 첫 칸, 시작 시각은 지금 다음 칸)이 가운데에 오고 focus를 받는다. 탭 순서에는 그 칸 하나만 든다.
function TimeList({ picked, now, step, from, locale, onPick }: TimeListProps) {
  const options = timeOptions(step, from, picked);
  const current = now.getHours() * 60 + now.getMinutes();
  const [focus, setFocus] = useState(() => {
    if (picked !== undefined && options.includes(picked)) return picked;
    if (from !== undefined) return options[0];
    return options.find((at) => at >= current) ?? options.at(-1);
  });
  const box = useRef<HTMLDivElement>(null);
  const opening = useRef(focus);
  // 열 때 한 번만 옮긴다. popover가 자리를 잡기 전이라 page는 scroll하지 않고 목록 안만 옮긴다.
  useLayoutEffect(() => {
    const at = opening.current;
    const item = at === undefined ? null : itemIn(box.current, at);
    if (box.current === null || item === null) return;
    box.current.scrollTop =
      item.offsetTop - (box.current.clientHeight - item.offsetHeight) / 2;
    item.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = KEY_STEPS[event.key];
    if (move === undefined || focus === undefined) return;
    event.preventDefault();
    const last = options.length - 1;
    const index = Math.min(
      last,
      Math.max(0, move(options.indexOf(focus), last)),
    );
    const next = options[index];
    setFocus(next);
    const item = itemIn(box.current, next);
    item?.scrollIntoView({ block: "nearest" });
    item?.focus({ preventScroll: true });
  };
  return (
    <div ref={box} role="listbox" className={list.list} onKeyDown={onKeyDown}>
      {options.map((at) => {
        const time = timeOf(at);
        const selected = at === picked;
        return (
          <button
            key={at}
            type="button"
            role="option"
            aria-selected={selected}
            data-time={time}
            tabIndex={at === focus ? 0 : -1}
            className={list.item}
            onFocus={() => setFocus(at)}
            onClick={() => onPick(time)}
          >
            <span>{timeLabel(at, locale)}</span>
            {from !== undefined && (
              <span className={list.duration}>{durationLabel(at - from)}</span>
            )}
            <span className={list.check}>
              {selected && <Icon icon={Check} pixels={iconPixels("base")} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
