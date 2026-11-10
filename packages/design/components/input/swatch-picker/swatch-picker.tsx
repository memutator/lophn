import { useEffect, useId, useRef } from "react";
import { useField } from "../field/field-context.ts";
import { componentMark } from "../../_shared/shared.ts";
import { Tooltip } from "../../overlay/tooltip/tooltip.tsx";
import styles from "./swatch-picker.module.css";

export interface SwatchOption {
  value: string;
  /** 화면 읽기 도구와 tooltip이 말하는 이름. 색만으로 구별하지 않는다. */
  label: string;
  /** 견본 칸의 CSS background. 색 하나이거나 gradient다. */
  swatch: string;
}

export interface SwatchPickerProps {
  options: readonly SwatchOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** 묶음의 이름. 보통 Field의 라벨과 같은 글이다. */
  label: string;
  /**
   * 있으면 끝에 아무 색이나 고르는 칸을 둔다(OS 색 고르기 창). 값은 `#rrggbb`이고, 값이 선택지에 없는
   * hex이면 이 칸이 고른 것이다. label은 그 칸의 이름이다.
   */
  custom?: { label: string };
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
// 아직 고르지 않은 색 칸은 "아무 색"을 뜻하는 색 바퀴다.
const WHEEL = "conic-gradient(#f44, #fd4, #4d4, #4dd, #44f, #d4d, #f44)";

/** 색 칸. 끌 때마다가 아니라 OS 창을 닫을 때(native change) 한 번 고른다. */
function CustomSwatch({
  label,
  value,
  chosen,
  onValueChange,
}: {
  label: string;
  value: string;
  chosen: boolean;
  onValueChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    const onChange = () => onValueChange(element.value);
    element.addEventListener("change", onChange);
    return () => element.removeEventListener("change", onChange);
  }, [onValueChange]);
  return (
    <Tooltip content={label}>
      <label className={styles.option}>
        <input
          ref={input}
          type="color"
          aria-label={label}
          className={styles.input}
          defaultValue={chosen ? value : "#808080"}
          key={chosen ? value : ""}
        />
        <span
          className={styles.swatch}
          data-chosen={chosen ? "" : undefined}
          style={{ background: chosen ? value : WHEEL }}
        />
      </label>
    </Tooltip>
  );
}

// 방향키와 선택은 같은 name의 native radio가 맡는다.
export function SwatchPicker({
  options,
  value,
  onValueChange,
  label,
  custom,
}: SwatchPickerProps) {
  const field = useField("SwatchPicker");
  const name = useId();
  return (
    <div
      id={field.id}
      role="radiogroup"
      aria-label={label}
      className={styles.group}
      {...componentMark("SwatchPicker")}
    >
      {options.map((option) => (
        <Tooltip key={option.value} content={option.label}>
          <label className={styles.option}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              aria-label={option.label}
              className={styles.input}
              onChange={() => onValueChange(option.value)}
            />
            <span
              className={styles.swatch}
              style={{ background: option.swatch }}
            />
          </label>
        </Tooltip>
      ))}
      {custom === undefined ? null : (
        <CustomSwatch
          label={custom.label}
          value={value}
          chosen={
            HEX6.test(value) &&
            !options.some((option) => option.value === value)
          }
          onValueChange={onValueChange}
        />
      )}
    </div>
  );
}
