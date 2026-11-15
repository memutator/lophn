import type { LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";
import { useTheme } from "../theme.tsx";
import { Icon } from "./icon.tsx";
import type { TextTone } from "./text.tsx";

export interface IconButtonProps {
  icon: LucideIcon;
  /** Read by the screen reader; an icon alone has no name. */
  label: string;
  /** filled: a round ink button (send, stop). plain: the icon alone. */
  variant?: "plain" | "filled";
  tone?: TextTone;
  disabled?: boolean;
  onPress: () => void;
}

// The pressable area is always the 44px touch size, whatever the icon size.
export function IconButton({
  icon,
  label,
  variant = "plain",
  tone = "primary",
  disabled,
  onPress,
}: IconButtonProps) {
  const theme = useTheme();
  const filled = variant === "filled";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: theme.touch,
        height: theme.touch,
        borderRadius: theme.radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: filled
          ? disabled
            ? theme.color.surface.muted
            : pressed
              ? theme.color.ink.pressed
              : theme.color.ink.background
          : pressed
            ? theme.color.surface.muted
            : "transparent",
      })}
    >
      <Icon
        icon={icon}
        tone={disabled ? "disabled" : filled ? "inverse" : tone}
      />
    </Pressable>
  );
}
