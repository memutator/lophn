import type { Ref, TextareaHTMLAttributes } from "react";
import { useField } from "../field/field-context.ts";
import { componentMark, cx } from "../shared.ts";
import styles from "../input/input.module.css";

type NativeTextarea = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "style" | "id"
>;

export interface TextareaProps extends NativeTextarea {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ rows = 4, ref, ...rest }: TextareaProps) {
  const field = useField("Textarea");
  return (
    <textarea
      {...rest}
      ref={ref}
      id={field.id}
      rows={rows}
      data-invalid={field.invalid || undefined}
      className={cx(styles.control, styles.multiline)}
      {...componentMark("Textarea")}
    />
  );
}
