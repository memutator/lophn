import type { ButtonHTMLAttributes, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import type { ButtonVariant } from "../button/button.tsx";
import { Icon } from "../icon.tsx";
import {
  componentMark,
  controlIconPixels,
  type ControlSize,
  cx,
} from "../shared.ts";
import styles from "../button/button.module.css";

type NativeButton = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "style" | "children" | "aria-label"
>;

export interface IconButtonProps extends NativeButton {
  icon: LucideIcon;
  // 아이콘만 보이므로 이름은 호출자가 wording key로 준다.
  label: string;
  variant?: Exclude<ButtonVariant, "primary">;
  size?: ControlSize;
  ref?: Ref<HTMLButtonElement>;
}

// 같은 크기의 Button과 높이가 같은 정사각 버튼이다.
export function IconButton(
  {
    icon,
    label,
    variant = "ghost",
    size = "md",
    type = "button",
    ref,
    ...rest
  }: IconButtonProps,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      data-variant={variant}
      data-size={size}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        styles.iconOnly,
      )}
      {...componentMark("IconButton")}
    >
      <Icon icon={icon} pixels={controlIconPixels(size)} />
    </button>
  );
}
