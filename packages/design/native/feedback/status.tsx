import {
  CircleCheck,
  CircleDashed,
  CircleX,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import type { StatusTone } from "../../tokens.ts";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

// The Lucide icons named by tokens.status.
export const STATUS_ICONS: Record<StatusTone, LucideIcon> = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: OctagonAlert,
  critical: CircleX,
  neutral: CircleDashed,
};

export interface StatusMarkProps {
  tone: StatusTone;
  /** The state's name. Shape and words tell it apart without color. */
  label: string;
}

export function StatusMark({ tone, label }: StatusMarkProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space[2],
      }}
    >
      <Icon icon={STATUS_ICONS[tone]} size="small" tone={tone} />
      <Text variant="small" tone={tone} weight="medium">
        {label}
      </Text>
    </View>
  );
}

export interface StatusDotProps {
  tone: StatusTone;
  /** Breathes: something is running right now. */
  pulse?: boolean;
}

// The small mark in front of a row. A row with a dot also says its state in words.
export function StatusDot({ tone, pulse }: StatusDotProps) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);
  return (
    <Animated.View
      style={{
        width: 10,
        height: 10,
        borderRadius: theme.radius.full,
        backgroundColor: theme.color.status[tone].marker,
        opacity,
      }}
    />
  );
}

export interface BadgeProps {
  count: number;
}

// How many things wait. Zero draws nothing.
export function Badge({ count }: BadgeProps) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.full,
        backgroundColor: theme.color.ink.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text variant="caption" weight="semibold" tone="inverse">
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}
