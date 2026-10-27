import { useId } from "react";
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
}

// 방향키와 선택은 같은 name의 native radio가 맡는다.
export function SwatchPicker({
  options,
  value,
  onValueChange,
  label,
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
    </div>
  );
}
