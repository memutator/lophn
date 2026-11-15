import {
  Check,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
  X,
} from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  View,
} from "react-native";
import type { StatusTone } from "../../tokens.ts";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export type ActivityState = "running" | "done" | "failed";

export interface ToolLineProps {
  /** What kind of work: a file, a search, a command. */
  icon: LucideIcon;
  /** What it did, in a few words: "Read 3 files", "Ran npm test". */
  title: string;
  /** The target, in mono: a path, a command. */
  detail?: string;
  state: ActivityState;
  /** Opens the input and output, usually in a sheet. */
  onPress?: () => void;
}

// One line per piece of work. The details stay out of the thread until asked for.
export function ToolLine({
  icon,
  title,
  detail,
  state,
  onPress,
}: ToolLineProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space[4],
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon icon={icon} size="small" tone="muted" />
      <Text variant="small" tone="secondary" numberOfLines={1}>
        {title}
      </Text>
      {detail !== undefined && (
        <Text variant="caption" tone="muted" mono numberOfLines={1} grow>
          {detail}
        </Text>
      )}
      {detail === undefined && <View style={{ flex: 1 }} />}
      {state === "running" && (
        <ActivityIndicator size="small" color={theme.color.text.muted} />
      )}
      {state === "failed" && <Icon icon={X} size="small" tone="critical" />}
      {state === "done" && onPress && (
        <Icon icon={ChevronRight} size="small" tone="muted" />
      )}
    </Pressable>
  );
}

export interface FoldProps {
  /** The closed line: "Worked for 2m 14s", "Thought", "12 steps". */
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

// A finished stretch of work folds into one line so the answer is what the person sees first.
export function Fold({ label, defaultOpen = false, children }: FoldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => ({
          minHeight: 36,
          flexDirection: "row",
          alignItems: "center",
          gap: theme.space[2],
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text variant="small" tone="muted">
          {label}
        </Text>
        <Icon
          icon={open ? ChevronDown : ChevronRight}
          size="small"
          tone="muted"
        />
      </Pressable>
      {open && (
        <View
          style={{
            paddingLeft: theme.space[5],
            borderLeftWidth: 1,
            borderLeftColor: theme.color.border.base,
          }}
        >
          {children}
        </View>
      )}
    </View>
  );
}

export interface WorkingRowProps {
  /** What the agent is doing now: "Working", "Waiting for your answer". */
  label: string;
}

// The live end of the thread while a turn runs.
export function WorkingRow({ label }: WorkingRowProps) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
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
  }, [opacity]);
  return (
    <Animated.View
      accessibilityRole="progressbar"
      style={{
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space[4],
        opacity,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: theme.radius.full,
          backgroundColor: theme.color.text.muted,
        }}
      />
      <Text variant="small" tone="muted">
        {label}
      </Text>
    </Animated.View>
  );
}

export interface ThreadNoteAction {
  label: string;
  onPress: () => void;
}

export interface ThreadNoteProps {
  /** neutral: something happened (compacted, retried). warning and critical: the turn hit a problem. good: a decision went through. */
  tone?: StatusTone;
  text: string;
  action?: ThreadNoteAction;
}

// A line in the thread that is not anyone's message: an error, a decision, a notice.
export function ThreadNote({
  tone = "neutral",
  text,
  action,
}: ThreadNoteProps) {
  const theme = useTheme();
  const quiet = tone === "neutral";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space[4],
        minHeight: 36,
      }}
    >
      {tone === "good" && <Icon icon={Check} size="small" tone="good" />}
      {(tone === "critical" || tone === "serious") && (
        <Icon icon={X} size="small" tone={tone} />
      )}
      <Text variant="small" tone={quiet ? "muted" : tone} grow>
        {text}
      </Text>
      {action && (
        <Text
          variant="small"
          weight="medium"
          tone="link"
          onPress={action.onPress}
        >
          {action.label}
        </Text>
      )}
    </View>
  );
}

export interface EditCardProps {
  /** The file, shortened from the left when it does not fit. */
  path: string;
  added: number;
  removed: number;
  state: ActivityState;
  /** Opens the diff. */
  onPress?: () => void;
}

export function EditCard({
  path,
  added,
  removed,
  state,
  onPress,
}: EditCardProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.touch,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space[4],
        paddingHorizontal: theme.space[5],
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.color.border.subtle,
        backgroundColor: pressed
          ? theme.color.surface.muted
          : theme.color.surface.base,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="small" mono numberOfLines={1}>
          {path}
        </Text>
      </View>
      {state === "running" ? (
        <ActivityIndicator size="small" color={theme.color.text.muted} />
      ) : state === "failed" ? (
        <Icon icon={X} size="small" tone="critical" />
      ) : (
        <>
          <Text variant="caption" tone="good" mono>
            +{added}
          </Text>
          <Text variant="caption" tone="critical" mono>
            -{removed}
          </Text>
        </>
      )}
      {onPress && <Icon icon={ChevronRight} size="small" tone="muted" />}
    </Pressable>
  );
}
