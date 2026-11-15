import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, View } from "react-native";
import { type ControlSize, type Theme, useTheme } from "../theme.tsx";
import { Icon } from "./icon.tsx";
import { Text, type TextTone } from "./text.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: LucideIcon;
  /** Icon after the label, for an action that moves somewhere else (open). */
  trailingIcon?: LucideIcon;
  /** Fills the width of its container. A screen's main action is usually a block button. */
  block?: boolean;
  disabled?: boolean;
  /** Shows a spinner in place of the icon and ignores presses. */
  busy?: boolean;
  onPress: () => void;
  children: string;
}

function surface(theme: Theme, variant: ButtonVariant, pressed: boolean) {
  const { color } = theme;
  switch (variant) {
    case "primary":
      return {
        backgroundColor: pressed ? color.ink.pressed : color.ink.background,
      };
    case "danger":
      return {
        backgroundColor: pressed
          ? color.danger.pressed
          : color.danger.background,
      };
    case "secondary":
      return {
        backgroundColor: pressed ? color.surface.muted : color.surface.base,
        borderWidth: 1,
        borderColor: color.border.base,
      };
    default:
      return { backgroundColor: pressed ? color.surface.muted : "transparent" };
  }
}

const LABEL: Record<ButtonVariant, TextTone> = {
  primary: "inverse",
  danger: "inverse",
  secondary: "primary",
  ghost: "primary",
};

// A danger button only reports the press. Whoever owns the risky decision opens the confirmation.
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  trailingIcon,
  block,
  disabled,
  busy,
  onPress,
  children,
}: ButtonProps) {
  const theme = useTheme();
  const control = theme.control[size];
  const tone = disabled ? "disabled" : LABEL[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: control.height,
          paddingHorizontal: control.padX,
          borderRadius: theme.radius.md,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: theme.space[4],
          alignSelf: block ? "stretch" : "flex-start",
        },
        surface(theme, variant, pressed),
        disabled && {
          backgroundColor: theme.color.surface.muted,
          borderColor: theme.color.border.subtle,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.color.text.muted} />
      ) : (
        icon && <Icon icon={icon} tone={tone} />
      )}
      <View style={{ flexShrink: 1 }}>
        <Text weight="medium" tone={tone} numberOfLines={1}>
          {children}
        </Text>
      </View>
      {trailingIcon && <Icon icon={trailingIcon} tone={tone} />}
    </Pressable>
  );
}
