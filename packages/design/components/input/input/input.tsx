import type { InputHTMLAttributes, Ref } from "react";
import { useField } from "../field/field-context.ts";
import { componentMark, type ControlSize, cx } from "../../_shared/shared.ts";
import styles from "./input.module.css";

type NativeInput = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "style" | "size" | "id"
>;

export interface InputProps extends NativeInput {
  size?: ControlSize;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = "md", ref, ...rest }: InputProps) {
  const field = useField("Input");
  return (
    <input
      {...rest}
      ref={ref}
      id={field.id}
      data-size={size}
      data-invalid={field.invalid || undefined}
      className={cx(styles.control, styles[size])}
      {...componentMark("Input")}
    />
  );
}
