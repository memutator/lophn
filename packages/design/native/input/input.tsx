import type { LucideIcon } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { TextInput, type TextInputProps, View } from "react-native";
import { Icon } from "../primitives/icon.tsx";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface InputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** An icon before the text (a search glass). */
  icon?: LucideIcon;
  /** No edge on a muted fill: a search box in a top bar or a sheet. */
  soft?: boolean;
  /** 40 tall instead of 48: a search box. */
  compact?: boolean;
  /** Draws the focused edge without the keyboard (a picture of a focused field). */
  focus?: boolean;
  autoFocus?: boolean;
  secure?: boolean;
  keyboardType?: TextInputProps["keyboardType"];
  onSubmit?: () => void;
}

export function Input({
  value,
  onChangeText,
  placeholder,
  icon,
  soft,
  compact,
  focus,
  autoFocus,
  secure,
  keyboardType,
  onSubmit,
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const edge = soft
    ? "transparent"
    : focus || focused
      ? theme.color.focus
      : theme.color.border.base;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: compact ? 42 : 50,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: edge,
        borderRadius: 12,
        backgroundColor: soft
          ? theme.color.surface.muted
          : theme.color.surface.base,
      }}
    >
      {icon && <Icon icon={icon} size={18} tone="muted" />}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.muted}
        autoFocus={autoFocus}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        cursorColor={theme.color.text.primary}
        selectionColor={theme.color.ink.soft}
        style={{
          flex: 1,
          minWidth: 0,
          paddingVertical: 0,
          fontFamily: theme.font.sans,
          fontSize: 16,
          lineHeight: 24,
          color: theme.color.text.primary,
        }}
      />
    </View>
  );
}

export interface FieldProps {
  label: string;
  /** A quiet line under the control. */
  hint?: string;
  children: ReactNode;
}

// A label over one control.
export function Field({ label, hint, children }: FieldProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="detail" weight="medium">
        {label}
      </Text>
      {children}
      {hint !== undefined && (
        <Text variant="note" tone="muted">
          {hint}
        </Text>
      )}
    </View>
  );
}
