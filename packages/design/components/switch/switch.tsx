import { useId } from "react";
import * as Radix from "@radix-ui/react-switch";
import styles from "./switch.module.css";

export interface SwitchProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}

// 바로 켜고 끄는 설정이다. 라벨을 먼저 읽도록 왼쪽에 둔다.
export function Switch({ label, ...state }: SwitchProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      <Radix.Root {...state} id={id} className={styles.track}>
        <Radix.Thumb className={styles.thumb} />
      </Radix.Root>
    </div>
  );
}
