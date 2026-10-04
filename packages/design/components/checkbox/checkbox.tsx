import { useId } from "react";
import * as Radix from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { Icon } from "../icon.tsx";
import { controlIconPixels } from "../shared.ts";
import styles from "./checkbox.module.css";

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
}

// 나중에 제출하는 선택이다. 바로 바뀌는 설정은 Switch를 쓴다.
export function Checkbox(
  { label, onCheckedChange, ...state }: CheckboxProps,
) {
  const id = useId();
  return (
    <div className={styles.row}>
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
