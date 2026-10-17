// 선언된 검색 입력 form의 combobox. 쓰면 이름에 든 후보만 남기고, 후보에 없는
// 글은 고를 수 없다. 고른 값은 후보의 value로 알리고, 칸을 비우면 빈 글자("")로 알려 값을 지운다.
import { useId, useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { lophnSpaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { OptionValue, PickOption } from "./source.ts";
import styles from "./search-input-form.module.css";

interface PickComboboxProps {
  /** label[for]가 가리키는 칸의 id. */
  readonly inputId: string;
  readonly options: readonly PickOption[];
  /** 지금 고른 후보 value(후보의 타입 그대로). 없으면 빈 글자. */
  readonly value: OptionValue;
  /** 고른 후보의 value를 타입 그대로 알린다. 칸을 비우면 빈 글자(""). */
  readonly onPick: (value: OptionValue) => void;
}

export function PickCombobox(
  { inputId, options, value, onPick }: PickComboboxProps,
) {
  const listId = useId();
  // draft가 null이면 고른 후보의 이름을 보이고, 글을 치는 동안만 그 글을 보여 후보를 거른다.
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value);
  const text = draft ?? selected?.label ?? String(value);
  const query = (draft ?? "").trim().toLowerCase();
  const shown = query === ""
    ? options
    : options.filter((option) => option.label.toLowerCase().includes(query));
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  function close(): void {
    setOpen(false);
    setDraft(null);
    setActive(0);
  }

  function choose(option: PickOption): void {
    close();
    onPick(option.value);
  }

  return (
    <div className={styles.combo}>
      <input
        id={inputId}
        className={styles.control}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && shown.length > 0
          ? `${listId}-${current}`
          : undefined}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          setActive(0);
          setOpen(true);
          if (next.trim() === "" && value !== "") onPick("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(Math.min(current + 1, shown.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const option = shown[current];
            if (option) choose(option);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
      />
      <span className={styles.comboCaret}>
        <Icon icon={lophnSpaceIcons.collapse} pixels={iconPixels("base")} />
      </span>
      {open
        ? (
          <div id={listId} className={styles.comboList} role="listbox">
            {shown.length === 0
              ? (
                <div className={styles.comboEmpty}>
                  {t("contexts.label.input-no-matches")}
                </div>
              )
              : shown.map((option, index) => (
                <div
                  key={`${typeof option.value}:${option.value}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === current}
                  className={styles.comboOption}
                  data-highlighted={index === current ? "" : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  {option.label}
                </div>
              ))}
          </div>
        )
        : null}
    </div>
  );
}
