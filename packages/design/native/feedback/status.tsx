import {
  CircleCheck,
  CircleDashed,
  CircleX,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react-native";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
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

export type DotTone = "warning" | "good" | "critical" | "off" | "working";

export interface DotProps {
  /**
   * warning: waits on the person. good: done, or connected. critical: failed. off: offline. working: an agent works now
   * (ink, breathing). None: idle or ended.
   */
  tone?: DotTone;
}

export function Dot({ tone }: DotProps) {
  const theme = useTheme();
  if (tone === "working")
    return <WorkingDot color={theme.color.ink.background} />;
  if (tone === "off")
    return (
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: theme.color.text.muted,
        }}
      />
    );
  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: theme.color.status[tone ?? "neutral"].marker,
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
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 999,
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

export interface TagProps {
  children: string;
}

// A short quiet word next to a name: Built-in, Paused, Release 8.
export function Tag({ children }: TagProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 20,
        paddingHorizontal: 7,
        borderRadius: 999,
        backgroundColor: theme.color.surface.muted,
        justifyContent: "center",
      }}
    >
      <Text variant="caption" weight="medium" tone="secondary">
        {children}
      </Text>
    </View>
  );
}

export interface StatusMarkProps {
  tone: StatusTone;
  /** The state's name. Shape and words tell it apart without color. */
  label: string;
}

// A state said with its icon and word: Connected, Failed.
export function StatusMark({ tone, label }: StatusMarkProps) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon icon={STATUS_ICONS[tone]} size={16} tone={tone} />
      <Text variant="small" weight="medium" tone={tone}>
        {label}
      </Text>
    </View>
  );
}

// The desktop's working dot: ink that breathes (scale 0.75 to 1 and back over the pulse time), still when the person
// asked for less motion.
const PULSE_MS = 1600;

function WorkingDot({ color }: { color: string }) {
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 0,
          duration: PULSE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: PULSE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    let stopped = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!reduce && !stopped) loop.start();
    });
    return () => {
      stopped = true;
      loop.stop();
    };
  }, [breath]);
  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: color,
        opacity: breath.interpolate({
          inputRange: [0, 1],
          outputRange: [0.5, 1],
        }),
        transform: [
          {
            scale: breath.interpolate({
              inputRange: [0, 1],
              outputRange: [0.75, 1],
            }),
          },
        ],
      }}
    />
  );
}
