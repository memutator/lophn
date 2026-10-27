import { type ReactNode, useId } from "react";
import { CircleX } from "lucide-react";
import { Icon } from "../../primitives/icon/icon.tsx";
import { componentMark, iconPixels } from "../../_shared/shared.ts";
import { FieldContext } from "./field-context.ts";
import styles from "./field.module.css";

export interface FieldProps {
  label: string;
  help?: string;
  // 있으면 도움말 대신 오류 아이콘과 함께 보인다.
  error?: string;
  children: ReactNode;
}

export function Field({ label, help, error, children }: FieldProps) {
  const id = useId();
  const message = error ?? help;
  const invalid = error !== undefined;
  return (
    <FieldContext.Provider value={{ id, invalid }}>
      <div
        className={styles.field}
        data-invalid={invalid || undefined}
        {...componentMark("Field")}
      >
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {children}
        {message !== undefined && (
          <p className={styles.message} data-tone={invalid ? "error" : "help"}>
            {invalid && (
              <Icon
                icon={CircleX}
                pixels={iconPixels("base")}
                className={styles.icon}
              />
            )}
            <span>{message}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
