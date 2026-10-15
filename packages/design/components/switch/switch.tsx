import { useId } from "react";
import * as Radix from "@radix-ui/react-switch";
import { componentMark, type ControlSize, cx } from "../shared.ts";
import styles from "./switch.module.css";

export interface SwitchProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  // 같은 줄의 버튼·입력과 높이를 맞춘다.
  size?: ControlSize;
}

// 바로 켜고 끄는 설정이다. 라벨을 먼저 읽도록 왼쪽에 둔다.
export function Switch({ label, size = "md", ...state }: SwitchProps) {
  const id = useId();
  return (
    <div
      data-size={size}
      className={cx(styles.row, styles[size])}
      {...componentMark("Switch")}
    >
      <label htmlFor={id} className={styles.label}>{label}</label>
      <Radix.Root {...state} id={id} className={styles.track}>
        <Radix.Thumb className={styles.thumb} />
      </Radix.Root>
    </div>
  );
}
