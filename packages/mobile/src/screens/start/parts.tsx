// The start flow's shared layout (tools/wireframes/drafts/phone/start.tsx, phone.module.css .center, .foot, .circle, .hero).
import { Icon, Text, useTheme } from "@lophn/ui-native";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

/** The middle of the screen: one thing, centered. */
export function Center({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 28,
      }}
    >
      {children}
    </View>
  );
}

/** The actions at the bottom. */
export function Foot({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        gap: 8,
        paddingTop: 12,
        paddingHorizontal: 20,
        paddingBottom: 10,
      }}
    >
      {children}
    </View>
  );
}

export function Hero({
  size = "hero",
  top = 20,
  children,
}: {
  size?: "hero" | "h1";
  top?: number;
  children: string;
}) {
  return (
    <Text
      variant={size}
      weight="semibold"
      align="center"
      style={{ marginTop: top }}
    >
      {children}
    </Text>
  );
}

export function Lead({ children }: { children: string }) {
  return (
    <Text tone="secondary" align="center" style={{ marginTop: 10 }}>
      {children}
    </Text>
  );
}

/** A large icon in a round muted disc: Paired, and the screens that say what went wrong. */
export function Disc({
  icon,
  size,
  color,
}: {
  icon: LucideIcon;
  size: number;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 72,
        height: 72,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.color.surface.muted,
      }}
    >
      <Icon icon={icon} size={size} color={color} />
    </View>
  );
}
