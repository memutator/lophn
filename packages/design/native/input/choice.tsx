import { Check } from "lucide-react-native";
import { Switch as NativeSwitch, Pressable, View } from "react-native";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface SwitchProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Read by the screen reader when the switch has no visible label next to it. */
  label?: string;
  disabled?: boolean;
}

export function Switch({ value, onChange, label, disabled }: SwitchProps) {
  const theme = useTheme();
  return (
    <NativeSwitch
      accessibilityLabel={label}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{
        false: theme.color.border.strong,
        true: theme.color.ink.background,
      }}
      thumbColor={theme.color.surface.base}
      ios_backgroundColor={theme.color.border.strong}
    />
  );
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Second line under the label. */
  description?: string;
  /** round: one of several (radio). square: any of several. */
  shape?: "square" | "round";
  disabled?: boolean;
}

// The whole row is the target, not the 20px box.
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  shape = "square",
  disabled,
}: CheckboxProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={shape === "round" ? "radio" : "checkbox"}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        minHeight: theme.touch,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space[5],
        paddingVertical: theme.space[4],
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: shape === "round" ? theme.radius.full : theme.radius.xs,
          borderWidth: checked ? 0 : 1.5,
          borderColor: theme.color.border.strong,
          backgroundColor: checked ? theme.color.ink.background : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (
          <Check size={14} strokeWidth={2.5} color={theme.color.ink.text} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text tone={disabled ? "disabled" : "primary"}>{label}</Text>
        {description !== undefined && (
          <Text variant="small" tone="muted">
            {description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

// Two to four views of the same thing. More than that is a list or a sheet.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        padding: theme.space[1],
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.surface.muted,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: theme.radius.sm,
              backgroundColor: selected
                ? theme.color.surface.base
                : "transparent",
            }}
          >
            <Text
              variant="small"
              weight="medium"
              tone={selected ? "primary" : "muted"}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
