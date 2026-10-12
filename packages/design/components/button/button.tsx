import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "../icon.tsx";
import { controlIconPixels, type ControlSize, cx } from "../shared.ts";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

// className·style을 받지 않아 전체폭·임의 색 버튼을 만들 수 없다.
type NativeButton = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "style" | "children"
>;

export interface ButtonProps extends NativeButton {
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: LucideIcon;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

// danger도 클릭을 호출자에게 넘길 뿐이다. 위험 결정의 확인은 그 concern이 연다.
export function Button(
  {
    variant = "secondary",
    size = "md",
    icon,
    children,
    type = "button",
    ref,
    ...rest
  }: ButtonProps,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      className={cx(styles.button, styles[variant], styles[size])}
    >
      {icon && <Icon icon={icon} pixels={controlIconPixels(size)} />}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
