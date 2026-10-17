import { useId } from "react";
import * as Radix from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { Icon } from "../../primitives/icon/icon.tsx";
import {
  componentMark,
  controlIconPixels,
  type ControlSize,
  cx,
} from "../../_shared/shared.ts";
import styles from "./checkbox.module.css";

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  // 같은 줄의 버튼·입력과 높이를 맞춘다.
  size?: ControlSize;
}

// 나중에 제출하는 선택이다. 바로 바뀌는 설정은 Switch를 쓴다.
export function Checkbox(
  { label, onCheckedChange, size = "md", ...state }: CheckboxProps,
) {
  const id = useId();
  return (
    <div
      data-size={size}
      className={cx(styles.row, styles[size])}
      {...componentMark("Checkbox")}
    >
      <Radix.Root
        {...state}
        id={id}
        className={styles.box}
        onCheckedChange={(checked) => onCheckedChange?.(checked === true)}
      >
        <Radix.Indicator className={styles.indicator}>
          <Icon icon={Check} pixels={controlIconPixels("sm")} />
        </Radix.Indicator>
      </Radix.Root>
      <label htmlFor={id} className={styles.label}>{label}</label>
    </div>
  );
}
