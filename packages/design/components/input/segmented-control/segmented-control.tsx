import { useContext, useId } from "react";
import { FieldContext } from "../field/field-context.ts";
import { componentMark, type ControlSize, cx } from "../../_shared/shared.ts";
import styles from "./segmented-control.module.css";

export interface SegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: readonly SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  // 묶음의 이름. 화면 읽기 도구가 말한다. Field 안이면 보통 그 라벨과 같은 글이다.
  label: string;
  size?: ControlSize;
}

// 방향키와 선택은 같은 name의 native radio가 맡는다. 목록 위 보기 전환처럼 Field 밖에서도 쓰므로 Field는 없어도 된다.
// 칸 폭은 가장 긴 이름에 맞춰 모두 같다. 높이는 같은 size의 Button과 같다.
export function SegmentedControl(
  { options, value, onValueChange, label, size = "md" }: SegmentedControlProps,
) {
  const field = useContext(FieldContext);
  const name = useId();
  return (
    <div
      id={field?.id}
      role="radiogroup"
      aria-label={label}
      data-size={size}
      className={cx(styles.group, styles[size])}
      {...componentMark("SegmentedControl")}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            className={styles.input}
            onChange={() =>
              onValueChange(option.value)}
          />
          <span className={styles.segment}>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
