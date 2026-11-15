import { t } from "@lophn/i18n";
import { ChevronRight, CircleX, Copy, FilePen } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Dot } from "../feedback/status.tsx";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";

export interface ActProps {
  /** What the agent did, folded into one line: Read 2 files · Searched 1 time. */
  children: string;
  /** Opens the steps in a sheet. */
  onPress?: () => void;
}

// A folded line of what the agent did. Pressing it shows the steps.
export function Act({ children, onPress }: ActProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
    >
      <Ink color={theme.color.text.muted}>
        <Text variant="detail" numberOfLines={1} style={{ flexShrink: 1 }}>
          {children}
        </Text>
        <Icon icon={ChevronRight} size={15} />
      </Ink>
    </Pressable>
  );
}

export interface EditCardProps {
  path: string;
  add: number;
  del: number;
  /** Opens the diff. */
  onPress?: () => void;
}

// A file the agent changed, with its added and removed line counts.
export function EditCard({ path, add, del, onPress }: EditCardProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 14,
        backgroundColor: pressed ? theme.color.surface.subtle : "transparent",
      })}
    >
      <Icon icon={FilePen} size={17} tone="muted" />
      <Text
        mono
        numberOfLines={1}
        grow
        style={{ fontSize: 12, lineHeight: 20 }}
      >
        {path}
      </Text>
      <Text mono tone="good" style={{ fontSize: 12, lineHeight: 20 }}>
        {`+${add}`}
      </Text>
      <Text mono tone="critical" style={{ fontSize: 12, lineHeight: 20 }}>
        {`−${del}`}
      </Text>
      <Icon icon={ChevronRight} size={15} tone="muted" />
    </Pressable>
  );
}

export interface WorkingProps {
  /** good: working. warning: waiting on the person. */
  tone?: "good" | "warning";
  children: string;
}

// The line under the last turn while the session runs or waits.
export function Working({ tone = "good", children }: WorkingProps) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Dot tone={tone} />
      <Text variant="detail" tone="muted">
        {children}
      </Text>
    </View>
  );
}

export interface ErrorLineProps {
  children: string;
  /** A small button at the end (Retry). */
  action?: ReactNode;
}

// A turn that stopped on an error, in one line with a way to go on.
export function ErrorLine({ children, action }: ErrorLineProps) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View style={{ marginTop: 1 }}>
        <Icon icon={CircleX} size={17} tone="critical" />
      </View>
      <Text variant="detail" tone="secondary" grow>
        {children}
      </Text>
      {action}
    </View>
  );
}

export interface MetaProps {
  /** Worked for 1m 12s · 6:41 PM */
  children: string;
  onCopy?: () => void;
}

// The quiet line that ends a turn.
export function Meta({ children, onCopy }: MetaProps) {
  const theme = useTheme();
  return (
    <Ink color={theme.color.text.muted}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text variant="caption">{children}</Text>
        {onCopy && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.button.copy")}
            hitSlop={12}
            onPress={onCopy}
          >
            <Icon icon={Copy} size={15} />
          </Pressable>
        )}
      </View>
    </Ink>
  );
}

export interface DiffLineProps {
  no: string;
  text: string;
  kind?: "add" | "del";
}

// One line of a file's diff.
export function DiffLine({ no, text, kind }: DiffLineProps) {
  const theme = useTheme();
  const mark = kind === "add" ? "+ " : kind === "del" ? "− " : "  ";
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        paddingHorizontal: 16,
        backgroundColor:
          kind === "add"
            ? theme.color.diff.addLine
            : kind === "del"
              ? theme.color.diff.deleteLine
              : "transparent",
      }}
    >
      <Text
        mono
        tone="muted"
        align="right"
        style={{ width: 22, fontSize: 12.5, lineHeight: 21 }}
      >
        {no}
      </Text>
      <Text
        mono
        numberOfLines={1}
        style={{ flex: 1, fontSize: 12.5, lineHeight: 21 }}
      >
        {mark + text}
      </Text>
    </View>
  );
}
