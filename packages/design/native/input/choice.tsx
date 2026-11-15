import { Check, ChevronDown } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { Ink, useTheme } from "../theme.tsx";

export interface SwitchProps {
  on: boolean;
  onChange?: (on: boolean) => void;
  label: string;
}

// Turns one setting on or off right away.
export function Switch({ on, onChange, label }: SwitchProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      hitSlop={9}
      onPress={() => onChange?.(!on)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        backgroundColor: on
          ? theme.color.ink.background
          : theme.color.border.strong,
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: 999,
          backgroundColor: on ? theme.color.ink.text : theme.color.surface.base,
        }}
      />
    </Pressable>
  );
}

export interface RadioProps {
  on: boolean;
}

// The mark of a pick-one choice. The row around it takes the press.
export function Radio({ on }: RadioProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 999,
        borderWidth: on ? 6 : 1.5,
        borderColor: on
          ? theme.color.ink.background
          : theme.color.border.strong,
        backgroundColor: theme.color.surface.base,
      }}
    />
  );
}

export interface CheckboxProps {
  on: boolean;
}

// The mark of a pick-many choice. The row around it takes the press.
export function Checkbox({ on }: CheckboxProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        borderWidth: on ? 0 : 1.5,
        borderColor: theme.color.border.strong,
        backgroundColor: on
          ? theme.color.ink.background
          : theme.color.surface.base,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && (
        <Icon
          icon={Check}
          size={14}
          strokeWidth={2.4}
          color={theme.color.ink.text}
        />
      )}
    </View>
  );
}

export interface TabsProps {
  items: readonly string[];
  on: number;
  onChange?: (at: number) => void;
}

// Underlined tabs across the top of a place (Inbox: Now, History).
export function Tabs({ items, on, onChange }: TabsProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        gap: 24,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: theme.color.border.subtle,
      }}
    >
      {items.map((item, at) => (
        <Pressable
          key={item}
          accessibilityRole="tab"
          accessibilityState={{ selected: at === on }}
          onPress={() => onChange?.(at)}
          style={{ height: 44, justifyContent: "center", marginBottom: -1 }}
        >
          <Text
            variant="control"
            weight={at === on ? "medium" : "regular"}
            tone={at === on ? "primary" : "muted"}
          >
            {item}
          </Text>
          {at === on && (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 2,
                backgroundColor: theme.color.ink.background,
              }}
            />
          )}
        </Pressable>
      ))}
    </View>
  );
}

export interface SegmentedControlProps {
  items: readonly string[];
  on: number;
  onChange?: (at: number) => void;
}

// A pick-one of a few short choices side by side (Effort, Appearance).
export function SegmentedControl({
  items,
  on,
  onChange,
}: SegmentedControlProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        padding: 3,
        borderRadius: 10,
        backgroundColor: theme.color.surface.muted,
      }}
    >
      {items.map((item, at) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{ selected: at === on }}
          onPress={() => onChange?.(at)}
          style={[
            {
              flex: 1,
              height: 32,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
            },
            at === on && {
              backgroundColor: theme.color.surface.base,
              boxShadow: theme.shadow.lift,
            },
          ]}
        >
          <Text
            variant="detail"
            weight="medium"
            tone={at === on ? "primary" : "secondary"}
          >
            {item}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface FilterChipsProps {
  items: readonly string[];
  on: number;
  onChange?: (at: number) => void;
}

// Pills that narrow a list. The chosen one is filled.
export function FilterChips({ items, on, onChange }: FilterChipsProps) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((item, at) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{ selected: at === on }}
          onPress={() => onChange?.(at)}
          style={{
            height: 34,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: at === on ? "transparent" : theme.color.border.base,
            backgroundColor:
              at === on ? theme.color.ink.background : theme.color.surface.base,
            justifyContent: "center",
          }}
        >
          <Text
            variant="detail"
            weight="medium"
            tone={at === on ? "inverse" : "secondary"}
          >
            {item}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface ChipProps {
  /** An icon or a face before the text. */
  lead?: ReactNode;
  children: string;
  onPress?: () => void;
}

// A quiet pick in the composer's bottom row: the model, the workspace. It opens a sheet to change it.
export function Chip({ lead, children, onPress }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 32,
        paddingHorizontal: 8,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flexShrink: 1,
        backgroundColor: pressed ? theme.color.surface.muted : "transparent",
      })}
    >
      <Ink color={theme.color.text.secondary}>
        {lead}
        <Text
          variant="detail"
          weight="medium"
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {children}
        </Text>
        <Icon icon={ChevronDown} size={14} />
      </Ink>
    </Pressable>
  );
}

export interface PillProps {
  /** A dot or an icon before the text. */
  lead?: ReactNode;
  children: string;
  /** 36 tall instead of 32: a pick that stands alone under a heading. */
  tall?: boolean;
  onPress?: () => void;
}

// An outlined pick with a chevron that opens a sheet: the computer in the top bar, the workspace of a new session.
export function Pill({ lead, children, tall, onPress }: PillProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: tall ? 38 : 34,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 12,
        paddingRight: 10,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 999,
        backgroundColor: pressed ? theme.color.surface.muted : "transparent",
      })}
    >
      <Ink color={theme.color.text.secondary}>
        {lead}
        <Text variant="small" weight="medium" numberOfLines={1}>
          {children}
        </Text>
        <Icon icon={ChevronDown} size={14} />
      </Ink>
    </Pressable>
  );
}
