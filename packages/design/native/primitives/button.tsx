import type { LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";
import { Ink, type Theme, useTheme } from "../theme.tsx";
import { Icon } from "./icon.tsx";
import { Text } from "./text.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const SIZE: Record<
  ButtonSize,
  {
    height: number;
    padX: number;
    radius: number;
    icon: number;
    text: "detail" | "control" | "body";
  }
> = {
  // The wireframe's boxes are content-box: 32, 40 and 52 inside a 1px border, so 34, 42 and 54 across.
  sm: { height: 34, padX: 10, radius: 8, icon: 15, text: "detail" },
  md: { height: 42, padX: 14, radius: 10, icon: 17, text: "control" },
  lg: { height: 54, padX: 20, radius: 14, icon: 17, text: "body" },
};

// A finger needs 44 to hit. sm and md keep the wireframe's look and reach 44 with an invisible margin above and below.
const TOUCH = 44;

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** After the label, for an action that moves on (Next, Review). */
  trailingIcon?: LucideIcon;
  /** Shares a button row's width with the other block buttons. */
  block?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: string;
}

function look(theme: Theme, variant: ButtonVariant, pressed: boolean) {
  const { color } = theme;
  switch (variant) {
    case "primary":
      return {
        background: pressed ? color.ink.pressed : color.ink.background,
        border: "transparent",
        text: color.ink.text,
      };
    case "danger":
      return {
        background: pressed ? color.danger.pressed : color.danger.background,
        border: "transparent",
        text: color.danger.text,
      };
    case "ghost":
      return {
        background: pressed ? color.surface.muted : "transparent",
        border: "transparent",
        text: color.text.primary,
      };
    default:
      return {
        background: pressed ? color.surface.muted : color.surface.base,
        border: color.border.base,
        text: color.text.primary,
      };
  }
}

// A button stretches across a column and keeps its own width in a row, like the wireframes' grid and button rows.
// A danger button only reports the press. Whoever owns the risky decision opens the confirmation.
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  trailingIcon,
  block,
  disabled,
  onPress,
  children,
}: ButtonProps) {
  const theme = useTheme();
  const box = SIZE[size];
  const slop = Math.max(0, (TOUCH - box.height) / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop }}
      style={({ pressed }) => {
        const tone = disabled
          ? {
              background: theme.color.surface.muted,
              border: "transparent",
            }
          : look(theme, variant, pressed);
        return [
          {
            height: box.height,
            paddingHorizontal: box.padX,
            borderRadius: box.radius,
            borderWidth: 1,
            borderColor: tone.border,
            backgroundColor: tone.background,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          },
          block && { flex: 1, minWidth: 0 },
        ];
      }}
    >
      <Ink
        color={
          disabled
            ? theme.color.text.disabled
            : look(theme, variant, false).text
        }
      >
        {icon && <Icon icon={icon} size={box.icon} />}
        <Text
          variant={box.text}
          weight="medium"
          numberOfLines={1}
          style={{ lineHeight: 20, flexShrink: 1 }}
        >
          {children}
        </Text>
        {trailingIcon && <Icon icon={trailingIcon} size={box.icon - 1} />}
      </Ink>
    </Pressable>
  );
}
