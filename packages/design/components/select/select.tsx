import * as Radix from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useField } from "../field/field-context.ts";
import { Icon } from "../icon.tsx";
import {
  controlIconPixels,
  type ControlSize,
  cx,
  iconPixels,
} from "../shared.ts";
import styles from "./select.module.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  size?: ControlSize;
  disabled?: boolean;
}

// 열고 닫기·키보드 선택·focus 복귀는 Radix Select가 맡는다.
export function Select(
  { options, placeholder, size = "md", ...state }: SelectProps,
) {
  const field = useField("Select");
  return (
    <Radix.Root {...state}>
      <Radix.Trigger
        id={field.id}
        data-size={size}
        data-invalid={field.invalid || undefined}
        className={cx(styles.trigger, styles[size])}
      >
        <Radix.Value placeholder={placeholder} />
        <Radix.Icon className={styles.chevron}>
          <Icon icon={ChevronDown} pixels={controlIconPixels(size)} />
        </Radix.Icon>
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          className={styles.content}
          position="popper"
          side="bottom"
          align="start"
        >
          <Radix.Viewport className={styles.viewport}>
            {options.map((option) => (
              <Radix.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={styles.item}
              >
                <Radix.ItemText>{option.label}</Radix.ItemText>
                <Radix.ItemIndicator className={styles.indicator}>
                  <Icon icon={Check} pixels={iconPixels("base")} />
                </Radix.ItemIndicator>
              </Radix.Item>
            ))}
          </Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
