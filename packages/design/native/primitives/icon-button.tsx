import type { LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useTheme } from "../theme.tsx";
import { Icon } from "./icon.tsx";

export interface IconButtonProps {
  icon: LucideIcon;
  /** Read by the screen reader; an icon alone has no name. */
  label: string;
  /** muted: a quieter action next to a title. camera: on the dark camera screen. */
  tone?: "primary" | "muted" | "camera";
  /** A small mark: something waits behind this button. */
  dot?: boolean;
  /** Icon side. 22 in a top bar, 20 or 18 for quieter ones. */
  size?: number;
  disabled?: boolean;
  onPress?: () => void;
}

// Always a 44 round touch target, whatever the icon size.
export function IconButton({
  icon,
  label,
  tone = "primary",
  dot,
  size = 22,
  disabled,
  onPress,
}: IconButtonProps) {
  const theme = useTheme();
  const camera = tone === "camera";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: camera
          ? "rgba(255,255,255,0.14)"
          : pressed
            ? theme.color.surface.muted
            : "transparent",
      })}
    >
      <Icon
        icon={icon}
        size={size}
        color={
          disabled
            ? theme.color.text.disabled
            : camera
              ? "#f3f3f0"
              : tone === "muted"
                ? theme.color.text.secondary
                : theme.color.text.primary
        }
      />
      {dot && (
        <View
          style={{
            position: "absolute",
            top: 9,
            right: 9,
            width: 13,
            height: 13,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: theme.color.surface.base,
            backgroundColor: theme.color.status.warning.marker,
          }}
        />
      )}
    </Pressable>
  );
}
