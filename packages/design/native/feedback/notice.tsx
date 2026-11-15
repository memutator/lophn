import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";

export interface BannerProps {
  icon: LucideIcon;
  title: string;
  /** What it means for the person, in a sentence or two. */
  children?: string;
  /** A small button under the text (Try again). */
  action?: ReactNode;
}

// A state of the whole screen said at its top: the computer is offline.
export function Banner({ icon, title, children, action }: BannerProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        marginTop: 4,
        marginHorizontal: 16,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 14,
        backgroundColor: theme.color.surface.subtle,
      }}
    >
      <View style={{ marginTop: 1 }}>
        <Icon icon={icon} size={20} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="detail" weight="semibold">
          {title}
        </Text>
        {children !== undefined && (
          <Text variant="detail" tone="muted" style={{ marginTop: 2 }}>
            {children}
          </Text>
        )}
        {action !== undefined && (
          <View style={{ flexDirection: "row", marginTop: 10 }}>{action}</View>
        )}
      </View>
    </View>
  );
}

export interface ToastProps {
  /** A dot or an icon before the text. */
  lead?: ReactNode;
  children: ReactNode;
  /** A small ghost button at the end. */
  action?: ReactNode;
}

// A short note floating above the bottom edge. Put it in a Screen's `over`.
export function Toast({ lead, children, action }: ToastProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: insets.bottom + 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingLeft: 14,
        paddingRight: 10,
        borderRadius: 14,
        backgroundColor: theme.color.surface.base,
        boxShadow: theme.shadow.popover,
      }}
    >
      {lead}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof children === "string" ? (
          <Text variant="detail">{children}</Text>
        ) : (
          children
        )}
      </View>
      {action}
    </View>
  );
}

export interface FabProps {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
}

// The one main action of a list screen, floating at the bottom right. Put it in a Screen's `over`.
export function Fab({ icon, label, onPress }: FabProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        position: "absolute",
        right: 20,
        bottom: insets.bottom + 20,
        width: 56,
        height: 56,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed
          ? theme.color.ink.pressed
          : theme.color.ink.background,
        boxShadow: theme.shadow.fab,
      })}
    >
      <Ink color={theme.color.ink.text}>
        <Icon icon={icon} size={24} />
      </Ink>
    </Pressable>
  );
}
