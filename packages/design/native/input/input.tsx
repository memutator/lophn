import type { ReactNode } from "react";
import { TextInput, type TextInputProps, View } from "react-native";
import { Text } from "../primitives/text.tsx";
import { useTheme } from "../theme.tsx";

export interface FieldProps {
  label: string;
  help?: string;
  /** Replaces the help line and marks the field as wrong. */
  error?: string;
  children: ReactNode;
}

export function Field({ label, help, error, children }: FieldProps) {
  const theme = useTheme();
  const note = error ?? help;
  return (
    <View style={{ gap: theme.space[4] }}>
      <Text variant="small" weight="medium">
        {label}
      </Text>
      {children}
      {note !== undefined && (
        <Text variant="caption" tone={error === undefined ? "muted" : "danger"}>
          {note}
        </Text>
      )}
    </View>
  );
}

export interface InputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** Grows with its text up to a few lines. */
  multiline?: boolean;
  secure?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmit?: () => void;
}

export function Input({
  value,
  onChangeText,
  placeholder,
  multiline,
  secure,
  autoFocus,
  editable = true,
  keyboardType,
  autoCapitalize,
  returnKeyType,
  onSubmit,
}: InputProps) {
  const theme = useTheme();
  const control = theme.control.md;
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.color.text.muted}
      multiline={multiline}
      secureTextEntry={secure}
      autoFocus={autoFocus}
      editable={editable}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmit}
      cursorColor={theme.color.text.primary}
      selectionColor={theme.color.ink.soft}
      style={[
        theme.type.body,
        {
          minHeight: control.height,
          maxHeight: multiline ? 160 : undefined,
          paddingHorizontal: control.padX,
          paddingVertical: theme.space[5],
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.color.border.base,
          backgroundColor: theme.color.surface.base,
          color: editable
            ? theme.color.text.primary
            : theme.color.text.disabled,
          textAlignVertical: multiline ? "top" : "center",
        },
      ]}
    />
  );
}
