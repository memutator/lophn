import type { ButtonHTMLAttributes, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "../icon/icon.tsx";
import {
  componentMark,
  controlIconPixels,
  type ControlSize,
  cx,
} from "../../_shared/shared.ts";
import styles from "../button/button.module.css";

type NativeButton = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "style" | "children" | "aria-label" | "aria-pressed"
>;

export interface IconToggleProps extends NativeButton {
  icon: LucideIcon;
  // 아이콘만 보이므로 이름은 호출자가 message key로 준다. 켠 상태와 끈 상태의 이름이 다르면 호출자가 고른다.
  label: string;
  pressed: boolean;
  size?: ControlSize;
  ref?: Ref<HTMLButtonElement>;
}

// 선 아이콘 하나로 켜고 끈다(pin, bookmark, 즐겨찾기). 켜면 아이콘 안쪽이 글자색으로 차고, 아이콘을 바꾸지 않는다.
export function IconToggle({
  icon,
  label,
  pressed,
  size = "md",
  type = "button",
  ref,
  ...rest
}: IconToggleProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      data-variant="ghost"
      data-size={size}
      className={cx(
        styles.button,
        styles.ghost,
        styles[size],
        styles.iconOnly,
        styles.iconToggle,
      )}
      {...componentMark("IconToggle")}
    >
      <Icon icon={icon} pixels={controlIconPixels(size)} />
    </button>
  );
}
