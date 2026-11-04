import * as Radix from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "@lophn/i18n";
import { useField } from "../field/field-context.ts";
import { Icon } from "../../primitives/icon/icon.tsx";
import {
  componentMark,
  controlIconPixels,
  type ControlSize,
  cx,
  iconPixels,
  pixels,
} from "../../_shared/shared.ts";
import { tokens } from "../../../tokens.ts";
import selectStyles from "../select/select.module.css";
import styles from "./search-select.module.css";

export interface SearchSelectOption {
  value: string;
  label: string;
  // 이름 옆에 흐리게 붙는 짧은 말. 예: "Not installed".
  note?: string;
}

export interface SearchSelectProps {
  options: readonly SearchSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  // 무엇을 고르는지. 검색 칸과 목록의 접근 이름이다.
  label: string;
  // 열고 닫을 때. 목록을 열 때 읽는 쪽이 쓴다.
  onOpenChange?: (open: boolean) => void;
  size?: ControlSize;
  disabled?: boolean;
  defaultOpen?: boolean;
}

// 검색 칸이 목록 위에 붙은 Select. 열면 검색 칸에 focus가 가고, 위아래 화살표로 옮기고 Enter로 고른다.
// 목록 밖의 value도 그대로 보인다(고를 수 없게 된 저장 값).
export function SearchSelect({
  options,
  value,
  onValueChange,
  label,
  onOpenChange,
  size = "md",
  disabled,
  defaultOpen = false,
}: SearchSelectProps) {
  const field = useField("SearchSelect");
  const listId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) =>
    option.label.toLowerCase().includes(needle),
  );
  const current = options.find((option) => option.value === value);

  function change(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setActive(Math.max(0, options.indexOf(current!)));
    }
    onOpenChange?.(next);
  }

  function pick(option: SearchSelectOption) {
    onValueChange(option.value);
    change(false);
  }

  // 고른 줄이 늘 보이게 한다.
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        Math.min(Math.max(index + step, 0), shown.length - 1),
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = shown[active];
      if (option) pick(option);
    }
  }

  return (
    <Radix.Root open={open} onOpenChange={change}>
      <Radix.Trigger
        id={field.id}
        disabled={disabled}
        data-size={size}
        data-invalid={field.invalid || undefined}
        className={cx(selectStyles.trigger, selectStyles[size])}
        {...componentMark("SearchSelect")}
      >
        <span className={styles.value}>{current?.label ?? value}</span>
        <span className={selectStyles.chevron}>
          <Icon icon={ChevronDown} pixels={controlIconPixels(size)} />
        </span>
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          className={styles.content}
          side="bottom"
          align="start"
          collisionPadding={pixels(tokens.space[2])}
          {...componentMark("SearchSelect")}
        >
          <div className={styles.search}>
            <input
              className={styles.input}
              type="text"
              role="combobox"
              aria-label={label}
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={
                shown[active] ? `${listId}-${active}` : undefined
              }
              placeholder={t("common.label.search")}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            className={styles.list}
          >
            {shown.length === 0 ? (
              <p className={styles.none}>{t("common.palette.no-results")}</p>
            ) : (
              shown.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  data-index={index}
                  data-highlighted={index === active || undefined}
                  className={selectStyles.item}
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(option)}
                >
                  <span className={styles.label}>
                    {option.label}
                    {option.note === undefined ? null : (
                      <span className={styles.note}>{option.note}</span>
                    )}
                  </span>
                  {option.value === value ? (
                    <span className={selectStyles.indicator}>
                      <Icon icon={Check} pixels={iconPixels("base")} />
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
